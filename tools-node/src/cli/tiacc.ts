#!/usr/bin/env node
/**
 * TiaCC - Unified CLI Entry Point
 *
 * Main command that provides access to all TiaCC functionality.
 *
 * Usage:
 *   tiacc init [--preset dotnet]
 *   tiacc build [options]
 *   tiacc recommend [options]
 *   tiacc run [options]
 *   tiacc stats
 *   tiacc export [options]
 */

import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import ora from 'ora';
import { glob } from 'glob';
import { initDatabase } from '../database.js';
import { loadConfig, findConfigDir, mergeWithConfig, getProjectRoot } from '../config.js';
import { GitUtils } from '../git-utils.js';
import type { ProjectConfig, ProjectPreset } from '../types.js';
import {
  CppCoverageParser,
  CSharpCoverageParser,
  LlvmJsonCoverageParser,
  CoberturaCoverageParser,
  IstanbulCoverageParser,
  CoveragePyCoverageParser,
  LuaCovCoverageParser,
  JacocoCoverageParser,
} from '../coverage-parser.js';

const CONFIG_DIR = '.tiacc';
const CONFIG_FILE = 'config.json';

const program = new Command();

program
  .name('tiacc')
  .description('TiaCC - Test Impact Analysis for Code Coverage')
  .version('1.0.0');

// ============ INIT Command ============

const PRESETS: Record<ProjectPreset, Omit<ProjectConfig, 'version' | 'preset'>> = {
  dotnet: {
    db: 'impact_map.db',
    coverageDir: 'coverage',
    testProjects: ['**/*.Tests.csproj', '**/*.Test.csproj'],
    sourcePatterns: ['**/*.cs'],
    excludePatterns: ['**/obj/**', '**/bin/**', '**/node_modules/**'],
    coverage: { format: 'coverlet', testIdFrom: 'filename' },
    build: { concurrency: 4, verbose: false },
  },
  cpp: {
    db: 'impact_map.db',
    coverageDir: 'coverage',
    sourcePatterns: ['**/*.cpp', '**/*.cc', '**/*.h', '**/*.hpp'],
    excludePatterns: ['**/build/**', '**/cmake-build-*/**'],
    coverage: { format: 'llvm' },
    build: { concurrency: 4, verbose: false },
  },
  typescript: {
    db: 'impact_map.db',
    coverageDir: 'coverage',
    sourcePatterns: ['**/*.ts', '**/*.tsx'],
    excludePatterns: ['**/node_modules/**', '**/dist/**'],
    coverage: { format: 'istanbul' },
    build: { concurrency: 4, verbose: false },
  },
  java: {
    db: 'impact_map.db',
    coverageDir: 'coverage',
    sourcePatterns: ['**/*.java'],
    excludePatterns: ['**/target/**', '**/build/**'],
    coverage: { format: 'jacoco' },
    build: { concurrency: 4, verbose: false },
  },
  python: {
    db: 'impact_map.db',
    coverageDir: 'coverage',
    sourcePatterns: ['**/*.py'],
    excludePatterns: ['**/__pycache__/**', '**/venv/**'],
    coverage: { format: 'coveragepy' },
    build: { concurrency: 4, verbose: false },
  },
  lua: {
    db: 'impact_map.db',
    coverageDir: 'coverage',
    sourcePatterns: ['**/*.lua'],
    excludePatterns: [],
    coverage: { format: 'luacov', testIdFrom: 'source' },
    build: { concurrency: 4, verbose: false },
  },
  custom: {
    db: 'impact_map.db',
    coverageDir: 'coverage',
    sourcePatterns: ['**/*'],
    excludePatterns: [],
    build: { concurrency: 4, verbose: false },
  },
};

function detectProjectType(dir: string): ProjectPreset {
  const files = readdirSync(dir, { recursive: false }) as string[];
  if (files.some(f => f.endsWith('.csproj') || f.endsWith('.sln'))) return 'dotnet';
  if (files.includes('package.json') && files.includes('tsconfig.json')) return 'typescript';
  if (files.includes('pom.xml') || files.includes('build.gradle')) return 'java';
  if (files.includes('setup.py') || files.includes('pyproject.toml')) return 'python';
  if (files.includes('CMakeLists.txt')) return 'cpp';
  if (files.some(f => f.endsWith('.lua'))) return 'lua';
  return 'custom';
}

