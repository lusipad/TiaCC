#!/usr/bin/env node
/**
 * TiaCC Test Recommender CLI
 *
 * Analyzes Git changes and recommends tests to run based on the impact map.
 * Supports both file-level and function-level precision.
 */

import { Command } from 'commander';
import { writeFileSync } from 'fs';
import { initDatabase } from '../database.js';
import { GitUtils } from '../git-utils.js';
import type { FunctionTestMapping } from '../types.js';

const program = new Command();

interface FunctionRecommendation {
  changedFunctions: Array<{
    name: string;
    file: string;
    lines: string;
    tests: Array<{ path: string; coverage: number }>;
  }>;
  summary: {
    functionsChanged: number;
    testsRecommended: number;
    scale: 'small' | 'medium' | 'large';
    fallbackReason?: string;
  };
}

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
  .option('--level <level>', 'Analysis level: file or function', 'function')
  .option('--json', 'Output as JSON')
  .option('-q, --quiet', 'Only output test names, no headers')
  .action(async (options) => {
    try {
      const git = new GitUtils();
      const level = options.level === 'file' ? 'file' : 'function';

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

      // Analyze change scale
      const changeScale = await git.analyzeChangeScale(baseRef);

      // For large changes, warn and optionally fallback to file level
      if (changeScale.scale === 'large' && level === 'function') {
        if (!options.quiet) {
          console.log(`\n⚠️  Large change detected (${changeScale.totalLines} lines across ${changeScale.totalFiles} files)`);
          console.log('   Recommendation: Consider running full test suite or using file-level analysis.\n');
        }
      }

      const db = initDatabase(options.db);

      // Use function-level or file-level based on option
      if (level === 'function') {
        await runFunctionLevelAnalysis(git, db, baseRef, options, changeScale);
      } else {
        await runFileLevelAnalysis(git, db, baseRef, options);
      }

      db.close();

    } catch (error) {
      console.error(`Error: ${error}`);
      process.exit(1);
    }
  });

/**
 * File-level analysis (original behavior)
 */
