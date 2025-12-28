import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as artifact from '@actions/artifact';
import * as github from '@actions/github';
import * as fs from 'fs';
import * as path from 'path';
import { TiaCC } from '@tiacc/tools';

interface ActionInputs {
  mode: 'build' | 'recommend' | 'auto';
  coverageDir: string;
  database: string;
  baseBranch: string;
  baseCommit: string;
  format: string;
  outputFile: string;
  outputFormat: 'text' | 'json' | 'github';
  basePath: string;
  testIdFromFilename: boolean;
  verbose: boolean;
  failOnNoTests: boolean;
  uploadArtifact: boolean;
  downloadArtifact: boolean;
  artifactName: string;
}

function getInputs(): ActionInputs {
  return {
    mode: core.getInput('mode') as 'build' | 'recommend' | 'auto',
    coverageDir: core.getInput('coverage-dir'),
    database: core.getInput('database'),
    baseBranch: core.getInput('base-branch'),
    baseCommit: core.getInput('base-commit'),
    format: core.getInput('format'),
    outputFile: core.getInput('output-file'),
    outputFormat: core.getInput('output-format') as 'text' | 'json' | 'github',
    basePath: core.getInput('base-path'),
    testIdFromFilename: core.getInput('test-id-from-filename') === 'true',
    verbose: core.getInput('verbose') === 'true',
    failOnNoTests: core.getInput('fail-on-no-tests') === 'true',
    uploadArtifact: core.getInput('upload-artifact') === 'true',
    downloadArtifact: core.getInput('download-artifact') === 'true',
    artifactName: core.getInput('artifact-name'),
  };
}

async function downloadDatabase(inputs: ActionInputs): Promise<boolean> {
  if (!inputs.downloadArtifact) {
    return false;
  }

  try {
    const artifactClient = artifact.create();
    const downloadResponse = await artifactClient.downloadArtifact(
      inputs.artifactName,
      path.dirname(inputs.database)
    );
    core.info(`Downloaded database from artifact: ${downloadResponse.downloadPath}`);
    return true;
  } catch (error) {
    core.info('No existing database artifact found, will create new database');
    return false;
  }
}

async function uploadDatabase(inputs: ActionInputs): Promise<void> {
  if (!inputs.uploadArtifact) {
    return;
  }

  if (!fs.existsSync(inputs.database)) {
    core.warning('Database file not found, skipping artifact upload');
    return;
  }

  try {
    const artifactClient = artifact.create();
    await artifactClient.uploadArtifact(
      inputs.artifactName,
      [inputs.database],
      path.dirname(inputs.database),
      { continueOnError: true }
    );
    core.info(`Uploaded database as artifact: ${inputs.artifactName}`);
  } catch (error) {
    core.warning(`Failed to upload database artifact: ${error}`);
  }
}

function detectFormat(inputs: ActionInputs): string[] {
  const format = inputs.format.toLowerCase();

  if (format !== 'auto') {
    return [format];
  }

  // Auto-detect based on files in coverage directory
  const formats: string[] = [];

  if (!fs.existsSync(inputs.coverageDir)) {
    return ['cobertura']; // Default fallback
  }

  const files = fs.readdirSync(inputs.coverageDir, { recursive: true }) as string[];

  // Check for various formats
  if (files.some(f => f.endsWith('.info'))) {
    formats.push('lcov');
  }
  if (files.some(f => f.toLowerCase().includes('jacoco') && f.endsWith('.xml'))) {
    formats.push('jacoco');
  }
  if (files.some(f => f === 'coverage-final.json' || f.includes('istanbul'))) {
    formats.push('istanbul');
  }
  if (files.some(f => f.toLowerCase().includes('dotcover'))) {
    formats.push('dotcover');
  }
  if (files.some(f => f.toLowerCase().includes('opencppcoverage') || f.toLowerCase().includes('coveragereport'))) {
    formats.push('opencppcoverage');
  }
  if (files.some(f => f.endsWith('.cobertura.xml') || f.includes('coverage') && f.endsWith('.xml'))) {
    formats.push('cobertura');
  }

  // Default to cobertura if nothing detected
  if (formats.length === 0) {
    formats.push('cobertura');
  }

  return formats;
}

