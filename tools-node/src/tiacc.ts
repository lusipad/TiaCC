/**
 * TiaCC - High-level API for external integration
 *
 * This module provides a simplified interface for integrating TiaCC
 * into external projects. It wraps the lower-level components into
 * an easy-to-use API.
 *
 * @example
 * ```typescript
 * import { TiaCC } from '@tiacc/tools';
 *
 * // Initialize
 * const tia = await TiaCC.init('./impact_map.db');
 *
 * // Build mapping (in nightly CI)
 * await tia.buildMapping('./coverage');
 *
 * // Get affected tests (in PR check)
 * const result = await tia.getAffectedTests({ baseBranch: 'origin/main' });
 * console.log(result.tests);
 * ```
 */

import { TiaDatabase, initDatabase } from './database.js';
import { getParserForFile, CoverageParser, LlvmJsonCoverageParser, CSharpCoverageParser } from './coverage-parser.js';
import { GitUtils } from './git-utils.js';
import { SymbolExtractor } from './symbol-extractor.js';
import { TiaError, ConfigError } from './errors.js';
import { glob } from 'glob';
import { existsSync, statSync } from 'fs';
import { resolve, basename, extname } from 'path';
import type { DbStats } from './types.js';

/**
 * Configuration options for TiaCC
 */
export interface TiaCCConfig {
  /** Path to the SQLite database file */
  dbPath: string;
  /** Working directory for git operations */
  workDir?: string;
  /** File extensions to consider as source files */
  sourceExtensions?: string[];
  /** Enable verbose logging */
  verbose?: boolean;
  /** Callback for log messages */
  onLog?: (message: string, level: 'info' | 'warn' | 'error') => void;
}

/**
 * Options for building the mapping database
 */
export interface BuildMappingOptions {
  /** Path to coverage data directory */
  coverageDir: string;
  /** Path to executable for llvm-cov (optional) */
  executable?: string;
  /** Git commit hash to record */
  commitHash?: string;
  /** Number of concurrent file processing */
  concurrency?: number;
  /** Clear existing mappings before building */
  clean?: boolean;
}

/**
 * Options for getting affected tests
 */
export interface GetAffectedTestsOptions {
  /** Base branch/ref to compare against */
  baseBranch?: string;
  /** Analysis level: 'file' or 'function' */
  level?: 'file' | 'function';
  /** Include untracked files in analysis */
  includeUntracked?: boolean;
}

/**
 * Result of affected tests analysis
 */
export interface AffectedTestsResult {
  /** List of affected test paths */
  tests: string[];
  /** Changed files that triggered the tests */
  changedFiles: string[];
  /** Total number of tests in the database */
  totalTests: number;
  /** Percentage of tests saved */
  savingsPercent: number;
  /** Analysis level used */
  level: 'file' | 'function';
  /** Details about the analysis */
  details?: {
    /** Changed symbols (functions) if using function-level analysis */
    changedSymbols?: string[];
    /** Tests per changed file */
    testsPerFile?: Record<string, string[]>;
  };
}

/**
 * TiaCC - Test Impact Analysis for Code Coverage
 *
 * High-level API for external integration. Provides a simplified interface
 * for building coverage mappings and getting affected tests.
 */
export class TiaCC {
  private db: TiaDatabase;
  private gitUtils: GitUtils;
  private config: TiaCCConfig;

  private constructor(config: TiaCCConfig) {
    this.config = {
      sourceExtensions: ['.cpp', '.cc', '.cxx', '.c', '.h', '.hpp', '.cs'],
      verbose: false,
      ...config,
    };
    this.db = initDatabase(config.dbPath);
    this.gitUtils = new GitUtils(config.workDir);
  }

  /**
   * Initialize TiaCC with the given configuration
   *
   * @param dbPathOrConfig - Path to database file or full configuration object
   * @returns Initialized TiaCC instance
   *
   * @example
   * ```typescript
   * // Simple initialization
   * const tia = await TiaCC.init('./impact_map.db');
   *
   * // With options
   * const tia = await TiaCC.init({
   *   dbPath: './impact_map.db',
   *   workDir: './my-project',
   *   verbose: true,
   * });
   * ```
   */
  static async init(dbPathOrConfig: string | TiaCCConfig): Promise<TiaCC> {
    const config = typeof dbPathOrConfig === 'string'
      ? { dbPath: dbPathOrConfig }
      : dbPathOrConfig;

    if (!config.dbPath) {
      throw new ConfigError('Database path is required');
    }

    const instance = new TiaCC(config);

    // Verify git repository
    const isGitRepo = await instance.gitUtils.isGitRepo();
    if (!isGitRepo && config.workDir) {
      instance.log('warn', `Warning: ${config.workDir} is not a git repository`);
    }

    return instance;
  }

