/**
 * Example: Complete CI Integration
 *
 * This script demonstrates a complete CI integration workflow
 * that can be used in GitHub Actions, GitLab CI, or other CI systems.
 *
 * Usage:
 *   # Build mode (nightly)
 *   tsx ci-integration.ts build --coverage-dir ./coverage
 *
 *   # Recommend mode (PR check)
 *   tsx ci-integration.ts recommend --branch origin/main
 *
 *   # Run mode (execute affected tests)
 *   tsx ci-integration.ts run --branch origin/main --runner "npm test --"
 */

import { TiaCC, AffectedTestsResult } from '@tiacc/tools';
import { execSync } from 'child_process';
import { existsSync, writeFileSync, readFileSync } from 'fs';

interface CLIOptions {
  mode: 'build' | 'recommend' | 'run' | 'stats';
  dbPath: string;
  coverageDir?: string;
  branch?: string;
  level?: 'file' | 'function';
  output?: string;
  runner?: string;
  dryRun?: boolean;
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2);
  const mode = (args[0] || 'stats') as CLIOptions['mode'];

  const getArg = (name: string, defaultValue?: string): string | undefined => {
    const arg = args.find(a => a.startsWith(`--${name}=`));
    return arg ? arg.split('=').slice(1).join('=') : defaultValue;
  };

  return {
    mode,
    dbPath: getArg('db', './impact_map.db')!,
    coverageDir: getArg('coverage-dir', './coverage'),
    branch: getArg('branch', 'origin/main'),
    level: (getArg('level', 'file') as 'file' | 'function'),
    output: getArg('output'),
    runner: getArg('runner'),
    dryRun: args.includes('--dry-run'),
  };
}

async function buildMapping(tia: TiaCC, options: CLIOptions): Promise<void> {
  console.log('Building impact mapping...');
  console.log(`  Coverage dir: ${options.coverageDir}`);
  console.log();

  const result = await tia.buildMapping({
    coverageDir: options.coverageDir!,
    commitHash: process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA,
  });

  console.log('Build complete:');
  console.log(`  Source files: ${result.sourceFiles}`);
  console.log(`  Test scripts: ${result.testScripts}`);
  console.log(`  Mappings:     ${result.mappings}`);
  console.log(`  Duration:     ${result.duration}ms`);
}

async function recommendTests(tia: TiaCC, options: CLIOptions): Promise<AffectedTestsResult> {
  console.log('Analyzing changes...');
  console.log(`  Base branch: ${options.branch}`);
  console.log(`  Level:       ${options.level}`);
  console.log();

  const result = await tia.getAffectedTests({
    baseBranch: options.branch,
    level: options.level,
  });

  // Summary
  console.log('Analysis results:');
  console.log(`  Changed files:  ${result.changedFiles.length}`);
  console.log(`  Affected tests: ${result.tests.length} / ${result.totalTests}`);
  console.log(`  Savings:        ${result.savingsPercent}%`);
  console.log();

  // Write to output file if specified
  if (options.output && result.tests.length > 0) {
    writeFileSync(options.output, result.tests.join('\n') + '\n');
    console.log(`Written to: ${options.output}`);
  }

  // Set GitHub Actions output
  if (process.env.GITHUB_OUTPUT) {
    const outputFile = process.env.GITHUB_OUTPUT;
    const output = [
      `affected_count=${result.tests.length}`,
      `total_tests=${result.totalTests}`,
      `savings_percent=${result.savingsPercent}`,
      `tests=${result.tests.join(',')}`,
    ].join('\n') + '\n';
    writeFileSync(outputFile, output, { flag: 'a' });
  }

  return result;
}

async function runAffectedTests(tia: TiaCC, options: CLIOptions): Promise<void> {
  const result = await recommendTests(tia, options);

  if (result.tests.length === 0) {
    console.log('No tests to run.');
    return;
  }

  if (!options.runner) {
    console.log();
    console.log('Tests to run:');
    for (const test of result.tests) {
      console.log(`  - ${test}`);
    }
    console.log();
    console.log('Tip: Use --runner="command" to execute tests');
    return;
  }

  console.log();
  console.log(`Running ${result.tests.length} tests...`);
  console.log();

  for (const test of result.tests) {
    const command = `${options.runner} ${test}`;

    if (options.dryRun) {
      console.log(`[DRY RUN] ${command}`);
    } else {
      console.log(`> ${command}`);
      try {
        execSync(command, { stdio: 'inherit' });
        console.log(`✓ ${test} passed`);
      } catch (error) {
        console.error(`✗ ${test} failed`);
        throw error;
      }
    }
  }

  console.log();
  console.log(`All ${result.tests.length} tests passed!`);
}

async function showStats(tia: TiaCC): Promise<void> {
  const stats = tia.getStats();

  console.log('Database Statistics:');
  console.log(`  Source files:  ${stats.sourceFiles}`);
  console.log(`  Test scripts:  ${stats.testScripts}`);
  console.log(`  Mappings:      ${stats.mappings}`);
}

async function main(): Promise<void> {
  const options = parseArgs();

  console.log('='.repeat(50));
  console.log('TiaCC CI Integration');
  console.log('='.repeat(50));
  console.log();

  // Check if database exists for non-build modes
  if (options.mode !== 'build' && !existsSync(options.dbPath)) {
    console.error(`Error: Database not found: ${options.dbPath}`);
    console.error('Run "build" mode first to create the database.');
    process.exit(1);
  }

  const tia = await TiaCC.init({
    dbPath: options.dbPath,
    verbose: true,
  });

  try {
    switch (options.mode) {
      case 'build':
        await buildMapping(tia, options);
        break;
      case 'recommend':
        await recommendTests(tia, options);
        break;
      case 'run':
        await runAffectedTests(tia, options);
        break;
      case 'stats':
        await showStats(tia);
        break;
      default:
        console.error(`Unknown mode: ${options.mode}`);
        console.error('Available modes: build, recommend, run, stats');
        process.exit(1);
    }
  } finally {
    tia.close();
  }
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
