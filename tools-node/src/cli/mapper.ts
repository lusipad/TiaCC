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
import * as fs from 'fs';
import * as path from 'path';
import { initDatabase } from '../database.js';
import { CppCoverageParser, CSharpCoverageParser, LlvmJsonCoverageParser, CoberturaCoverageParser, OpenCppCoverageParser } from '../coverage-parser.js';
import type { CoberturaParserOptions, OpenCppCoverageOptions } from '../coverage-parser.js';
import { GitUtils } from '../git-utils.js';

const program = new Command();

/**
 * Process items in parallel with concurrency limit
 */
async function parallelProcess<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await processor(items[index], index);
    }
  }

  // Start workers up to concurrency limit
  const workers = Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(() => worker());

  await Promise.all(workers);
  return results;
}

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
  .option('-b, --base-path <path>', 'Base path to strip from source file paths (for portable paths)')
  .option('--commit <hash>', 'Git commit hash to associate with this run')
  .option('-j, --concurrency <num>', 'Number of parallel workers for processing', '4')
  .option('-v, --verbose', 'Enable verbose output')
  .option('--test-id-from-env <varName>', 'Read testId from environment variable (for Cobertura files)')
  .option('--test-id-from-source', 'Read testId from <source> tag in Cobertura XML (for LuaUnit integration)')
  .option('--test-id-from-filename', 'Parse testId from filename format: Test_ClassName__test_methodName.cobertura.xml')
  .option('--opencppcoverage', 'Enable OpenCppCoverage format support (CoverageReport*.xml)')
  .option('--opencppcoverage-pattern <pattern>', 'Glob pattern for OpenCppCoverage files', 'CoverageReport*.xml')
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

      // Path normalization helper
      const basePath = options.basePath
        ? path.resolve(options.basePath).replace(/\\/g, '/')
        : null;

      const normalizePath = (filePath: string): string => {
        let normalized = filePath.replace(/\\/g, '/');
        if (basePath && normalized.startsWith(basePath)) {
          normalized = normalized.slice(basePath.length);
          if (normalized.startsWith('/')) {
            normalized = normalized.slice(1);
          }
        }
        return normalized;
      };

      // Find all coverage files
      spinner.text = 'Scanning for coverage files...';

      const profrawFiles = await glob('*.profraw', { cwd: options.coverageDir });
      const llvmJsonFiles = await glob('*.cov.json', { cwd: options.coverageDir });  // Pre-processed LLVM JSON
      const coverletFiles = await glob('*.coverage.json', { cwd: options.coverageDir });
      // Cobertura XML files: *.cobertura.xml or *coverage*.xml
      const coberturaFiles = await glob('*.{cobertura.xml,coverage.xml}', { cwd: options.coverageDir });
      // Also match files like coverage_TestName.xml
      const coberturaXmlFiles = await glob('*coverage*.xml', { cwd: options.coverageDir });
      // Merge and deduplicate Cobertura files
      const allCoberturaFiles = [...new Set([...coberturaFiles, ...coberturaXmlFiles])];

      // OpenCppCoverage files
      let openCppCoverageFiles: string[] = [];
      if (options.opencppcoverage) {
        openCppCoverageFiles = await glob(options.opencppcoveragePattern, { cwd: options.coverageDir });
        // Also search in subdirectories (OpenCppCoverage creates CoverageReport-* directories)
        const subDirFiles = await glob('**/CoverageReport*/*.xml', { cwd: options.coverageDir });
        openCppCoverageFiles = [...new Set([...openCppCoverageFiles, ...subDirFiles])];
        // Exclude from Cobertura files to avoid double processing
        const openCppSet = new Set(openCppCoverageFiles);
        const filteredCoberturaFiles = allCoberturaFiles.filter(f => !openCppSet.has(f));
        allCoberturaFiles.length = 0;
        allCoberturaFiles.push(...filteredCoberturaFiles);
      }

      spinner.info(`Found ${profrawFiles.length} C++ profraw files`);
      spinner.info(`Found ${llvmJsonFiles.length} LLVM JSON files`);
      spinner.info(`Found ${coverletFiles.length} C# coverage files`);
      spinner.info(`Found ${allCoberturaFiles.length} Cobertura XML files`);
      if (options.opencppcoverage) {
        spinner.info(`Found ${openCppCoverageFiles.length} OpenCppCoverage files`);
      }

      const totalFiles = profrawFiles.length + llvmJsonFiles.length + coverletFiles.length + allCoberturaFiles.length + openCppCoverageFiles.length;
      if (totalFiles === 0) {
        spinner.warn('No coverage files found.');
        db.close();
        return;
      }

      // Initialize parsers
      const cppParser = new CppCoverageParser({ executable: options.executable });
      const csharpParser = new CSharpCoverageParser();

      const totalSources = new Set<string>();
      let totalTests = 0;

      let totalSymbols = 0;

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

            // File-level mappings
            for (const sourcePath of data.coveredFiles) {
              const sourceId = db.upsertSourceFile(sourcePath);
              db.addCoverageMapping(sourceId, testId);
              totalSources.add(sourcePath);
            }

            // Symbol-level mappings (functions/methods)
            if (data.coveredSymbols && data.coveredSymbols.length > 0) {
              for (const sym of data.coveredSymbols) {
                const sourceId = db.upsertSourceFile(sym.filePath);
                const symbolId = db.upsertSymbol(
                  sourceId,
                  sym.name,
                  sym.startLine,
                  sym.endLine,
                  sym.type
                );
                db.addSymbolCoverage(
                  symbolId,
                  testId,
                  sym.hitCount,
                  sym.lineCoveragePct ?? 0
                );
                totalSymbols++;
              }
            }

            if (options.verbose) {
              const symCount = data.coveredSymbols?.length ?? 0;
              console.log(`  ${data.testId}: ${data.coveredFiles.length} files, ${symCount} symbols`);
            }
          }
        }

        spinner.succeed(`Processed ${profrawFiles.length} C++ coverage files`);
      }

      // Process pre-processed LLVM JSON coverage files
      if (llvmJsonFiles.length > 0) {
        spinner.start('Processing LLVM JSON coverage files...');
        const llvmJsonParser = new LlvmJsonCoverageParser();

        for (let i = 0; i < llvmJsonFiles.length; i++) {
          const file = llvmJsonFiles[i];
          spinner.text = `Processing LLVM JSON [${i + 1}/${llvmJsonFiles.length}]: ${file}`;

          const coveragePath = `${options.coverageDir}/${file}`;
          const data = await llvmJsonParser.parse(coveragePath);

          if (data) {
            totalTests++;
            const testId = db.upsertTestScript(data.testId);

            // File-level mappings with coverage percentage
            for (const sourcePath of data.coveredFiles) {
              const normalizedPath = normalizePath(sourcePath);
              const sourceId = db.upsertSourceFile(normalizedPath);
              // Get coverage percentage for this file
              const coveragePct = data.fileCoverage?.get(sourcePath) ?? 0;
              db.addCoverageMapping(sourceId, testId, coveragePct);
              totalSources.add(normalizedPath);
            }

            // Symbol-level mappings (functions/methods)
            if (data.coveredSymbols && data.coveredSymbols.length > 0) {
              for (const sym of data.coveredSymbols) {
                const normalizedPath = normalizePath(sym.filePath);
                const sourceId = db.upsertSourceFile(normalizedPath);
                const symbolId = db.upsertSymbol(
                  sourceId,
                  sym.name,
                  sym.startLine,
                  sym.endLine,
                  sym.type
                );
                db.addSymbolCoverage(
                  symbolId,
                  testId,
                  sym.hitCount,
                  sym.lineCoveragePct ?? 0
                );
                totalSymbols++;
              }
            }

            if (options.verbose) {
              const symCount = data.coveredSymbols?.length ?? 0;
              console.log(`  ${data.testId}: ${data.coveredFiles.length} files, ${symCount} symbols`);
            }
          }
        }

        spinner.succeed(`Processed ${llvmJsonFiles.length} LLVM JSON coverage files`);
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

            // File-level mappings
            for (const sourcePath of data.coveredFiles) {
              const sourceId = db.upsertSourceFile(sourcePath);
              db.addCoverageMapping(sourceId, testId, coveragePct);
              totalSources.add(sourcePath);
            }

            // Symbol-level mappings (classes/methods)
            if (data.coveredSymbols && data.coveredSymbols.length > 0) {
              for (const sym of data.coveredSymbols) {
                const sourceId = db.upsertSourceFile(sym.filePath);
                const symbolId = db.upsertSymbol(
                  sourceId,
                  sym.name,
                  sym.startLine,
                  sym.endLine,
                  sym.type
                );
                db.addSymbolCoverage(
                  symbolId,
                  testId,
                  sym.hitCount,
                  sym.lineCoveragePct ?? 0
                );
                totalSymbols++;
              }
            }

            if (options.verbose) {
              const symCount = data.coveredSymbols?.length ?? 0;
              console.log(`  ${data.testId}: ${data.coveredFiles.length} files, ${symCount} symbols`);
            }
          }
        }

        spinner.succeed(`Processed ${coverletFiles.length} C# coverage files`);
      }

      // Process Cobertura XML coverage files
      if (allCoberturaFiles.length > 0) {
        spinner.start('Processing Cobertura XML coverage files...');

        // Build Cobertura parser options from CLI flags
        const coberturaOptions: CoberturaParserOptions = {
          testIdFromEnv: options.testIdFromEnv,
          testIdFromSource: options.testIdFromSource,
          testIdFromFilename: options.testIdFromFilename,
        };
        const coberturaParser = new CoberturaCoverageParser(coberturaOptions);

        for (let i = 0; i < allCoberturaFiles.length; i++) {
          const file = allCoberturaFiles[i];
          spinner.text = `Processing Cobertura [${i + 1}/${allCoberturaFiles.length}]: ${file}`;

          const coveragePath = `${options.coverageDir}/${file}`;
          const data = await coberturaParser.parse(coveragePath);

          if (data) {
            totalTests++;
            const testId = db.upsertTestScript(data.testId);

            const coveragePct = data.totalLines > 0
              ? (data.coveredLines / data.totalLines) * 100
              : 0;

            // File-level mappings
            for (const sourcePath of data.coveredFiles) {
              const normalizedPath = normalizePath(sourcePath);
              const sourceId = db.upsertSourceFile(normalizedPath);
              // Get coverage percentage for this file
              const fileCoveragePct = data.fileCoverage?.get(sourcePath) ?? coveragePct;
              db.addCoverageMapping(sourceId, testId, fileCoveragePct);
              totalSources.add(normalizedPath);
            }

            // Symbol-level mappings (classes/methods)
            if (data.coveredSymbols && data.coveredSymbols.length > 0) {
              for (const sym of data.coveredSymbols) {
                const normalizedPath = normalizePath(sym.filePath);
                const sourceId = db.upsertSourceFile(normalizedPath);
                const symbolId = db.upsertSymbol(
                  sourceId,
                  sym.name,
                  sym.startLine,
                  sym.endLine,
                  sym.type
                );
                db.addSymbolCoverage(
                  symbolId,
                  testId,
                  sym.hitCount,
                  sym.lineCoveragePct ?? 0
                );
                totalSymbols++;
              }
            }

            if (options.verbose) {
              const symCount = data.coveredSymbols?.length ?? 0;
              console.log(`  ${data.testId}: ${data.coveredFiles.length} files, ${symCount} symbols`);
            }
          }
        }

        spinner.succeed(`Processed ${allCoberturaFiles.length} Cobertura XML coverage files`);
      }

      // Process OpenCppCoverage files
      if (openCppCoverageFiles.length > 0) {
        spinner.start('Processing OpenCppCoverage files...');

        // Build OpenCppCoverage parser options
        const openCppOptions: OpenCppCoverageOptions = {
          testIdFromFilename: options.testIdFromFilename,
          basePath: options.basePath,
        };
        const openCppParser = new OpenCppCoverageParser(openCppOptions);

        for (let i = 0; i < openCppCoverageFiles.length; i++) {
          const file = openCppCoverageFiles[i];
          spinner.text = `Processing OpenCppCoverage [${i + 1}/${openCppCoverageFiles.length}]: ${file}`;

          const coveragePath = `${options.coverageDir}/${file}`;
          const data = await openCppParser.parse(coveragePath);

          if (data) {
            totalTests++;
            const testId = db.upsertTestScript(data.testId);

            const coveragePct = data.totalLines > 0
              ? (data.coveredLines / data.totalLines) * 100
              : 0;

            // File-level mappings
            for (const sourcePath of data.coveredFiles) {
              const normalizedPath = normalizePath(sourcePath);
              const sourceId = db.upsertSourceFile(normalizedPath);
              const fileCoveragePct = data.fileCoverage?.get(sourcePath) ?? coveragePct;
              db.addCoverageMapping(sourceId, testId, fileCoveragePct);
              totalSources.add(normalizedPath);
            }

            // Symbol-level mappings (classes/methods)
            if (data.coveredSymbols && data.coveredSymbols.length > 0) {
              for (const sym of data.coveredSymbols) {
                const normalizedPath = normalizePath(sym.filePath);
                const sourceId = db.upsertSourceFile(normalizedPath);
                const symbolId = db.upsertSymbol(
                  sourceId,
                  sym.name,
                  sym.startLine,
                  sym.endLine,
                  sym.type
                );
                db.addSymbolCoverage(
                  symbolId,
                  testId,
                  sym.hitCount,
                  sym.lineCoveragePct ?? 0
                );
                totalSymbols++;
              }
            }

            if (options.verbose) {
              const symCount = data.coveredSymbols?.length ?? 0;
              console.log(`  ${data.testId}: ${data.coveredFiles.length} files, ${symCount} symbols`);
            }
          }
        }

        spinner.succeed(`Processed ${openCppCoverageFiles.length} OpenCppCoverage files`);
      }

      // Record run metadata
      db.recordCoverageRun(totalTests, totalSources.size, commit ?? undefined);

      // Print summary
      const stats = db.getStats();
      console.log('\n' + '='.repeat(50));
      console.log('Build Complete!');
      console.log(`  Source files: ${stats.sourceFiles}`);
      console.log(`  Test scripts: ${stats.testScripts}`);
      console.log(`  File mappings: ${stats.mappings}`);
      console.log(`  Symbol mappings: ${totalSymbols}`);
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