  /**
   * Build the coverage mapping database from coverage data
   *
   * This should typically be run in a nightly CI job after running
   * all tests with coverage enabled.
   *
   * @param options - Build options
   *
   * @example
   * ```typescript
   * await tia.buildMapping({
   *   coverageDir: './coverage',
   *   executable: './build/myapp',
   *   commitHash: 'abc123',
   * });
   * ```
   */
  async buildMapping(options: BuildMappingOptions | string): Promise<{
    sourceFiles: number;
    testScripts: number;
    mappings: number;
    duration: number;
  }> {
    const opts = typeof options === 'string'
      ? { coverageDir: options }
      : options;

    const startTime = Date.now();

    if (!existsSync(opts.coverageDir)) {
      throw new ConfigError(`Coverage directory not found: ${opts.coverageDir}`);
    }

    this.log('info', `Building mapping from: ${opts.coverageDir}`);

    // Find coverage files
    const coverageFiles = await this.findCoverageFiles(opts.coverageDir);

    if (coverageFiles.length === 0) {
      throw new ConfigError(`No coverage files found in: ${opts.coverageDir}`);
    }

    this.log('info', `Found ${coverageFiles.length} coverage files`);

    // Process each coverage file
    let mappingsCreated = 0;
    const symbolExtractor = new SymbolExtractor();

    for (const covFile of coverageFiles) {
      try {
        const parser = getParserForFile(covFile);
        if (!parser) {
          this.log('warn', `No parser for: ${covFile}`);
          continue;
        }

        const coverageData = await parser.parse(covFile);
        if (!coverageData) {
          continue;
        }

        // Extract test name from coverage file
        const testName = this.extractTestName(covFile);
        const testId = this.db.upsertTestScript(testName);

        // Process each covered source file
        const coveragePct = coverageData.totalLines > 0
          ? (coverageData.coveredLines / coverageData.totalLines) * 100
          : 0;

        for (const sourcePath of coverageData.coveredFiles) {
          const sourceId = this.db.upsertSourceFile(sourcePath);

          // Add file-level mapping with coverage percentage
          const fileCoveragePct = coverageData.fileCoverage?.get(sourcePath) ?? coveragePct;
          this.db.addCoverageMapping(sourceId, testId, fileCoveragePct);
          mappingsCreated++;
        }

        // Process symbol-level coverage
        if (coverageData.coveredSymbols && coverageData.coveredSymbols.length > 0) {
          for (const sym of coverageData.coveredSymbols) {
            const sourceId = this.db.upsertSourceFile(sym.filePath);
            const symbolId = this.db.upsertSymbol(
              sourceId,
              sym.name,
              sym.startLine,
              sym.endLine,
              sym.type
            );

            if (sym.hitCount > 0) {
              this.db.addSymbolCoverage(symbolId, testId, sym.hitCount, sym.lineCoveragePct ?? 0);
            }
          }
        }
      } catch (error) {
        this.log('warn', `Error processing ${covFile}: ${error}`);
      }
    }

    // Record the coverage run
    const stats = this.db.getStats();
    this.db.recordCoverageRun(
      stats.testScripts,
      stats.sourceFiles,
      opts.commitHash
    );

    const duration = Date.now() - startTime;

    this.log('info', `Mapping complete: ${stats.sourceFiles} sources, ${stats.testScripts} tests, ${mappingsCreated} mappings`);

    return {
      sourceFiles: stats.sourceFiles,
      testScripts: stats.testScripts,
      mappings: mappingsCreated,
      duration,
    };
  }

  /**
   * Get the list of tests affected by recent changes
   *
   * This should be run in PR/MR checks to determine which tests to run.
   *
   * @param options - Options for affected test analysis
   * @returns Result containing affected tests and statistics
   *
   * @example
   * ```typescript
   * const result = await tia.getAffectedTests({
   *   baseBranch: 'origin/main',
   *   level: 'function',
   * });
   *
   * console.log(`Running ${result.tests.length} tests (saving ${result.savingsPercent}%)`);
   * for (const test of result.tests) {
   *   console.log(`  - ${test}`);
   * }
   * ```
   */
  async getAffectedTests(options: GetAffectedTestsOptions = {}): Promise<AffectedTestsResult> {
    const {
      baseBranch = 'HEAD~1',
      level = 'file',
      includeUntracked = false,
    } = options;

    this.log('info', `Analyzing changes against: ${baseBranch}`);

    // Get changed files
    const changedFiles = await this.gitUtils.getChangedFiles({
      baseRef: baseBranch,
      includeUntracked,
      extensions: this.config.sourceExtensions,
    });

    if (changedFiles.length === 0) {
      this.log('info', 'No source files changed');
      return this.createEmptyResult(level);
    }

    this.log('info', `Changed files: ${changedFiles.join(', ')}`);

    let affectedTests: string[];
    let details: AffectedTestsResult['details'];

    if (level === 'function') {
      // Function-level analysis
      const changedLines = await this.gitUtils.getChangedLines({
        baseRef: baseBranch,
        extensions: this.config.sourceExtensions,
      });

      const changedSymbols: string[] = [];
      const allSymbolIds: number[] = [];

      for (const [filePath, lines] of changedLines) {
        const symbols = this.db.getSymbolsForLines(filePath, lines);
        for (const symbol of symbols) {
          changedSymbols.push(`${symbol.name} (${basename(filePath)}:${symbol.startLine})`);
          if (symbol.id !== undefined) {
            allSymbolIds.push(symbol.id);
          }
        }
      }

      if (allSymbolIds.length > 0) {
        const symbolTests = this.db.getTestsForSymbols(allSymbolIds);
        affectedTests = [...new Set(symbolTests.map(t => t.testPath))];
        details = { changedSymbols };
      } else {
        // Fall back to file-level if no symbols found
        affectedTests = this.db.getTestsForSources(changedFiles);
      }
    } else {
      // File-level analysis
      affectedTests = this.db.getTestsForSources(changedFiles);
    }

    const stats = this.db.getStats();
    const totalTests = stats.testScripts;
    const savingsPercent = totalTests > 0
      ? Math.round(((totalTests - affectedTests.length) / totalTests) * 100)
      : 0;

    this.log('info', `Found ${affectedTests.length} affected tests (saving ${savingsPercent}%)`);

    return {
      tests: affectedTests,
      changedFiles,
      totalTests,
      savingsPercent,
      level,
      details,
    };
  }

