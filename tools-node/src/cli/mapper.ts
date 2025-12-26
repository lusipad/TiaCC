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
      const nodes: Array<{ id: string; type: 'source' | 'test' | 'function'; label: string; parent?: string }> = [];
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