program
  .command('export')
  .description('Export database to JSON for visualization dashboard')
  .option('-d, --db <path>', 'Database path', 'impact_map.db')
  .option('-o, --output <dir>', 'Output directory for JSON files', './dashboard/data')
  .action((options) => {
    const spinner = ora('Exporting data...').start();

    try {
      const db = initDatabase(options.db);

      // Create output directory
      if (!fs.existsSync(options.output)) {
        fs.mkdirSync(options.output, { recursive: true });
      }

      // Export statistics
      spinner.text = 'Exporting statistics...';
      const stats = db.getStats();
      const latestRun = db.getLatestRun();
      const runs = db.getAllRuns();

      const statsData = {
        ...stats,
        latestRun,
        runHistory: runs,
        exportedAt: new Date().toISOString(),
      };
      fs.writeFileSync(
        path.join(options.output, 'stats.json'),
        JSON.stringify(statsData, null, 2)
      );

      // Export source files
      spinner.text = 'Exporting source files...';
      const sourceFiles = db.getAllSourceFiles();
      fs.writeFileSync(
        path.join(options.output, 'source-files.json'),
        JSON.stringify(sourceFiles, null, 2)
      );

      // Export test scripts
      spinner.text = 'Exporting test scripts...';
      const testScripts = db.getAllTestScripts();
      fs.writeFileSync(
        path.join(options.output, 'test-scripts.json'),
        JSON.stringify(testScripts, null, 2)
      );

      // Export mappings
      spinner.text = 'Exporting coverage mappings...';
      const mappings = db.getAllMappings();
      fs.writeFileSync(
        path.join(options.output, 'mappings.json'),
        JSON.stringify(mappings, null, 2)
      );

      // Export directory coverage (for treemap)
      spinner.text = 'Exporting directory coverage...';
      const dirCoverage = db.getCoverageByDirectory();
      fs.writeFileSync(
        path.join(options.output, 'directory-coverage.json'),
        JSON.stringify(dirCoverage, null, 2)
      );

      // Export symbols (function-level data)
      spinner.text = 'Exporting symbols...';
      const symbols = db.getAllSymbols();
      const symbolStats = db.getSymbolStats();

      // Build symbol -> tests mapping for export
      const symbolMappings: Array<{
        symbolId: number;
        symbolName: string;
        sourceFile: string;
        startLine: number;
        endLine: number;
        type: string;
        tests: Array<{ testPath: string; coverage: number }>;
      }> = [];

      for (const sym of symbols) {
        const sourceFile = sourceFiles.find(sf => sf.id === sym.sourceFileId);
        if (sourceFile) {
          const tests = db.getTestsForSymbols([sym.id!]);
          symbolMappings.push({
            symbolId: sym.id!,
            symbolName: sym.name,
            sourceFile: sourceFile.filePath,
            startLine: sym.startLine,
            endLine: sym.endLine,
            type: sym.type,
            tests: tests.map(t => ({ testPath: t.testPath, coverage: t.coverage })),
          });
        }
      }

      fs.writeFileSync(
        path.join(options.output, 'symbols.json'),
        JSON.stringify({
          symbols: symbolMappings,
          stats: symbolStats,
        }, null, 2)
      );

      // Build graph data for D3 force-directed graph
      spinner.text = 'Building graph data...';
      const nodes: Array<{
        id: string;
        type: 'source' | 'test' | 'function';
        label: string;
        parent?: string;
        startLine?: number;
        endLine?: number;
      }> = [];
      const links: Array<{ source: string; target: string; coverage: number }> = [];

      // Add source file nodes
      for (const sf of sourceFiles) {
        const fileName = sf.filePath.split(/[/\\]/).pop() || sf.filePath;
        nodes.push({ id: `source:${sf.id}`, type: 'source', label: fileName });
      }

      // Add test script nodes
      for (const ts of testScripts) {
        const testName = ts.scriptPath.split(/[/\\]/).pop() || ts.scriptPath;
        nodes.push({ id: `test:${ts.id}`, type: 'test', label: testName });
      }

      // Build source/test ID lookup maps
      const sourceIdMap = new Map(sourceFiles.map(sf => [sf.filePath, sf.id]));
      const testIdMap = new Map(testScripts.map(ts => [ts.scriptPath, ts.id]));

      // Add function nodes from symbol mappings
      const addedFunctions = new Set<string>();
      for (const sym of symbolMappings) {
        const funcId = `func:${sym.symbolId}`;
        const sourceId = sourceIdMap.get(sym.sourceFile);

        if (!addedFunctions.has(funcId) && sourceId !== undefined) {
          addedFunctions.add(funcId);
          nodes.push({
            id: funcId,
            type: 'function' as const,
            label: sym.symbolName,
            parent: `source:${sourceId}`, // Link to parent node ID
            startLine: sym.startLine,
            endLine: sym.endLine,
          });
        }
      }

      // Add links
      for (const m of mappings) {
        const sourceId = sourceIdMap.get(m.sourceFile);
        const testId = testIdMap.get(m.testScript);
        if (sourceId !== undefined && testId !== undefined) {
          links.push({
            source: `source:${sourceId}`,
            target: `test:${testId}`,
            coverage: m.lineCoveragePct,
          });
        }
      }

      // Add function-level links (function -> test)
      for (const sym of symbolMappings) {
        for (const test of sym.tests) {
          const testId = testIdMap.get(test.testPath);
          if (testId !== undefined) {
            links.push({
              source: `func:${sym.symbolId}`,
              target: `test:${testId}`,
              coverage: test.coverage,
            });
          }
        }
      }

      const graphData = { nodes, links };
      fs.writeFileSync(
        path.join(options.output, 'graph.json'),
        JSON.stringify(graphData, null, 2)
      );

      db.close();

      spinner.succeed(`Data exported to ${options.output}/`);
      console.log('  - stats.json');
      console.log('  - source-files.json');
      console.log('  - test-scripts.json');
      console.log('  - mappings.json');
      console.log('  - directory-coverage.json');
      console.log('  - symbols.json');
      console.log('  - graph.json');

    } catch (error) {
      spinner.fail(`Error: ${error}`);
      process.exit(1);
    }
  });

program.parse();