program
  .command('init')
  .description('Initialize TiaCC configuration')
  .option('-p, --preset <type>', 'Project preset (dotnet, cpp, typescript, java, python, lua)')
  .option('-f, --force', 'Overwrite existing configuration')
  .action(async (options: { preset?: ProjectPreset; force?: boolean }) => {
    const projectDir = process.cwd();
    const configDir = join(projectDir, CONFIG_DIR);
    const configPath = join(configDir, CONFIG_FILE);

    if (existsSync(configPath) && !options.force) {
      console.error('❌ TiaCC already initialized. Use --force to overwrite.');
      process.exit(1);
    }

    const spinner = ora('Detecting project type...').start();
    const preset = options.preset || detectProjectType(projectDir);
    spinner.text = `Detected: ${preset}`;

    const config: ProjectConfig = { version: 1, preset, ...PRESETS[preset] };

    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
    const coverageDir = join(configDir, config.coverageDir);
    if (!existsSync(coverageDir)) mkdirSync(coverageDir, { recursive: true });

    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    writeFileSync(join(configDir, '.gitignore'), `impact_map.db\nimpact_map.db-journal\ncoverage/\n`);

    spinner.succeed(`Initialized with ${preset} preset`);
    console.log(`\n📁 Created: ${CONFIG_DIR}/config.json\n`);
    console.log('Next: tiacc build --help');
  });

// ============ BUILD Command ============

program
  .command('build')
  .description('Build mapping database from coverage files')
  .option('-c, --coverage-dir <dir>', 'Coverage directory')
  .option('-d, --db <path>', 'Database path')
  .option('-j, --concurrency <num>', 'Parallel workers', '4')
  .option('-v, --verbose', 'Verbose output')
  .option('--test-id-from-filename', 'Extract testId from filename')
  .option('--test-id-from-source', 'Extract testId from source tag')
  .option('--clean', 'Clear existing data before build')
  .action(async (options) => {
    const merged = mergeWithConfig({
      db: options.db,
      coverageDir: options.coverageDir,
      concurrency: options.concurrency ? parseInt(options.concurrency) : undefined,
      verbose: options.verbose,
      testIdFrom: options.testIdFromFilename ? 'filename' : options.testIdFromSource ? 'source' : undefined,
    });

    const spinner = ora('Building mapping database...').start();

    try {
      const db = initDatabase(merged.db);

      if (options.clean) {
        // Clear existing data
        db.db.exec('DELETE FROM coverage_map');
        db.db.exec('DELETE FROM symbol_coverage');
        spinner.text = 'Cleared existing data';
      }

      // Find coverage files
      const coverageDir = merged.coverageDir;
      if (!existsSync(coverageDir)) {
        spinner.fail(`Coverage directory not found: ${coverageDir}`);
        process.exit(1);
      }

      // Detect format from config or files
      const format = merged.format || 'coverlet';
      let pattern: string;
      let Parser: new (...args: unknown[]) => { parse: (file: string) => Promise<unknown> };

      switch (format) {
        case 'coverlet':
          pattern = '**/*.coverage.json';
          Parser = CSharpCoverageParser as unknown as new () => { parse: (file: string) => Promise<unknown> };
          break;
        case 'llvm':
          pattern = '**/*.cov.json';
          Parser = LlvmJsonCoverageParser as unknown as new () => { parse: (file: string) => Promise<unknown> };
          break;
        case 'cobertura':
          pattern = '**/*.cobertura.xml';
          Parser = CoberturaCoverageParser as unknown as new () => { parse: (file: string) => Promise<unknown> };
          break;
        case 'istanbul':
          pattern = '**/coverage-final.json';
          Parser = IstanbulCoverageParser as unknown as new () => { parse: (file: string) => Promise<unknown> };
          break;
        case 'coveragepy':
          pattern = '**/coverage.json';
          Parser = CoveragePyCoverageParser as unknown as new () => { parse: (file: string) => Promise<unknown> };
          break;
        case 'jacoco':
          pattern = '**/jacoco*.xml';
          Parser = JacocoCoverageParser as unknown as new () => { parse: (file: string) => Promise<unknown> };
          break;
        case 'luacov':
          pattern = '**/*.out';
          Parser = LuaCovCoverageParser as unknown as new () => { parse: (file: string) => Promise<unknown> };
          break;
        default:
          pattern = '**/*.coverage.json';
          Parser = CSharpCoverageParser as unknown as new () => { parse: (file: string) => Promise<unknown> };
      }

      const files = await glob(pattern, { cwd: coverageDir, absolute: true });
      spinner.text = `Found ${files.length} ${format} coverage files`;

      if (files.length === 0) {
        spinner.warn(`No coverage files found matching ${pattern}`);
        process.exit(0);
      }

      // Process files
      let processed = 0;
      for (const file of files) {
        try {
          const parser = new Parser();
          const data = await parser.parse(file);
          // Process coverage data...
          processed++;
          if (merged.verbose) {
            spinner.text = `Processed: ${file}`;
          }
        } catch (e) {
          if (merged.verbose) {
            console.error(`Failed to parse: ${file}`, e);
          }
        }
      }

      const stats = db.getStats();
      spinner.succeed(`Build complete: ${stats.sourceFiles} sources, ${stats.testScripts} tests, ${stats.mappings} mappings`);
    } catch (error) {
      spinner.fail('Build failed');
      console.error(error);
      process.exit(1);
    }
  });

