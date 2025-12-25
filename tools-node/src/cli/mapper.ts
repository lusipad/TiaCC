#!/usr/bin/env node
/**
 * TiaCC Mapping Generator CLI
 *
 * Processes coverage data files and builds the source->test mapping database.
 * Designed to run as a nightly CI task.
 */

import { Command } from 'commander';
import { glob } from 'glob';
import ora from 'ora';
import { initDatabase } from '../database.js';
import { CppCoverageParser, CSharpCoverageParser } from '../coverage-parser.js';
import { GitUtils } from '../git-utils.js';

const program = new Command();

program
  .name('tia-mapper')
  .description('TiaCC Mapping Generator - Build test impact maps from coverage data')
  .version('1.0.0');

program
  .command('build')
  .description('Build full mapping database from coverage files')
  .option('-c, --coverage-dir <dir>', 'Directory containing coverage files', './coverage_data')
  .option('-d, --db <path>', 'Output database path', 'impact_map.db')
  .option('-e, --executable <path>', 'Path to instrumented executable (for C++ coverage)')
  .option('--commit <hash>', 'Git commit hash to associate with this run')
  .option('-v, --verbose', 'Enable verbose output')
  .action(async (options) => {
    const spinner = ora('Initializing...').start();

    try {
      // Initialize database
      spinner.text = 'Initializing database...';
      const db = initDatabase(options.db);

      // Get git commit if not specified
      let commit = options.commit;
      if (!commit) {
        const git = new GitUtils();
        commit = await git.getCurrentCommitHash(true);
      }

      // Find all coverage files
      spinner.text = 'Scanning for coverage files...';

      const profrawFiles = await glob('*.profraw', { cwd: options.coverageDir });
      const coverletFiles = await glob('*.coverage.json', { cwd: options.coverageDir });

      spinner.info(`Found ${profrawFiles.length} C++ coverage files`);
      spinner.info(`Found ${coverletFiles.length} C# coverage files`);

      if (profrawFiles.length === 0 && coverletFiles.length === 0) {
        spinner.warn('No coverage files found.');
        db.close();
        return;
      }

      // Initialize parsers
      const cppParser = new CppCoverageParser({ executable: options.executable });
      const csharpParser = new CSharpCoverageParser();

      const totalSources = new Set<string>();
      let totalTests = 0;

      // Process C++ coverage files
      if (profrawFiles.length > 0) {
        spinner.start('Processing C++ coverage files...');

        for (let i = 0; i < profrawFiles.length; i++) {
          const file = profrawFiles[i];
          spinner.text = `Processing C++ [${i + 1}/${profrawFiles.length}]: ${file}`;

          const coveragePath = `${options.coverageDir}/${file}`;
          const data = await cppParser.parse(coveragePath);

          if (data) {
            totalTests++;
            const testId = db.upsertTestScript(data.testId);

            for (const sourcePath of data.coveredFiles) {
              const sourceId = db.upsertSourceFile(sourcePath);
              db.addCoverageMapping(sourceId, testId);
              totalSources.add(sourcePath);
            }

            if (options.verbose) {
              console.log(`  ${data.testId}: ${data.coveredFiles.length} files`);
            }
          }
        }

        spinner.succeed(`Processed ${profrawFiles.length} C++ coverage files`);
      }

      // Process C# coverage files
      if (coverletFiles.length > 0) {
        spinner.start('Processing C# coverage files...');

        for (let i = 0; i < coverletFiles.length; i++) {
          const file = coverletFiles[i];
          spinner.text = `Processing C# [${i + 1}/${coverletFiles.length}]: ${file}`;

          const coveragePath = `${options.coverageDir}/${file}`;
          const data = await csharpParser.parse(coveragePath);

          if (data) {
            totalTests++;
            const testId = db.upsertTestScript(data.testId);

            const coveragePct = data.totalLines > 0
              ? (data.coveredLines / data.totalLines) * 100
              : 0;

            for (const sourcePath of data.coveredFiles) {
              const sourceId = db.upsertSourceFile(sourcePath);
              db.addCoverageMapping(sourceId, testId, coveragePct);
              totalSources.add(sourcePath);
            }

            if (options.verbose) {
              console.log(`  ${data.testId}: ${data.coveredFiles.length} files`);
            }
          }
        }

        spinner.succeed(`Processed ${coverletFiles.length} C# coverage files`);
      }

      // Record run metadata
      db.recordCoverageRun(totalTests, totalSources.size, commit ?? undefined);

      // Print summary
      const stats = db.getStats();
      console.log('\n' + '='.repeat(50));
      console.log('Build Complete!');
      console.log(`  Source files: ${stats.sourceFiles}`);
      console.log(`  Test scripts: ${stats.testScripts}`);
      console.log(`  Mappings: ${stats.mappings}`);
      console.log(`  Commit: ${commit ?? 'N/A'}`);

      db.close();

    } catch (error) {
      spinner.fail(`Error: ${error}`);
      process.exit(1);
    }
  });

program
  .command('stats')
  .description('Show database statistics')
  .option('-d, --db <path>', 'Database path', 'impact_map.db')
  .action((options) => {
    const db = initDatabase(options.db);
    const stats = db.getStats();

    console.log(`Database: ${options.db}`);
    console.log(`  Source files: ${stats.sourceFiles}`);
    console.log(`  Test scripts: ${stats.testScripts}`);
    console.log(`  Mappings: ${stats.mappings}`);

    const latest = db.getLatestRun();
    if (latest) {
      console.log('\nLatest run:');
      console.log(`  Date: ${latest.runDate}`);
      console.log(`  Commit: ${latest.commitHash ?? 'N/A'}`);
    }

    db.close();
  });

program
  .command('query <sourceFile>')
  .description('Query tests that cover a specific source file')
  .option('-d, --db <path>', 'Database path', 'impact_map.db')
  .action((sourceFile, options) => {
    const db = initDatabase(options.db);
    const tests = db.getTestsForSource(sourceFile);

    if (tests.length > 0) {
      console.log(`Tests covering '${sourceFile}':`);
      for (const test of tests) {
        console.log(`  - ${test}`);
      }
    } else {
      console.log(`No tests found covering '${sourceFile}'`);
    }

    db.close();
  });

program.parse();
