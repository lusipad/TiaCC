#!/usr/bin/env node
/**
 * TiaCC Test Recommender CLI
 *
 * Analyzes Git changes and recommends tests to run based on the impact map.
 * Supports both file-level and function-level precision.
 * Phase 4: Smart recommendations with priority scoring and failure prediction.
 */

import { Command } from 'commander';
import { readFileSync, writeFileSync } from 'fs';
import { initDatabase } from '../database.js';
import { GitUtils } from '../git-utils.js';
import type { FunctionTestMapping } from '../types.js';

// Smart recommendation result type
interface SmartRecommendation {
  testPath: string;
  priorityScore: number;
  failureProbability: number;
  estimatedDurationMs: number | null;
  coverageScore: number;
  recentFailureRate: number;
  reasons: string[];
}

const program = new Command();

interface TestMethod {
  className: string;
  methodName: string;
  fullPath: string;
  coverage: number;
}

interface FunctionRecommendation {
  changedFunctions: Array<{
    name: string;
    file: string;
    lines: string;
    tests: Array<{ path: string; coverage: number }>;
    testMethods: TestMethod[];  // Precise test method recommendations
  }>;
  summary: {
    functionsChanged: number;
    testsRecommended: number;
    testMethodsRecommended: number;  // Count of unique test methods
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
  .option('--methods', 'Output precise test methods (ClassName::methodName) instead of test scripts')
  .option('--group-by-class', 'Group output by test class')
  // Phase 4: Smart recommendation options
  .option('--smart', 'Use smart recommendations with priority scoring and failure prediction')
  .option('--show-probability', 'Show failure probability for each test')
  .option('--show-duration', 'Show estimated duration for each test')
  .option('--top <n>', 'Limit to top N tests by priority score', parseInt)
  .option('--min-probability <p>', 'Only show tests with failure probability >= p (0-1)', parseFloat)
  .option('--flaky', 'Show tests most likely to fail (based on historical data)')
  .action(async (options) => {
    try {
      const git = new GitUtils();
      const level = options.level === 'file' ? 'file' : 'function';

      const db = initDatabase(options.db);

      // Handle --flaky option: show most flaky tests regardless of changes
      if (options.flaky) {
        await runFlakyAnalysis(db, options);
        db.close();
        return;
      }

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

      // Use smart recommendations if --smart option is set
      if (options.smart) {
        await runSmartAnalysis(git, db, baseRef, options);
      } else if (level === 'function') {
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
 * Smart analysis with priority scoring and failure prediction (Phase 4)
 */
async function runSmartAnalysis(
  git: GitUtils,
  db: ReturnType<typeof initDatabase>,
  baseRef: string,
  options: any
): Promise<void> {
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
    return;
  }

  if (!options.quiet && !options.json) {
    console.log(`Changed files (${changedFiles.length}):`);
    const displayFiles = changedFiles.slice(0, 5);
    for (const f of displayFiles) {
      console.log(`  - ${f}`);
    }
    if (changedFiles.length > 5) {
      console.log(`  ... and ${changedFiles.length - 5} more`);
    }
    console.log();
  }

  // Get smart recommendations
  let recommendations = db.getSmartRecommendations(changedFiles);

  // Apply filters
  if (options.minProbability !== undefined) {
    recommendations = recommendations.filter(r => r.failureProbability >= options.minProbability);
  }

  if (options.top !== undefined) {
    recommendations = recommendations.slice(0, options.top);
  }

  // Calculate estimated duration
  const testPaths = recommendations.map(r => r.testPath);
  const duration = db.getEstimatedDuration(testPaths);

  // Output results
  if (options.json) {
    const result = {
      mode: 'smart',
      changedFiles,
      recommendations,
      summary: {
        totalTests: recommendations.length,
        estimatedDurationMs: duration.totalMs,
        estimatedDurationFormatted: formatDuration(duration.totalMs),
      },
    };
    console.log(JSON.stringify(result, null, 2));
  } else if (options.quiet) {
    for (const rec of recommendations) {
      console.log(rec.testPath);
    }
  } else {
    outputSmartResults(recommendations, options, duration);
  }

  // Write output file
  writeOutputFile(options, testPaths);
}

/**
 * Show flaky/unstable tests based on historical data
 */
async function runFlakyAnalysis(
  db: ReturnType<typeof initDatabase>,
  options: any
): Promise<void> {
  const limit = options.top || 10;
  const flakyTests = db.getMostLikelyToFail(limit);

  if (options.json) {
    console.log(JSON.stringify({ flakyTests }, null, 2));
    return;
  }

  if (flakyTests.length === 0) {
    if (!options.quiet) {
      console.log('No test history data available.');
      console.log('Use "tia-recommend record" to record test results first.');
    }
    return;
  }

  if (!options.quiet) {
    console.log('Most Flaky Tests (based on historical data):');
    console.log();
  }

  for (let i = 0; i < flakyTests.length; i++) {
    const test = flakyTests[i];
    if (options.quiet) {
      console.log(test.testPath);
    } else {
      const failureRate = (test.recentFailureRate * 100).toFixed(1);
      const streakInfo = test.failureStreak > 0 ? ` (${test.failureStreak} consecutive failures)` : '';
      console.log(`  ${i + 1}. ${test.testPath}`);
      console.log(`     Recent failure rate: ${failureRate}%${streakInfo}`);
      if (test.lastFailureDate) {
        console.log(`     Last failure: ${test.lastFailureDate}`);
      }
      console.log();
    }
  }

  if (!options.quiet) {
    console.log('='.repeat(60));
    console.log(`Total: ${flakyTests.length} flaky tests identified`);
  }
}

/**
 * Output smart recommendation results
 */
function outputSmartResults(
  recommendations: SmartRecommendation[],
  options: any,
  duration: { totalMs: number; breakdown: Array<{ testPath: string; estimatedMs: number | null }> }
): void {
  if (recommendations.length === 0) {
    console.log('No tests found for changed files.');
    return;
  }

  console.log('Smart Test Recommendations (sorted by priority):');
  console.log();

  for (let i = 0; i < recommendations.length; i++) {
    const rec = recommendations[i];
    const prefix = i === recommendations.length - 1 ? '└─' : '├─';

    // Priority badge
    let priorityBadge = '';
    if (rec.priorityScore >= 70) {
      priorityBadge = ' 🔴 HIGH';
    } else if (rec.priorityScore >= 40) {
      priorityBadge = ' 🟡 MEDIUM';
    } else {
      priorityBadge = ' 🟢 LOW';
    }

    console.log(`  ${prefix} ${rec.testPath}${priorityBadge}`);

    const indent = i === recommendations.length - 1 ? '   ' : '│  ';

    // Show priority score
    console.log(`  ${indent}   Priority Score: ${rec.priorityScore.toFixed(1)}/100`);

    // Show failure probability if requested
    if (options.showProbability || rec.failureProbability > 0.3) {
      const prob = (rec.failureProbability * 100).toFixed(1);
      console.log(`  ${indent}   Failure Probability: ${prob}%`);
    }

    // Show duration if requested
    if (options.showDuration && rec.estimatedDurationMs !== null) {
      console.log(`  ${indent}   Estimated Duration: ${formatDuration(rec.estimatedDurationMs)}`);
    }

    // Show reasons
    if (rec.reasons.length > 0) {
      console.log(`  ${indent}   Reasons: ${rec.reasons.join(', ')}`);
    }

    console.log();
  }

  console.log('='.repeat(60));
  console.log(`Summary: ${recommendations.length} tests recommended`);
  if (duration.totalMs > 0) {
    console.log(`Estimated total duration: ${formatDuration(duration.totalMs)}`);
  }

  // Show smart stats
  const smartStats = recommendations.reduce((acc, r) => {
    if (r.priorityScore >= 70) acc.high++;
    else if (r.priorityScore >= 40) acc.medium++;
    else acc.low++;
    return acc;
  }, { high: 0, medium: 0, low: 0 });

  console.log(`Priority breakdown: ${smartStats.high} high, ${smartStats.medium} medium, ${smartStats.low} low`);
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
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
      testMethodsRecommended: 0,
      scale: changeScale.scale,
    },
  };

  const allRecommendedTests = new Set<string>();
  const allRecommendedMethods = new Map<string, TestMethod>();  // key: className::methodName

  // For each changed file, find affected symbols
  for (const [filePath, lines] of changedLines) {
    if (lines.length === 0) continue;

    // Get symbols that overlap with changed lines
    const affectedSymbols = db.getSymbolsForLines(filePath, lines);

    for (const symbol of affectedSymbols) {
      // Get tests that cover this symbol
      const tests = db.getTestsForSymbols([symbol.id!]);

      if (tests.length > 0) {
        const testMethods: TestMethod[] = [];

        for (const t of tests) {
          allRecommendedTests.add(t.testPath);

          // Parse test path to extract class and method
          const parsed = parseTestPath(t.testPath);
          if (parsed) {
            const methodKey = `${parsed.className}::${parsed.methodName}`;
            if (!allRecommendedMethods.has(methodKey)) {
              const method: TestMethod = {
                className: parsed.className,
                methodName: parsed.methodName,
                fullPath: t.testPath,
                coverage: t.coverage,
              };
              allRecommendedMethods.set(methodKey, method);
              testMethods.push(method);
            } else {
              testMethods.push(allRecommendedMethods.get(methodKey)!);
            }
          }
        }

        recommendation.changedFunctions.push({
          name: symbol.name,
          file: filePath,
          lines: `${symbol.startLine}-${symbol.endLine}`,
          tests: tests.map(t => ({
            path: t.testPath,
            coverage: t.coverage,
          })),
          testMethods,
        });
      }
    }

    // If no symbols found, fallback to file-level for this file
    if (affectedSymbols.length === 0) {
      const fileTests = db.getTestsForSource(filePath);
      for (const t of fileTests) {
        allRecommendedTests.add(t);

        // Parse test path to extract class and method
        const parsed = parseTestPath(t);
        if (parsed) {
          const methodKey = `${parsed.className}::${parsed.methodName}`;
          if (!allRecommendedMethods.has(methodKey)) {
            allRecommendedMethods.set(methodKey, {
              className: parsed.className,
              methodName: parsed.methodName,
              fullPath: t,
              coverage: 0,
            });
          }
        }
      }
    }
  }

  recommendation.summary.functionsChanged = recommendation.changedFunctions.length;
  recommendation.summary.testsRecommended = allRecommendedTests.size;
  recommendation.summary.testMethodsRecommended = allRecommendedMethods.size;

  // Output results
  if (options.json) {
    console.log(JSON.stringify(recommendation, null, 2));
  } else if (options.methods) {
    outputMethodResults(allRecommendedMethods, options);
  } else {
    outputFunctionResults(recommendation, options);
  }

  // Write output file
  if (options.methods) {
    const methodNames = Array.from(allRecommendedMethods.keys()).sort();
    writeOutputFile(options, methodNames);
  } else {
    const recommendedTests = Array.from(allRecommendedTests).sort();
    writeOutputFile(options, recommendedTests);
  }
}

/**
 * Parse test path to extract class name and method name
 * Supports formats:
 * - ClassName::method_name
 * - ClassName.method_name
 * - Test_ClassName__test_methodName (from split command output)
 * - test_method_name (no class)
 */
function parseTestPath(testPath: string): { className: string; methodName: string } | null {
  // Try :: separator first (most common)
  if (testPath.includes('::')) {
    const parts = testPath.split('::');
    return {
      className: parts[0],
      methodName: parts.slice(1).join('::'),
    };
  }

  // Try Test_ClassName__test_methodName format
  const testPattern = /^Test_([^_]+(?:_[^_]+)*)__(.+)$/;
  const testMatch = testPath.match(testPattern);
  if (testMatch) {
    return {
      className: testMatch[1],
      methodName: testMatch[2],
    };
  }

  // Try . separator (for Java/C# style)
  if (testPath.includes('.')) {
    const parts = testPath.split('.');
    // Last part is method, rest is class
    const methodName = parts.pop() || testPath;
    const className = parts.join('.');
    return {
      className: className || 'Default',
      methodName,
    };
  }

  // No separator - treat as method name with default class
  return {
    className: 'Default',
    methodName: testPath,
  };
}

/**
 * Output test methods grouped by class or as flat list
 */
function outputMethodResults(
  methods: Map<string, TestMethod>,
  options: any
): void {
  if (options.quiet) {
    // Just output method names
    for (const key of Array.from(methods.keys()).sort()) {
      console.log(key);
    }
    return;
  }

  if (methods.size === 0) {
    console.log('No test methods found for changed code.');
    return;
  }

  if (options.groupByClass) {
    // Group by class
    const byClass = new Map<string, TestMethod[]>();
    for (const method of methods.values()) {
      if (!byClass.has(method.className)) {
        byClass.set(method.className, []);
      }
      byClass.get(method.className)!.push(method);
    }

    console.log('Recommended Test Methods (by class):');
    const sortedClasses = Array.from(byClass.keys()).sort();

    for (let i = 0; i < sortedClasses.length; i++) {
      const className = sortedClasses[i];
      const classMethods = byClass.get(className)!;
      const isLast = i === sortedClasses.length - 1;
      const prefix = isLast ? '└─' : '├─';

      console.log(`  ${prefix} ${className} (${classMethods.length} methods)`);

      for (let j = 0; j < classMethods.length; j++) {
        const method = classMethods[j];
        const methodIsLast = j === classMethods.length - 1;
        const methodPrefix = methodIsLast ? '└─' : '├─';
        const indentPrefix = isLast ? '   ' : '│  ';
        const coverageStr = method.coverage > 0 ? ` (${method.coverage.toFixed(1)}%)` : '';
        console.log(`  ${indentPrefix}  ${methodPrefix} ${method.methodName}${coverageStr}`);
      }
    }
  } else {
    // Flat list
    console.log('Recommended Test Methods:');
    const sortedMethods = Array.from(methods.values()).sort((a, b) =>
      `${a.className}::${a.methodName}`.localeCompare(`${b.className}::${b.methodName}`)
    );

    for (const method of sortedMethods) {
      const coverageStr = method.coverage > 0 ? ` (${method.coverage.toFixed(1)}%)` : '';
      console.log(`  - ${method.className}::${method.methodName}${coverageStr}`);
    }
  }

  console.log();
  console.log('='.repeat(60));
  console.log(`Summary: ${methods.size} unique test methods recommended`);
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

// ============ Record subcommand (Phase 4) ============

program
  .command('record')
  .description('Record test execution results for smart recommendations')
  .option('-d, --db <path>', 'Impact map database path', 'impact_map.db')
  .option('-t, --test <name>', 'Test name/path')
  .option('-p, --passed', 'Mark test as passed')
  .option('-f, --failed', 'Mark test as failed')
  .option('--duration <ms>', 'Test duration in milliseconds', parseInt)
  .option('--commit <hash>', 'Git commit hash')
  .option('--changed-files <files...>', 'Changed files for this run')
  .option('--from-file <path>', 'Read test results from JSON file')
  .option('--from-junit <path>', 'Read test results from JUnit XML file')
  .option('-v, --verbose', 'Show detailed output')
  .action((options) => {
    try {
      const db = initDatabase(options.db);

      // Read from file if specified
      if (options.fromFile) {
        recordFromJsonFile(db, options.fromFile, options);
      } else if (options.fromJunit) {
        recordFromJunitFile(db, options.fromJunit, options);
      } else if (options.test) {
        // Record single test
        const passed = options.passed === true || options.failed !== true;
        db.recordTestResult(
          options.test,
          passed,
          options.duration,
          options.commit,
          options.changedFiles
        );
        if (options.verbose) {
          console.log(`Recorded: ${options.test} - ${passed ? 'PASSED' : 'FAILED'}`);
        }
      } else {
        console.error('Error: Specify --test, --from-file, or --from-junit');
        process.exit(1);
      }

      db.close();
    } catch (error) {
      console.error(`Error: ${error}`);
      process.exit(1);
    }
  });

/**
 * Record test results from JSON file
 * Expected format:
 * {
 *   "commitHash": "abc123",
 *   "changedFiles": ["file1.ts", "file2.ts"],
 *   "results": [
 *     { "testPath": "test1", "passed": true, "durationMs": 100 },
 *     { "testPath": "test2", "passed": false, "durationMs": 200 }
 *   ]
 * }
 */
function recordFromJsonFile(
  db: ReturnType<typeof initDatabase>,
  filePath: string,
  options: any
): void {
  const content = readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);

  const results = data.results || [];
  const commitHash = data.commitHash || options.commit;
  const changedFiles = data.changedFiles || options.changedFiles;

  db.batchRecordTestResults(results, commitHash, changedFiles);

  if (options.verbose) {
    const passed = results.filter((r: any) => r.passed).length;
    const failed = results.length - passed;
    console.log(`Recorded ${results.length} test results (${passed} passed, ${failed} failed)`);
  }
}

/**
 * Record test results from JUnit XML file
 */
function recordFromJunitFile(
  db: ReturnType<typeof initDatabase>,
  filePath: string,
  options: any
): void {
  const content = readFileSync(filePath, 'utf-8');

  // Simple JUnit XML parsing
  const results: Array<{ testPath: string; passed: boolean; durationMs?: number }> = [];

  // Parse testcase elements
  const testcaseRegex = /<testcase\s+(?:[^>]*?\s)?name="([^"]+)"(?:\s+classname="([^"]+)")?(?:\s+time="([^"]+)")?[^>]*>([\s\S]*?)<\/testcase>|<testcase\s+(?:[^>]*?\s)?name="([^"]+)"(?:\s+classname="([^"]+)")?(?:\s+time="([^"]+)")?[^>]*\/>/g;

  let match;
  while ((match = testcaseRegex.exec(content)) !== null) {
    const name = match[1] || match[5];
    const className = match[2] || match[6] || '';
    const time = match[3] || match[7];
    const body = match[4] || '';

    const testPath = className ? `${className}::${name}` : name;
    const passed = !body.includes('<failure') && !body.includes('<error');
    const durationMs = time ? Math.round(parseFloat(time) * 1000) : undefined;

    results.push({ testPath, passed, durationMs });
  }

  if (results.length === 0) {
    console.error('No test cases found in JUnit XML file');
    return;
  }

  db.batchRecordTestResults(results, options.commit, options.changedFiles);

  if (options.verbose) {
    const passed = results.filter(r => r.passed).length;
    const failed = results.length - passed;
    console.log(`Recorded ${results.length} test results from JUnit XML (${passed} passed, ${failed} failed)`);
  }
}

// ============ Stats subcommand (Phase 4) ============

program
  .command('stats')
  .description('Show smart recommendation statistics')
  .option('-d, --db <path>', 'Impact map database path', 'impact_map.db')
  .option('--json', 'Output as JSON')
  .action((options) => {
    try {
      const db = initDatabase(options.db);
      const stats = db.getSmartStats();

      if (options.json) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log('Smart Recommendation Statistics:');
        console.log();
        console.log(`  Tests with history:     ${stats.testsWithHistory}`);
        console.log(`  Total history records:  ${stats.totalHistoryRecords}`);
        console.log(`  Failure correlations:   ${stats.correlationsTracked}`);
        console.log(`  Average failure rate:   ${(stats.avgFailureRate * 100).toFixed(1)}%`);
      }

      db.close();
    } catch (error) {
      console.error(`Error: ${error}`);
      process.exit(1);
    }
  });

program.parse();