async function buildMapping(inputs: ActionInputs): Promise<void> {
  core.startGroup('Building test impact mapping');

  const formats = detectFormat(inputs);
  core.info(`Detected coverage formats: ${formats.join(', ')}`);

  // Build command arguments
  const args = ['tia-mapper', 'build', '-c', inputs.coverageDir, '-d', inputs.database];

  if (inputs.basePath) {
    args.push('-b', inputs.basePath);
  }

  if (inputs.testIdFromFilename) {
    args.push('--test-id-from-filename');
  }

  if (inputs.verbose) {
    args.push('-v');
  }

  // Add format-specific flags
  for (const format of formats) {
    switch (format) {
      case 'lcov':
        args.push('--lcov');
        break;
      case 'jacoco':
        args.push('--jacoco');
        break;
      case 'istanbul':
        args.push('--istanbul');
        break;
      case 'coveragepy':
        args.push('--coveragepy');
        break;
      case 'dotcover':
        args.push('--dotcover');
        break;
      case 'opencppcoverage':
        args.push('--opencppcoverage');
        break;
      // cobertura is default, no flag needed
    }
  }

  await exec.exec('npx', args);

  core.endGroup();
}

async function recommendTests(inputs: ActionInputs): Promise<{
  tests: string[];
  changedFiles: string[];
}> {
  core.startGroup('Analyzing changed files and recommending tests');

  // Initialize TiaCC
  const tia = await TiaCC.init(inputs.database);

  // Get affected tests
  const result = await tia.getAffectedTests({
    baseBranch: inputs.baseCommit || inputs.baseBranch,
  });

  core.info(`Changed files: ${result.changedFiles.length}`);
  core.info(`Affected tests: ${result.tests.length}`);

  if (inputs.verbose) {
    core.info('Changed files:');
    for (const file of result.changedFiles) {
      core.info(`  - ${file}`);
    }
    core.info('Affected tests:');
    for (const test of result.tests) {
      core.info(`  - ${test}`);
    }
  }

  core.endGroup();

  return {
    tests: result.tests,
    changedFiles: result.changedFiles,
  };
}

function writeOutput(
  inputs: ActionInputs,
  tests: string[],
  changedFiles: string[]
): void {
  const coverageRate = changedFiles.length > 0
    ? Math.round((tests.length > 0 ? 1 : 0) * 100) // Simplified - actual would check per-file
    : 100;

  // Set outputs
  core.setOutput('affected-tests', tests.join('\n'));
  core.setOutput('affected-count', tests.length.toString());
  core.setOutput('changed-files', changedFiles.join('\n'));
  core.setOutput('changed-count', changedFiles.length.toString());
  core.setOutput('coverage-rate', coverageRate.toString());
  core.setOutput('has-affected-tests', (tests.length > 0).toString());

  // Write to file
  let content: string;

  switch (inputs.outputFormat) {
    case 'json':
      content = JSON.stringify({
        affectedTests: tests,
        changedFiles,
        affectedCount: tests.length,
        changedCount: changedFiles.length,
        coverageRate,
      }, null, 2);
      break;

    case 'github':
      // Markdown format for PR comments
      content = `## Test Impact Analysis

### Summary
- **Changed Files:** ${changedFiles.length}
- **Affected Tests:** ${tests.length}

${changedFiles.length > 0 ? `
### Changed Files
${changedFiles.map(f => `- \`${f}\``).join('\n')}
` : ''}

${tests.length > 0 ? `
### Recommended Tests
\`\`\`
${tests.join('\n')}
\`\`\`
` : '### No tests affected by these changes'}
`;
      break;

    default: // text
      content = tests.join('\n');
  }

  fs.writeFileSync(inputs.outputFile, content);
  core.info(`Output written to ${inputs.outputFile}`);

  // Create summary
  core.summary
    .addHeading('TiaCC - Test Impact Analysis')
    .addTable([
      [{ data: 'Metric', header: true }, { data: 'Value', header: true }],
      ['Changed Files', changedFiles.length.toString()],
      ['Affected Tests', tests.length.toString()],
    ])
    .write();
}

async function run(): Promise<void> {
  try {
    const inputs = getInputs();

    core.info(`TiaCC - Test Impact Analysis`);
    core.info(`Mode: ${inputs.mode}`);

    // Try to download existing database
    if (inputs.mode === 'recommend' || inputs.mode === 'auto') {
      await downloadDatabase(inputs);
    }

    let tests: string[] = [];
    let changedFiles: string[] = [];

    // Build mode
    if (inputs.mode === 'build' || inputs.mode === 'auto') {
      await buildMapping(inputs);
    }

    // Recommend mode
    if (inputs.mode === 'recommend' || inputs.mode === 'auto') {
      const result = await recommendTests(inputs);
      tests = result.tests;
      changedFiles = result.changedFiles;

      writeOutput(inputs, tests, changedFiles);

      // Check fail condition
      if (inputs.failOnNoTests && changedFiles.length > 0 && tests.length === 0) {
        core.setFailed('No tests found for changed files');
        return;
      }
    }

    // Upload database for future runs
    if (inputs.mode === 'build' || inputs.mode === 'auto') {
      await uploadDatabase(inputs);
    }

    core.info('TiaCC completed successfully');

  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unexpected error occurred');
    }
  }
}

run();