  /**
   * Query which tests cover a specific file
   *
   * @param filePath - Path to the source file
   * @returns List of test paths that cover the file
   */
  getTestsForFile(filePath: string): string[] {
    return this.db.getTestsForSource(filePath);
  }

  /**
   * Get database statistics
   */
  getStats(): DbStats {
    return this.db.getStats();
  }

  /**
   * Export mapping data to JSON for visualization
   *
   * @param outputDir - Directory to write output files
   */
  async exportForVisualization(outputDir: string): Promise<void> {
    const { mkdirSync, writeFileSync } = await import('fs');

    mkdirSync(outputDir, { recursive: true });

    // Export graph data
    const mappings = this.db.getAllMappings();
    const sourceFiles = this.db.getAllSourceFiles();
    const testScripts = this.db.getAllTestScripts();

    const nodes: Array<{ id: string; type: 'source' | 'test'; label: string }> = [];
    const links: Array<{ source: string; target: string; coverage: number }> = [];

    // Add source file nodes
    for (const sf of sourceFiles) {
      nodes.push({
        id: `source:${sf.filePath}`,
        type: 'source',
        label: basename(sf.filePath),
      });
    }

    // Add test nodes
    for (const ts of testScripts) {
      nodes.push({
        id: `test:${ts.scriptPath}`,
        type: 'test',
        label: basename(ts.scriptPath),
      });
    }

    // Add links
    for (const mapping of mappings) {
      links.push({
        source: `source:${mapping.sourceFile}`,
        target: `test:${mapping.testScript}`,
        coverage: mapping.lineCoveragePct,
      });
    }

    writeFileSync(
      resolve(outputDir, 'graph.json'),
      JSON.stringify({ nodes, links }, null, 2)
    );

    // Export symbol data
    const symbols = this.db.getAllSymbols();
    writeFileSync(
      resolve(outputDir, 'symbols.json'),
      JSON.stringify(symbols, null, 2)
    );

    this.log('info', `Exported data to: ${outputDir}`);
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  // ============ Private Methods ============

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    if (this.config.onLog) {
      this.config.onLog(message, level);
    } else if (this.config.verbose) {
      const prefix = { info: '[TiaCC]', warn: '[TiaCC WARN]', error: '[TiaCC ERROR]' }[level];
      console.log(`${prefix} ${message}`);
    }
  }

  private async findCoverageFiles(dir: string): Promise<string[]> {
    const patterns = [
      '**/*.cov.json',      // LLVM JSON
      '**/*.coverage.json', // Coverlet
      '**/*.profraw',       // LLVM raw (not recommended)
    ];

    const files: string[] = [];
    for (const pattern of patterns) {
      const matches = await glob(pattern, { cwd: dir, absolute: true });
      files.push(...matches);
    }

    return files.sort();
  }

  private extractTestName(coverageFilePath: string): string {
    // Extract test name from file name
    // Examples:
    //   test_calculator.cov.json -> test_calculator
    //   test_001_physics.profraw -> test_001_physics
    const base = basename(coverageFilePath);
    return base
      .replace(/\.cov\.json$/i, '')
      .replace(/\.coverage\.json$/i, '')
      .replace(/\.profraw$/i, '')
      .replace(/\.[^.]+$/, ''); // Remove other extensions
  }

  private createEmptyResult(level: 'file' | 'function'): AffectedTestsResult {
    const stats = this.db.getStats();
    return {
      tests: [],
      changedFiles: [],
      totalTests: stats.testScripts,
      savingsPercent: 100,
      level,
    };
  }
}

/**
 * Quick helper to create a TiaCC instance
 *
 * @example
 * ```typescript
 * const tia = await createTiaCC('./impact_map.db');
 * ```
 */
export async function createTiaCC(dbPath: string): Promise<TiaCC> {
  return TiaCC.init(dbPath);
}

export default TiaCC;
