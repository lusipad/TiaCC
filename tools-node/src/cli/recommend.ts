#!/usr/bin/env node
/**
 * TiaCC Test Recommender CLI
 *
 * Analyzes Git changes and recommends tests to run based on the impact map.
 */

import { Command } from 'commander';
import { writeFileSync } from 'fs';
import { initDatabase } from '../database.js';
import { GitUtils } from '../git-utils.js';

const program = new Command();

program
  .name('tia-recommend')
  .description('Recommend tests to run based on changed files')
  .version('1.0.0')
  .option('-d, --db <path>', 'Impact map database path', 'impact_map.db')
  .option('-b, --base <ref>', 'Git reference to compare against', 'HEAD~1')
  .option('--branch <name>', 'Compare against merge-base with this branch (e.g., origin/main)')
  .option('-o, --output <file>', 'Output file for test list (one per line)')
  .option('-e, --extensions <exts...>', 'File extensions to consider', ['.cpp', '.h', '.hpp', '.c', '.cs'])
  .option('--include-untracked', 'Include untracked files in analysis')
  .option('--json', 'Output as JSON')
  .option('-q, --quiet', 'Only output test names, no headers')
  .action(async (options) => {
    try {
      const git = new GitUtils();

      // Determine base reference
      let baseRef = options.base;
      if (options.branch) {
        const mergeBase = await git.getMergeBase(options.branch);
        if (mergeBase) {
          baseRef = mergeBase;
          if (!options.quiet) {
            console.log(`Using merge-base with ${options.branch}: ${mergeBase.slice(0, 8)}`);
          }
        } else {
          console.error(`Warning: Could not find merge-base with ${options.branch}`);
        }
      }

      // Get changed files
      const changedFiles = await git.getChangedFiles({
        baseRef,
        includeUntracked: options.includeUntracked,
        extensions: options.extensions,
      });

      if (changedFiles.length === 0) {
        if (!options.quiet) {
          console.log('No relevant file changes detected.');
        }
        process.exit(0);
      }

      if (!options.quiet && !options.json) {
        console.log(`Changed files (${changedFiles.length}):`);
        const displayFiles = changedFiles.slice(0, 10);
        for (const f of displayFiles) {
          console.log(`  - ${f}`);
        }
        if (changedFiles.length > 10) {
          console.log(`  ... and ${changedFiles.length - 10} more`);
        }
        console.log();
      }

      // Query database
      const db = initDatabase(options.db);
      const recommendedTests = db.getTestsForSources(changedFiles);
      db.close();

      // Output results
      if (options.json) {
        const result = {
          changedFiles,
          recommendedTests,
          baseRef,
          totalChanged: changedFiles.length,
          totalTests: recommendedTests.length,
        };
        console.log(JSON.stringify(result, null, 2));
      } else {
        if (recommendedTests.length > 0) {
          if (!options.quiet) {
            console.log(`Recommended tests (${recommendedTests.length}):`);
          }
          for (const test of recommendedTests) {
            if (options.quiet) {
              console.log(test);
            } else {
              console.log(`  - ${test}`);
            }
          }
        } else {
          if (!options.quiet) {
            console.log('No tests found for changed files.');
            console.log('This could mean:');
            console.log('  1. The changed files are not covered by any tests');
            console.log('  2. The impact map is outdated');
            console.log('  3. The changed files are new and not yet in the map');
          }
        }
      }

      // Write to output file if specified
      if (options.output && recommendedTests.length > 0) {
        writeFileSync(options.output, recommendedTests.join('\n') + '\n');
        if (!options.quiet) {
          console.log(`\nTest list written to: ${options.output}`);
        }
      }

      // Print summary
      if (!options.quiet && !options.json) {
        console.log();
        console.log('='.repeat(50));
        console.log(`Summary: ${changedFiles.length} files changed, ${recommendedTests.length} tests recommended`);
      }

    } catch (error) {
      console.error(`Error: ${error}`);
      process.exit(1);
    }
  });

program.parse();
