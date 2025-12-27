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

program.parse();