async function runFileLevelAnalysis(
  git: GitUtils,
  db: ReturnType<typeof initDatabase>,
  baseRef: string,
  options: any
): Promise<void> {
  const changedFiles = await git.getChangedFiles({
    baseRef,
    includeUntracked: options.includeUntracked,
    extensions: options.extensions,
  });

  if (changedFiles.length === 0) {
    if (!options.quiet) {
      console.log('No relevant file changes detected.');
    }
    return;
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

  const recommendedTests = db.getTestsForSources(changedFiles);

  // Output results
  if (options.json) {
    const result = {
      level: 'file',
      changedFiles,
      recommendedTests,
      baseRef,
      totalChanged: changedFiles.length,
      totalTests: recommendedTests.length,
    };
    console.log(JSON.stringify(result, null, 2));
  } else {
    outputTestResults(recommendedTests, options);
  }

  writeOutputFile(options, recommendedTests);
  printSummary(changedFiles.length, recommendedTests.length, options);
}

/**
 * Function-level analysis (new precise behavior)
 */
async function runFunctionLevelAnalysis(
  git: GitUtils,
  db: ReturnType<typeof initDatabase>,
  baseRef: string,
  options: any,
  changeScale: { totalFiles: number; totalLines: number; scale: 'small' | 'medium' | 'large' }
): Promise<void> {
  // Get changed lines for each file
  const changedLines = await git.getChangedLines({
    baseRef,
    extensions: options.extensions,
  });

  if (changedLines.size === 0) {
    if (!options.quiet) {
      console.log('No relevant file changes detected.');
    }
    return;
  }

  const recommendation: FunctionRecommendation = {
    changedFunctions: [],
    summary: {
      functionsChanged: 0,
      testsRecommended: 0,
      scale: changeScale.scale,
    },
  };

  const allRecommendedTests = new Set<string>();

  // For each changed file, find affected symbols
  for (const [filePath, lines] of changedLines) {
    if (lines.length === 0) continue;

    // Get symbols that overlap with changed lines
    const affectedSymbols = db.getSymbolsForLines(filePath, lines);

    for (const symbol of affectedSymbols) {
      // Get tests that cover this symbol
      const tests = db.getTestsForSymbols([symbol.id!]);

      if (tests.length > 0) {
        recommendation.changedFunctions.push({
          name: symbol.name,
          file: filePath,
          lines: `${symbol.startLine}-${symbol.endLine}`,
          tests: tests.map(t => ({
            path: t.testPath,
            coverage: t.coverage,
          })),
        });

        for (const t of tests) {
          allRecommendedTests.add(t.testPath);
        }
      }
    }

    // If no symbols found, fallback to file-level for this file
    if (affectedSymbols.length === 0) {
      const fileTests = db.getTestsForSource(filePath);
      for (const t of fileTests) {
        allRecommendedTests.add(t);
      }
    }
  }

  recommendation.summary.functionsChanged = recommendation.changedFunctions.length;
  recommendation.summary.testsRecommended = allRecommendedTests.size;

  // Output results
  if (options.json) {
    console.log(JSON.stringify(recommendation, null, 2));
  } else {
    outputFunctionResults(recommendation, options);
  }

  const recommendedTests = Array.from(allRecommendedTests).sort();
  writeOutputFile(options, recommendedTests);
}

/**
 * Output function-level results in tree format
 */
function outputFunctionResults(
  recommendation: FunctionRecommendation,
  options: any
): void {
  if (options.quiet) {
    // Just output test names
    const allTests = new Set<string>();
    for (const func of recommendation.changedFunctions) {
      for (const test of func.tests) {
        allTests.add(test.path);
      }
    }
    for (const test of allTests) {
      console.log(test);
    }
    return;
  }

  if (recommendation.changedFunctions.length === 0) {
    console.log('No function-level mappings found for changed code.');
    console.log('Tip: Ensure coverage data includes function information.');
    return;
  }

  console.log('Changed Functions:');

  for (let i = 0; i < recommendation.changedFunctions.length; i++) {
    const func = recommendation.changedFunctions[i];
    const isLast = i === recommendation.changedFunctions.length - 1;
    const prefix = isLast ? '└─' : '├─';

    console.log(`  ${prefix} ${func.name} (${func.file}:${func.lines})`);

    if (func.tests.length > 0) {
      const testsPrefix = isLast ? '   ' : '│  ';
      console.log(`  ${testsPrefix} └─ Affected Tests:`);

      for (let j = 0; j < func.tests.length; j++) {
        const test = func.tests[j];
        const testIsLast = j === func.tests.length - 1;
        const testPrefix = testIsLast ? '└─' : '├─';
        console.log(`  ${testsPrefix}     ${testPrefix} ${test.path} (coverage: ${test.coverage.toFixed(1)}%)`);
      }
    }
  }

  console.log();
  console.log('='.repeat(60));
  console.log(`Summary: ${recommendation.summary.functionsChanged} functions changed → ${recommendation.summary.testsRecommended} unique tests recommended`);

  if (recommendation.summary.scale === 'large') {
    console.log(`\n⚠️  Large-scale change detected. Consider running full test suite.`);
  }
}

/**
 * Output file-level test results
 */
function outputTestResults(
  recommendedTests: string[],
  options: any
): void {
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

/**
 * Write test list to output file
 */
function writeOutputFile(options: any, recommendedTests: string[]): void {
  if (options.output && recommendedTests.length > 0) {
    writeFileSync(options.output, recommendedTests.join('\n') + '\n');
    if (!options.quiet) {
      console.log(`\nTest list written to: ${options.output}`);
    }
  }
}

/**
 * Print summary for file-level analysis
 */
function printSummary(
  changedCount: number,
  testCount: number,
  options: any
): void {
  if (!options.quiet && !options.json) {
    console.log();
    console.log('='.repeat(50));
    console.log(`Summary: ${changedCount} files changed, ${testCount} tests recommended`);
  }
}

program.parse();