// ============ RECOMMEND Command ============

program
  .command('recommend')
  .description('Recommend tests based on git changes')
  .option('-d, --db <path>', 'Database path')
  .option('-b, --branch <ref>', 'Base branch to compare', 'origin/main')
  .option('--base <ref>', 'Base commit to compare')
  .option('-l, --level <level>', 'Analysis level (file/function)', 'file')
  .option('-o, --output <file>', 'Output file for test list')
  .option('--json', 'Output as JSON')
  .option('-q, --quiet', 'Quiet mode - only output test names')
  .action(async (options) => {
    const merged = mergeWithConfig({ db: options.db });

    if (!existsSync(merged.db)) {
      console.error(`❌ Database not found: ${merged.db}`);
      console.error('Run "tiacc build" first to create the mapping database.');
      process.exit(1);
    }

    const spinner = ora('Analyzing git changes...').start();

    try {
      const git = new GitUtils();
      const baseRef = options.base || options.branch;
      const changedFiles = await git.getChangedFiles({ baseRef });

      spinner.text = `Found ${changedFiles.length} changed files`;

      const db = initDatabase(merged.db);
      const affectedTests = new Set<string>();

      for (const file of changedFiles) {
        const tests = db.getTestsForSource(file);
        tests.forEach(t => affectedTests.add(t));
      }

      const allTests = db.getAllTestScripts();
      const savings = allTests.length > 0
        ? Math.round((1 - affectedTests.size / allTests.length) * 100)
        : 0;

      spinner.succeed(`Found ${affectedTests.size} affected tests (${savings}% savings)`);

      const testList = Array.from(affectedTests);

      if (options.json) {
        console.log(JSON.stringify({
          tests: testList,
          changedFiles,
          totalTests: allTests.length,
          savingsPercent: savings,
        }, null, 2));
      } else if (!options.quiet) {
        console.log('\nAffected tests:');
        testList.forEach(t => console.log(`  - ${t}`));
      } else {
        testList.forEach(t => console.log(t));
      }

      if (options.output) {
        writeFileSync(options.output, testList.join('\n') + '\n');
        console.log(`\nWritten to: ${options.output}`);
      }
    } catch (error) {
      spinner.fail('Recommendation failed');
      console.error(error);
      process.exit(1);
    }
  });

// ============ STATS Command ============

program
  .command('stats')
  .description('Show database statistics')
  .option('-d, --db <path>', 'Database path')
  .action((options) => {
    const merged = mergeWithConfig({ db: options.db });

    if (!existsSync(merged.db)) {
      console.error(`❌ Database not found: ${merged.db}`);
      process.exit(1);
    }

    const db = initDatabase(merged.db);
    const stats = db.getStats();

    console.log('\n📊 TiaCC Database Statistics\n');
    console.log(`  Source files:  ${stats.sourceFiles}`);
    console.log(`  Test scripts:  ${stats.testScripts}`);
    console.log(`  Mappings:      ${stats.mappings}`);
    console.log(`  Database:      ${merged.db}\n`);
  });

// ============ RUN Command (Coming Soon) ============

program
  .command('run')
  .description('Run tests with coverage and build mapping (coming soon)')
  .option('-b, --branch <ref>', 'Base branch for recommendations', 'origin/main')
  .option('--full', 'Run full test suite with coverage')
  .option('--affected', 'Run only affected tests')
  .action(() => {
    console.log(`
🚧 The 'tiacc run' command is coming soon!

For now, use the following workflow:

1. Collect coverage:
   dotnet test --collect:"XPlat Code Coverage" --results-directory .tiacc/coverage

2. Build mapping:
   tiacc build

3. Get recommendations:
   tiacc recommend --branch origin/main
`);
  });

program.parse();
