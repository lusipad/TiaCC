/**
 * SQLite database operations for test impact mapping.
 */

import Database from 'better-sqlite3';
import type {
  DbStats, SourceFile, TestScript, CoverageRun, Symbol, SymbolType, CoveredSymbol, FunctionTestMapping,
  TestRun, TestResult, Tag, GitInfo, TrendDataPoint, ReportFilter, RunStatus, TriggerType, TestRunSummary
} from './types.js';

// ============ Path Utilities ============

/**
 * Normalize file path for consistent storage and matching
 */
function normalizePath(filePath: string): string {
  return filePath
    .replace(/\\/g, '/')           // Convert backslashes to forward slashes
    .replace(/\/+/g, '/')          // Remove duplicate slashes
    .replace(/^\.\//, '');         // Remove leading ./
}

/**
 * Extract file name from path
 */
function extractFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}

/**
 * Escape SQL LIKE special characters
 */
function escapeLikePattern(pattern: string): string {
  return pattern
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}

const SCHEMA_SQL = `
-- Source files table
CREATE TABLE IF NOT EXISTS source_files (
    id INTEGER PRIMARY KEY,
    file_path TEXT UNIQUE NOT NULL,
    file_hash TEXT,
    last_updated TEXT
);

-- Test scripts table
CREATE TABLE IF NOT EXISTS test_scripts (
    id INTEGER PRIMARY KEY,
    script_path TEXT UNIQUE NOT NULL,
    last_run TEXT,
    avg_duration_ms INTEGER
);

-- Coverage mapping table (core)
CREATE TABLE IF NOT EXISTS coverage_map (
    source_file_id INTEGER,
    test_script_id INTEGER,
    line_coverage_pct REAL,
    created_at TEXT,
    PRIMARY KEY (source_file_id, test_script_id),
    FOREIGN KEY (source_file_id) REFERENCES source_files(id),
    FOREIGN KEY (test_script_id) REFERENCES test_scripts(id)
);

-- Coverage run metadata
CREATE TABLE IF NOT EXISTS coverage_runs (
    id INTEGER PRIMARY KEY,
    run_date TEXT,
    total_tests INTEGER,
    total_sources INTEGER,
    commit_hash TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_source_path ON source_files(file_path);
CREATE INDEX IF NOT EXISTS idx_test_path ON test_scripts(script_path);
CREATE INDEX IF NOT EXISTS idx_coverage_source ON coverage_map(source_file_id);

-- ============ Symbol-level tables (Phase 2) ============

-- Symbols table (functions, methods, classes)
CREATE TABLE IF NOT EXISTS symbols (
    id INTEGER PRIMARY KEY,
    source_file_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'function',
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    signature TEXT,
    FOREIGN KEY (source_file_id) REFERENCES source_files(id),
    UNIQUE(source_file_id, name, start_line)
);

-- Symbol coverage mapping
CREATE TABLE IF NOT EXISTS symbol_coverage (
    symbol_id INTEGER NOT NULL,
    test_script_id INTEGER NOT NULL,
    hit_count INTEGER DEFAULT 1,
    line_coverage_pct REAL DEFAULT 0,
    created_at TEXT,
    PRIMARY KEY (symbol_id, test_script_id),
    FOREIGN KEY (symbol_id) REFERENCES symbols(id),
    FOREIGN KEY (test_script_id) REFERENCES test_scripts(id)
);

-- Indexes for symbol queries
CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(source_file_id);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
CREATE INDEX IF NOT EXISTS idx_symbols_lines ON symbols(source_file_id, start_line, end_line);
CREATE INDEX IF NOT EXISTS idx_symbol_coverage_symbol ON symbol_coverage(symbol_id);
CREATE INDEX IF NOT EXISTS idx_symbol_coverage_test ON symbol_coverage(test_script_id);

-- ============ Incremental Update tables (Phase 3) ============

-- Track processed coverage files for incremental updates
CREATE TABLE IF NOT EXISTS processed_files (
    id INTEGER PRIMARY KEY,
    file_path TEXT UNIQUE NOT NULL,
    file_hash TEXT,
    file_mtime INTEGER,
    test_script_id INTEGER,
    processed_at TEXT,
    FOREIGN KEY (test_script_id) REFERENCES test_scripts(id)
);

CREATE INDEX IF NOT EXISTS idx_processed_files_path ON processed_files(file_path);
CREATE INDEX IF NOT EXISTS idx_processed_files_test ON processed_files(test_script_id);

-- ============ Smart Recommendation tables (Phase 4) ============

-- Test execution history for failure prediction
CREATE TABLE IF NOT EXISTS test_history (
    id INTEGER PRIMARY KEY,
    test_script_id INTEGER NOT NULL,
    run_date TEXT NOT NULL,
    passed INTEGER NOT NULL,
    duration_ms INTEGER,
    commit_hash TEXT,
    changed_files TEXT,
    FOREIGN KEY (test_script_id) REFERENCES test_scripts(id)
);

CREATE INDEX IF NOT EXISTS idx_test_history_test ON test_history(test_script_id);
CREATE INDEX IF NOT EXISTS idx_test_history_date ON test_history(run_date);

-- Aggregated test statistics for quick access
CREATE TABLE IF NOT EXISTS test_stats (
    test_script_id INTEGER PRIMARY KEY,
    total_runs INTEGER DEFAULT 0,
    total_passes INTEGER DEFAULT 0,
    total_failures INTEGER DEFAULT 0,
    avg_duration_ms INTEGER,
    last_failure_date TEXT,
    failure_streak INTEGER DEFAULT 0,
    recent_failure_rate REAL DEFAULT 0,
    FOREIGN KEY (test_script_id) REFERENCES test_scripts(id)
);

-- File change correlation with test failures
CREATE TABLE IF NOT EXISTS failure_correlations (
    id INTEGER PRIMARY KEY,
    source_file_id INTEGER NOT NULL,
    test_script_id INTEGER NOT NULL,
    correlation_score REAL DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    total_changes INTEGER DEFAULT 0,
    last_updated TEXT,
    UNIQUE(source_file_id, test_script_id),
    FOREIGN KEY (source_file_id) REFERENCES source_files(id),
    FOREIGN KEY (test_script_id) REFERENCES test_scripts(id)
);

CREATE INDEX IF NOT EXISTS idx_failure_corr_source ON failure_correlations(source_file_id);
CREATE INDEX IF NOT EXISTS idx_failure_corr_test ON failure_correlations(test_script_id);

-- ============ Test Run & Results tables (Phase 5) ============

-- Tags for categorizing test runs
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    category TEXT,
    color TEXT,
    description TEXT,
    created_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
CREATE INDEX IF NOT EXISTS idx_tags_category ON tags(category);

-- Test runs (a collection of test results from a single execution)
CREATE TABLE IF NOT EXISTS test_runs (
    id INTEGER PRIMARY KEY,
    run_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    total_tests INTEGER DEFAULT 0,
    passed_tests INTEGER DEFAULT 0,
    failed_tests INTEGER DEFAULT 0,
    skipped_tests INTEGER DEFAULT 0,
    total_duration_ms INTEGER DEFAULT 0,
    environment TEXT,
    trigger_type TEXT,
    metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_test_runs_date ON test_runs(run_date);
CREATE INDEX IF NOT EXISTS idx_test_runs_status ON test_runs(status);
CREATE INDEX IF NOT EXISTS idx_test_runs_env ON test_runs(environment);

-- Git information for test runs
CREATE TABLE IF NOT EXISTS git_info (
    id INTEGER PRIMARY KEY,
    run_id INTEGER UNIQUE NOT NULL,
    commit_hash TEXT NOT NULL,
    branch TEXT,
    author TEXT,
    author_email TEXT,
    commit_message TEXT,
    commit_date TEXT,
    parent_commits TEXT,
    files_changed INTEGER,
    insertions INTEGER,
    deletions INTEGER,
    FOREIGN KEY (run_id) REFERENCES test_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_git_info_run ON git_info(run_id);
CREATE INDEX IF NOT EXISTS idx_git_info_commit ON git_info(commit_hash);
CREATE INDEX IF NOT EXISTS idx_git_info_branch ON git_info(branch);

-- Association table for test runs and tags
CREATE TABLE IF NOT EXISTS run_tags (
    run_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (run_id, tag_id),
    FOREIGN KEY (run_id) REFERENCES test_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_run_tags_run ON run_tags(run_id);
CREATE INDEX IF NOT EXISTS idx_run_tags_tag ON run_tags(tag_id);

-- Individual test results within a run
CREATE TABLE IF NOT EXISTS test_results (
    id INTEGER PRIMARY KEY,
    run_id INTEGER NOT NULL,
    test_script_id INTEGER NOT NULL,
    test_name TEXT,
    passed INTEGER NOT NULL,
    skipped INTEGER DEFAULT 0,
    duration_ms INTEGER,
    error_message TEXT,
    stack_trace TEXT,
    stdout TEXT,
    stderr TEXT,
    retry_count INTEGER DEFAULT 0,
    metadata TEXT,
    FOREIGN KEY (run_id) REFERENCES test_runs(id) ON DELETE CASCADE,
    FOREIGN KEY (test_script_id) REFERENCES test_scripts(id)
);

CREATE INDEX IF NOT EXISTS idx_test_results_run ON test_results(run_id);
CREATE INDEX IF NOT EXISTS idx_test_results_test ON test_results(test_script_id);
CREATE INDEX IF NOT EXISTS idx_test_results_passed ON test_results(passed);
`;

export class TiaDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
  }

  /**
   * Initialize database schema
   */
  init(): void {
    this.db.exec(SCHEMA_SQL);
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Execute a function within a transaction
   * Automatically commits on success, rolls back on error
   */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  /**
   * Execute an async operation within a transaction
   * Note: SQLite transactions are synchronous, so this wraps the sync transaction
   */
  async transactionAsync<T>(fn: () => Promise<T>): Promise<T> {
    // For better-sqlite3, we need to handle async differently
    // Start transaction manually
    this.db.exec('BEGIN TRANSACTION');
    try {
      const result = await fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // ============ Source File Operations ============

  /**
   * Insert or update a source file
   */
  upsertSourceFile(filePath: string, fileHash?: string): number {
    const now = new Date().toISOString();

    // Try update first
    const updateStmt = this.db.prepare(`
      UPDATE source_files SET file_hash = ?, last_updated = ?
      WHERE file_path = ?
    `);
    updateStmt.run(fileHash ?? null, now, filePath);

    // Check if exists
    const selectStmt = this.db.prepare('SELECT id FROM source_files WHERE file_path = ?');
    const row = selectStmt.get(filePath) as { id: number } | undefined;

    if (row) {
      return row.id;
    }

    // Insert new
    const insertStmt = this.db.prepare(`
      INSERT INTO source_files (file_path, file_hash, last_updated)
      VALUES (?, ?, ?)
    `);
    const result = insertStmt.run(filePath, fileHash ?? null, now);
    return result.lastInsertRowid as number;
  }

  /**
   * Get source file ID by path
   */
  getSourceFileId(filePath: string): number | null {
    const stmt = this.db.prepare('SELECT id FROM source_files WHERE file_path = ?');
    const row = stmt.get(filePath) as { id: number } | undefined;
    return row?.id ?? null;
  }

  // ============ Test Script Operations ============

  /**
   * Insert or update a test script
   */
  upsertTestScript(scriptPath: string, durationMs?: number): number {
    const now = new Date().toISOString();

    const selectStmt = this.db.prepare(`
      SELECT id, avg_duration_ms FROM test_scripts WHERE script_path = ?
    `);
    const row = selectStmt.get(scriptPath) as { id: number; avg_duration_ms: number | null } | undefined;

    if (row) {
      // Update with running average
      let newAvg = durationMs ?? row.avg_duration_ms;
      if (durationMs !== undefined && row.avg_duration_ms !== null) {
        newAvg = Math.floor((row.avg_duration_ms + durationMs) / 2);
      }

      const updateStmt = this.db.prepare(`
        UPDATE test_scripts SET last_run = ?, avg_duration_ms = ?
        WHERE id = ?
      `);
      updateStmt.run(now, newAvg, row.id);
      return row.id;
    }

    // Insert new
    const insertStmt = this.db.prepare(`
      INSERT INTO test_scripts (script_path, last_run, avg_duration_ms)
      VALUES (?, ?, ?)
    `);
    const result = insertStmt.run(scriptPath, now, durationMs ?? null);
    return result.lastInsertRowid as number;
  }

  // ============ Coverage Mapping Operations ============

  /**
   * Add or update a coverage mapping
   */
  addCoverageMapping(sourceFileId: number, testScriptId: number, coveragePct = 0): void {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO coverage_map
      (source_file_id, test_script_id, line_coverage_pct, created_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(sourceFileId, testScriptId, coveragePct, now);
  }

  /**
   * Get all tests that cover a source file
   */
  getTestsForSource(filePath: string): string[] {
    // Normalize path and extract file name for fuzzy matching
    const normalized = normalizePath(filePath);
    const fileName = extractFileName(normalized);
    const escapedFileName = escapeLikePattern(fileName);

    const stmt = this.db.prepare(`
      SELECT DISTINCT ts.script_path
      FROM coverage_map cm
      JOIN source_files sf ON cm.source_file_id = sf.id
      JOIN test_scripts ts ON cm.test_script_id = ts.id
      WHERE sf.file_path LIKE ? ESCAPE '\\'
    `);

    const rows = stmt.all(`%${escapedFileName}`) as { script_path: string }[];
    return rows.map(r => r.script_path);
  }

  /**
   * Get all tests that cover any of the given source files
   * Optimized to use a single query instead of N queries (N+1 problem fix)
   */
  getTestsForSources(filePaths: string[]): string[] {
    if (filePaths.length === 0) return [];

    // Normalize paths and extract file names for fuzzy matching
    const fileNames = filePaths.map(p => {
      const normalized = normalizePath(p);
      return escapeLikePattern(extractFileName(normalized));
    });

    // Build OR conditions for all files (batch query)
    const conditions = fileNames.map(() => "sf.file_path LIKE ? ESCAPE '\\'").join(' OR ');

    const stmt = this.db.prepare(`
      SELECT DISTINCT ts.script_path
      FROM coverage_map cm
      JOIN source_files sf ON cm.source_file_id = sf.id
      JOIN test_scripts ts ON cm.test_script_id = ts.id
      WHERE ${conditions}
    `);

    const patterns = fileNames.map(f => `%${f}`);
    const rows = stmt.all(...patterns) as { script_path: string }[];
    return rows.map(r => r.script_path).sort();
  }

  // ============ Coverage Run Operations ============

  /**
   * Record a coverage run
   */
  recordCoverageRun(totalTests: number, totalSources: number, commitHash?: string): number {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO coverage_runs (run_date, total_tests, total_sources, commit_hash)
      VALUES (?, ?, ?, ?)
    `);
    const result = stmt.run(now, totalTests, totalSources, commitHash ?? null);
    return result.lastInsertRowid as number;
  }

  /**
   * Get the latest coverage run
   */
  getLatestRun(): CoverageRun | null {
    const stmt = this.db.prepare(`
      SELECT * FROM coverage_runs ORDER BY run_date DESC, id DESC LIMIT 1
    `);
    const row = stmt.get() as any;

    if (!row) return null;

    return {
      id: row.id,
      runDate: row.run_date,
      totalTests: row.total_tests,
      totalSources: row.total_sources,
      commitHash: row.commit_hash,
    };
  }

  // ============ Statistics ============

  /**
   * Get database statistics
   */
  getStats(): DbStats {
    const sourceCount = this.db.prepare('SELECT COUNT(*) as cnt FROM source_files').get() as { cnt: number };
    const testCount = this.db.prepare('SELECT COUNT(*) as cnt FROM test_scripts').get() as { cnt: number };
    const mappingCount = this.db.prepare('SELECT COUNT(*) as cnt FROM coverage_map').get() as { cnt: number };

    return {
      sourceFiles: sourceCount.cnt,
      testScripts: testCount.cnt,
      mappings: mappingCount.cnt,
    };
  }

  // ============ Export Operations (for visualization) ============

  /**
   * Get all source files
   */
  getAllSourceFiles(): SourceFile[] {
    const stmt = this.db.prepare('SELECT * FROM source_files ORDER BY file_path');
    const rows = stmt.all() as any[];
    return rows.map(row => ({
      id: row.id,
      filePath: row.file_path,
      fileHash: row.file_hash,
      lastUpdated: row.last_updated,
    }));
  }

  /**
   * Get all test scripts
   */
  getAllTestScripts(): TestScript[] {
    const stmt = this.db.prepare('SELECT * FROM test_scripts ORDER BY script_path');
    const rows = stmt.all() as any[];
    return rows.map(row => ({
      id: row.id,
      scriptPath: row.script_path,
      lastRun: row.last_run,
      avgDurationMs: row.avg_duration_ms,
    }));
  }

  /**
   * Get all coverage mappings with full details
   */
  getAllMappings(): Array<{
    sourceFile: string;
    testScript: string;
    lineCoveragePct: number;
    createdAt: string;
  }> {
    const stmt = this.db.prepare(`
      SELECT
        sf.file_path as source_file,
        ts.script_path as test_script,
        cm.line_coverage_pct,
        cm.created_at
      FROM coverage_map cm
      JOIN source_files sf ON cm.source_file_id = sf.id
      JOIN test_scripts ts ON cm.test_script_id = ts.id
      ORDER BY sf.file_path, ts.script_path
    `);
    const rows = stmt.all() as any[];
    return rows.map(row => ({
      sourceFile: row.source_file,
      testScript: row.test_script,
      lineCoveragePct: row.line_coverage_pct,
      createdAt: row.created_at,
    }));
  }

  /**
   * Get all coverage runs history
   */
  getAllRuns(): CoverageRun[] {
    const stmt = this.db.prepare('SELECT * FROM coverage_runs ORDER BY run_date DESC');
    const rows = stmt.all() as any[];
    return rows.map(row => ({
      id: row.id,
      runDate: row.run_date,
      totalTests: row.total_tests,
      totalSources: row.total_sources,
      commitHash: row.commit_hash,
    }));
  }

  /**
   * Get coverage aggregation by directory
   */
  getCoverageByDirectory(): Array<{
    directory: string;
    fileCount: number;
    avgCoverage: number;
    testCount: number;
  }> {
    // Get raw data first, then process directory extraction in JavaScript
    const stmt = this.db.prepare(`
      SELECT
        sf.file_path,
        COUNT(DISTINCT cm.test_script_id) as test_count,
        AVG(cm.line_coverage_pct) as avg_coverage
      FROM source_files sf
      LEFT JOIN coverage_map cm ON sf.id = cm.source_file_id
      GROUP BY sf.file_path
    `);
    const rows = stmt.all() as any[];

    // Group by directory in JavaScript
    const dirMap = new Map<string, { fileCount: number; avgCoverage: number[]; testCount: number }>();

    for (const row of rows) {
      const filePath = row.file_path || '';
      // Extract directory from path
      const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
      const directory = lastSlash > 0 ? filePath.substring(0, lastSlash) : '.';

      if (!dirMap.has(directory)) {
        dirMap.set(directory, { fileCount: 0, avgCoverage: [], testCount: 0 });
      }

      const dir = dirMap.get(directory)!;
      dir.fileCount++;
      if (row.avg_coverage !== null) {
        dir.avgCoverage.push(row.avg_coverage);
      }
      dir.testCount += row.test_count || 0;
    }

    // Convert to output format
    return Array.from(dirMap.entries())
      .map(([directory, data]) => ({
        directory,
        fileCount: data.fileCount,
        avgCoverage: data.avgCoverage.length > 0
          ? data.avgCoverage.reduce((a, b) => a + b, 0) / data.avgCoverage.length
          : 0,
        testCount: data.testCount,
      }))
      .sort((a, b) => b.fileCount - a.fileCount);
  }

  // ============ Symbol Operations ============

  /**
   * Insert or update a symbol (function/method/class)
   */
  upsertSymbol(
    sourceFileId: number,
    name: string,
    startLine: number,
    endLine: number,
    type: SymbolType = 'function',
    signature?: string
  ): number {
    const selectStmt = this.db.prepare(`
      SELECT id FROM symbols
      WHERE source_file_id = ? AND name = ? AND start_line = ?
    `);
    const row = selectStmt.get(sourceFileId, name, startLine) as { id: number } | undefined;

    if (row) {
      // Update existing
      const updateStmt = this.db.prepare(`
        UPDATE symbols SET end_line = ?, type = ?, signature = ?
        WHERE id = ?
      `);
      updateStmt.run(endLine, type, signature ?? null, row.id);
      return row.id;
    }

    // Insert new
    const insertStmt = this.db.prepare(`
      INSERT INTO symbols (source_file_id, name, type, start_line, end_line, signature)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = insertStmt.run(sourceFileId, name, type, startLine, endLine, signature ?? null);
    return result.lastInsertRowid as number;
  }

  /**
   * Add symbol coverage mapping
   */
  addSymbolCoverage(symbolId: number, testScriptId: number, hitCount = 1, coveragePct = 0): void {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO symbol_coverage
      (symbol_id, test_script_id, hit_count, line_coverage_pct, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(symbolId, testScriptId, hitCount, coveragePct, now);
  }

  /**
   * Get symbols for a source file that overlap with changed lines
   */
  getSymbolsForLines(filePath: string, changedLines: number[]): Symbol[] {
    if (changedLines.length === 0) return [];

    // Normalize file path for matching
    const fileName = filePath.split(/[/\\]/).pop() ?? filePath;

    const stmt = this.db.prepare(`
      SELECT s.* FROM symbols s
      JOIN source_files sf ON s.source_file_id = sf.id
      WHERE sf.file_path LIKE ?
      ORDER BY s.start_line
    `);

    const rows = stmt.all(`%${fileName}`) as any[];

    // Filter symbols that overlap with any changed line
    const minLine = Math.min(...changedLines);
    const maxLine = Math.max(...changedLines);

    return rows
      .filter(row => {
        // Symbol overlaps if: symbol.start <= maxChangedLine AND symbol.end >= minChangedLine
        return row.start_line <= maxLine && row.end_line >= minLine;
      })
      .map(row => ({
        id: row.id,
        sourceFileId: row.source_file_id,
        name: row.name,
        type: row.type as SymbolType,
        startLine: row.start_line,
        endLine: row.end_line,
        signature: row.signature,
      }));
  }

  /**
   * Get tests that cover specific symbols
   */
  getTestsForSymbols(symbolIds: number[]): Array<{ testPath: string; symbolName: string; coverage: number }> {
    if (symbolIds.length === 0) return [];

    const placeholders = symbolIds.map(() => '?').join(',');
    const stmt = this.db.prepare(`
      SELECT DISTINCT
        ts.script_path as testPath,
        s.name as symbolName,
        sc.line_coverage_pct as coverage
      FROM symbol_coverage sc
      JOIN test_scripts ts ON sc.test_script_id = ts.id
      JOIN symbols s ON sc.symbol_id = s.id
      WHERE sc.symbol_id IN (${placeholders})
      ORDER BY sc.line_coverage_pct DESC
    `);

    return stmt.all(...symbolIds) as Array<{ testPath: string; symbolName: string; coverage: number }>;
  }

  /**
   * Get function-level test mappings for a file
   */
  getFunctionMappingsForFile(filePath: string): FunctionTestMapping[] {
    const stmt = this.db.prepare(`
      SELECT
        s.name as function_name,
        sf.file_path,
        s.start_line,
        s.end_line,
        ts.script_path as test_path,
        sc.line_coverage_pct as coverage
      FROM symbols s
      JOIN source_files sf ON s.source_file_id = sf.id
      JOIN symbol_coverage sc ON s.id = sc.symbol_id
      JOIN test_scripts ts ON sc.test_script_id = ts.id
      WHERE sf.file_path LIKE ?
      ORDER BY s.start_line, sc.line_coverage_pct DESC
    `);

    const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
    const rows = stmt.all(`%${fileName}`) as any[];

    // Group by function
    const functionMap = new Map<string, FunctionTestMapping>();

    for (const row of rows) {
      const key = `${row.function_name}:${row.start_line}`;
      if (!functionMap.has(key)) {
        functionMap.set(key, {
          functionName: row.function_name,
          filePath: row.file_path,
          startLine: row.start_line,
          endLine: row.end_line,
          tests: [],
        });
      }
      functionMap.get(key)!.tests.push({
        testPath: row.test_path,
        coverage: row.coverage,
      });
    }

    return Array.from(functionMap.values());
  }

  /**
   * Get all symbols for export
   */
  getAllSymbols(): Symbol[] {
    const stmt = this.db.prepare(`
      SELECT * FROM symbols ORDER BY source_file_id, start_line
    `);
    const rows = stmt.all() as any[];
    return rows.map(row => ({
      id: row.id,
      sourceFileId: row.source_file_id,
      name: row.name,
      type: row.type as SymbolType,
      startLine: row.start_line,
      endLine: row.end_line,
      signature: row.signature,
    }));
  }

  /**
   * Get symbol coverage statistics
   */
  getSymbolStats(): { symbols: number; symbolMappings: number } {
    const symbolCount = this.db.prepare('SELECT COUNT(*) as cnt FROM symbols').get() as { cnt: number };
    const mappingCount = this.db.prepare('SELECT COUNT(*) as cnt FROM symbol_coverage').get() as { cnt: number };

    return {
      symbols: symbolCount.cnt,
      symbolMappings: mappingCount.cnt,
    };
  }

  /**
   * Batch insert symbols for performance
   */
  batchInsertSymbols(symbols: Array<{
    sourceFileId: number;
    name: string;
    type: SymbolType;
    startLine: number;
    endLine: number;
    signature?: string;
  }>): number[] {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO symbols
      (source_file_id, name, type, start_line, end_line, signature)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const ids: number[] = [];

    const insertMany = this.db.transaction((items: typeof symbols) => {
      for (const item of items) {
        const result = stmt.run(
          item.sourceFileId,
          item.name,
          item.type,
          item.startLine,
          item.endLine,
          item.signature ?? null
        );
        ids.push(result.lastInsertRowid as number);
      }
    });

    insertMany(symbols);
    return ids;
  }

  /**
   * Batch insert symbol coverage for performance
   */
  batchInsertSymbolCoverage(coverages: Array<{
    symbolId: number;
    testId: number;
    hitCount: number;
    coverage: number;
  }>): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO symbol_coverage
      (symbol_id, test_script_id, hit_count, line_coverage_pct, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();

    const insertMany = this.db.transaction((items: typeof coverages) => {
      for (const item of items) {
        stmt.run(item.symbolId, item.testId, item.hitCount, item.coverage, now);
      }
    });

    insertMany(coverages);
  }

  /**
   * Batch insert for performance
   */
  batchInsertMappings(mappings: Array<{ sourceId: number; testId: number; coverage?: number }>): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO coverage_map
      (source_file_id, test_script_id, line_coverage_pct, created_at)
      VALUES (?, ?, ?, ?)
    `);

    const now = new Date().toISOString();

    const insertMany = this.db.transaction((items: typeof mappings) => {
      for (const item of items) {
        stmt.run(item.sourceId, item.testId, item.coverage ?? 0, now);
      }
    });

    insertMany(mappings);
  }

  // ============ Incremental Update Operations (Phase 3) ============

  /**
   * Check if a coverage file needs to be processed
   * Returns true if the file is new or has been modified
   */
  needsProcessing(filePath: string, fileMtime: number, fileHash?: string): boolean {
    const stmt = this.db.prepare(`
      SELECT file_mtime, file_hash FROM processed_files WHERE file_path = ?
    `);
    const row = stmt.get(filePath) as { file_mtime: number; file_hash: string | null } | undefined;

    if (!row) {
      return true; // New file
    }

    // Check modification time first (fast)
    if (row.file_mtime !== fileMtime) {
      return true;
    }

    // Optionally check hash for extra certainty
    if (fileHash && row.file_hash && row.file_hash !== fileHash) {
      return true;
    }

    return false;
  }

  /**
   * Record that a coverage file has been processed
   */
  recordProcessedFile(
    filePath: string,
    testScriptId: number,
    fileMtime: number,
    fileHash?: string
  ): void {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO processed_files
      (file_path, file_hash, file_mtime, test_script_id, processed_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(filePath, fileHash ?? null, fileMtime, testScriptId, now);
  }

  /**
   * Get the test script ID for a processed coverage file
   */
  getTestIdForProcessedFile(filePath: string): number | null {
    const stmt = this.db.prepare(`
      SELECT test_script_id FROM processed_files WHERE file_path = ?
    `);
    const row = stmt.get(filePath) as { test_script_id: number } | undefined;
    return row?.test_script_id ?? null;
  }

  /**
   * Delete all mappings for a specific test script
   * Used before re-processing a test's coverage
   */
  deleteMappingsForTest(testScriptId: number): void {
    const stmt = this.db.prepare(`
      DELETE FROM coverage_map WHERE test_script_id = ?
    `);
    stmt.run(testScriptId);
  }

  /**
   * Delete all symbol coverage for a specific test script
   */
  deleteSymbolCoverageForTest(testScriptId: number): void {
    const stmt = this.db.prepare(`
      DELETE FROM symbol_coverage WHERE test_script_id = ?
    `);
    stmt.run(testScriptId);
  }

  /**
   * Clear all mappings for a test before re-processing
   */
  clearTestMappings(testScriptId: number): void {
    this.deleteMappingsForTest(testScriptId);
    this.deleteSymbolCoverageForTest(testScriptId);
  }

  /**
   * Get all processed files for a given test
   */
  getProcessedFilesForTest(testScriptId: number): string[] {
    const stmt = this.db.prepare(`
      SELECT file_path FROM processed_files WHERE test_script_id = ?
    `);
    const rows = stmt.all(testScriptId) as { file_path: string }[];
    return rows.map(r => r.file_path);
  }

  /**
   * Remove processed file record
   */
  removeProcessedFile(filePath: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM processed_files WHERE file_path = ?
    `);
    stmt.run(filePath);
  }

  /**
   * Get incremental update statistics
   */
  getIncrementalStats(): { processedFiles: number; lastProcessedAt: string | null } {
    const countStmt = this.db.prepare('SELECT COUNT(*) as cnt FROM processed_files');
    const count = (countStmt.get() as { cnt: number }).cnt;

    const lastStmt = this.db.prepare(
      'SELECT processed_at FROM processed_files ORDER BY processed_at DESC LIMIT 1'
    );
    const lastRow = lastStmt.get() as { processed_at: string } | undefined;

    return {
      processedFiles: count,
      lastProcessedAt: lastRow?.processed_at ?? null,
    };
  }

  /**
   * Purge orphaned records (coverage files that no longer exist)
   */
  purgeOrphanedRecords(existingFiles: Set<string>): number {
    const allProcessed = this.db.prepare('SELECT file_path FROM processed_files').all() as { file_path: string }[];

    let purged = 0;
    for (const { file_path } of allProcessed) {
      if (!existingFiles.has(file_path)) {
        // Get test ID before removing
        const testId = this.getTestIdForProcessedFile(file_path);
        if (testId) {
          // Remove all mappings for this test
          this.clearTestMappings(testId);
        }
        this.removeProcessedFile(file_path);
        purged++;
      }
    }

    return purged;
  }

  // ============ Smart Recommendation Operations (Phase 4) ============

  /**
   * Record a test execution result
   */
  recordTestResult(
    testScriptPath: string,
    passed: boolean,
    durationMs?: number,
    commitHash?: string,
    changedFiles?: string[]
  ): void {
    const now = new Date().toISOString();

    // Get or create test script
    const testId = this.upsertTestScript(testScriptPath, durationMs);

    // Record in history
    const historyStmt = this.db.prepare(`
      INSERT INTO test_history (test_script_id, run_date, passed, duration_ms, commit_hash, changed_files)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    historyStmt.run(
      testId,
      now,
      passed ? 1 : 0,
      durationMs ?? null,
      commitHash ?? null,
      changedFiles ? JSON.stringify(changedFiles) : null
    );

    // Update aggregated stats
    this.updateTestStats(testId, passed, durationMs);

    // Update failure correlations if test failed
    if (!passed && changedFiles && changedFiles.length > 0) {
      this.updateFailureCorrelations(testId, changedFiles);
    }
  }

  /**
   * Update aggregated test statistics
   */
  private updateTestStats(testScriptId: number, passed: boolean, durationMs?: number): void {
    const now = new Date().toISOString();

    // Get current stats
    const selectStmt = this.db.prepare('SELECT * FROM test_stats WHERE test_script_id = ?');
    const current = selectStmt.get(testScriptId) as any;

    if (!current) {
      // Create new stats record
      const insertStmt = this.db.prepare(`
        INSERT INTO test_stats (test_script_id, total_runs, total_passes, total_failures, avg_duration_ms, last_failure_date, failure_streak, recent_failure_rate)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?)
      `);
      insertStmt.run(
        testScriptId,
        passed ? 1 : 0,
        passed ? 0 : 1,
        durationMs ?? null,
        passed ? null : now,
        passed ? 0 : 1,
        passed ? 0 : 1
      );
    } else {
      // Update existing stats
      const totalRuns = current.total_runs + 1;
      const totalPasses = current.total_passes + (passed ? 1 : 0);
      const totalFailures = current.total_failures + (passed ? 0 : 1);

      // Running average for duration
      let avgDuration = current.avg_duration_ms;
      if (durationMs !== undefined) {
        if (avgDuration === null) {
          avgDuration = durationMs;
        } else {
          avgDuration = Math.floor((avgDuration + durationMs) / 2);
        }
      }

      // Failure streak
      let failureStreak = passed ? 0 : (current.failure_streak + 1);

      // Recent failure rate (weighted towards recent runs)
      const alpha = 0.3; // Weight for recent result
      const recentFailureRate = alpha * (passed ? 0 : 1) + (1 - alpha) * (current.recent_failure_rate || 0);

      const updateStmt = this.db.prepare(`
        UPDATE test_stats SET
          total_runs = ?,
          total_passes = ?,
          total_failures = ?,
          avg_duration_ms = ?,
          last_failure_date = COALESCE(?, last_failure_date),
          failure_streak = ?,
          recent_failure_rate = ?
        WHERE test_script_id = ?
      `);
      updateStmt.run(
        totalRuns,
        totalPasses,
        totalFailures,
        avgDuration,
        passed ? null : now,
        failureStreak,
        recentFailureRate,
        testScriptId
      );
    }
  }

  /**
   * Update failure correlations between source files and tests
   */
  private updateFailureCorrelations(testScriptId: number, changedFiles: string[]): void {
    const now = new Date().toISOString();

    for (const filePath of changedFiles) {
      const sourceId = this.getSourceFileId(filePath);
      if (!sourceId) continue;

      // Get current correlation
      const selectStmt = this.db.prepare(`
        SELECT * FROM failure_correlations WHERE source_file_id = ? AND test_script_id = ?
      `);
      const current = selectStmt.get(sourceId, testScriptId) as any;

      if (!current) {
        // Create new correlation
        const insertStmt = this.db.prepare(`
          INSERT INTO failure_correlations (source_file_id, test_script_id, correlation_score, failure_count, total_changes, last_updated)
          VALUES (?, ?, ?, 1, 1, ?)
        `);
        insertStmt.run(sourceId, testScriptId, 1.0, now);
      } else {
        // Update correlation score
        const failureCount = current.failure_count + 1;
        const totalChanges = current.total_changes + 1;
        const correlationScore = failureCount / totalChanges;

        const updateStmt = this.db.prepare(`
          UPDATE failure_correlations SET
            correlation_score = ?,
            failure_count = ?,
            total_changes = ?,
            last_updated = ?
          WHERE id = ?
        `);
        updateStmt.run(correlationScore, failureCount, totalChanges, now, current.id);
      }
    }
  }

  /**
   * Record that a file was changed (for correlation tracking)
   */
  recordFileChange(filePath: string, testScriptIds: number[]): void {
    const sourceId = this.getSourceFileId(filePath);
    if (!sourceId) return;

    const now = new Date().toISOString();

    for (const testId of testScriptIds) {
      const selectStmt = this.db.prepare(`
        SELECT * FROM failure_correlations WHERE source_file_id = ? AND test_script_id = ?
      `);
      const current = selectStmt.get(sourceId, testId) as any;

      if (current) {
        // Increment total_changes
        const updateStmt = this.db.prepare(`
          UPDATE failure_correlations SET total_changes = total_changes + 1, last_updated = ?
          WHERE id = ?
        `);
        updateStmt.run(now, current.id);
      }
    }
  }

  /**
   * Get test statistics for a test script
   */
  getTestStats(testScriptPath: string): {
    totalRuns: number;
    totalPasses: number;
    totalFailures: number;
    avgDurationMs: number | null;
    failureRate: number;
    recentFailureRate: number;
    failureStreak: number;
    lastFailureDate: string | null;
  } | null {
    const stmt = this.db.prepare(`
      SELECT ts.*, s.script_path FROM test_stats ts
      JOIN test_scripts s ON ts.test_script_id = s.id
      WHERE s.script_path = ?
    `);
    const row = stmt.get(testScriptPath) as any;

    if (!row) return null;

    return {
      totalRuns: row.total_runs,
      totalPasses: row.total_passes,
      totalFailures: row.total_failures,
      avgDurationMs: row.avg_duration_ms,
      failureRate: row.total_runs > 0 ? row.total_failures / row.total_runs : 0,
      recentFailureRate: row.recent_failure_rate || 0,
      failureStreak: row.failure_streak,
      lastFailureDate: row.last_failure_date,
    };
  }

  /**
   * Get failure probability for a test based on changed files
   */
  getFailureProbability(testScriptPath: string, changedFiles: string[]): number {
    if (changedFiles.length === 0) return 0;

    // Get test ID
    const testStmt = this.db.prepare('SELECT id FROM test_scripts WHERE script_path = ?');
    const testRow = testStmt.get(testScriptPath) as { id: number } | undefined;
    if (!testRow) return 0;

    // Get correlation scores for changed files
    const sourceIds: number[] = [];
    for (const filePath of changedFiles) {
      const sourceId = this.getSourceFileId(filePath);
      if (sourceId) sourceIds.push(sourceId);
    }

    if (sourceIds.length === 0) return 0;

    const placeholders = sourceIds.map(() => '?').join(',');
    const correlationStmt = this.db.prepare(`
      SELECT MAX(correlation_score) as max_score, AVG(correlation_score) as avg_score
      FROM failure_correlations
      WHERE source_file_id IN (${placeholders}) AND test_script_id = ?
    `);
    const correlationRow = correlationStmt.get(...sourceIds, testRow.id) as {
      max_score: number | null;
      avg_score: number | null;
    };

    // Also factor in recent failure rate
    const statsStmt = this.db.prepare('SELECT recent_failure_rate FROM test_stats WHERE test_script_id = ?');
    const statsRow = statsStmt.get(testRow.id) as { recent_failure_rate: number } | undefined;
    const recentFailureRate = statsRow?.recent_failure_rate || 0;

    // Combine correlation and recent failure rate
    const correlationScore = correlationRow?.max_score || 0;
    const combinedProbability = 0.6 * correlationScore + 0.4 * recentFailureRate;

    return Math.min(1, combinedProbability);
  }

  /**
   * Get smart test recommendations with priority scores
   */
  getSmartRecommendations(changedFiles: string[]): Array<{
    testPath: string;
    priorityScore: number;
    failureProbability: number;
    estimatedDurationMs: number | null;
    coverageScore: number;
    recentFailureRate: number;
    reasons: string[];
  }> {
    if (changedFiles.length === 0) return [];

    // Get all tests covering the changed files
    const tests = this.getTestsForSources(changedFiles);

    const recommendations: Array<{
      testPath: string;
      priorityScore: number;
      failureProbability: number;
      estimatedDurationMs: number | null;
      coverageScore: number;
      recentFailureRate: number;
      reasons: string[];
    }> = [];

    for (const testPath of tests) {
      const reasons: string[] = [];

      // Get failure probability
      const failureProbability = this.getFailureProbability(testPath, changedFiles);
      if (failureProbability > 0.5) {
        reasons.push(`High failure correlation (${(failureProbability * 100).toFixed(0)}%)`);
      }

      // Get test stats
      const stats = this.getTestStats(testPath);
      const recentFailureRate = stats?.recentFailureRate || 0;
      const estimatedDurationMs = stats?.avgDurationMs ?? null;

      if (recentFailureRate > 0.3) {
        reasons.push(`Recent failures (${(recentFailureRate * 100).toFixed(0)}% rate)`);
      }

      if (stats?.failureStreak && stats.failureStreak > 0) {
        reasons.push(`Currently failing (${stats.failureStreak} consecutive)`);
      }

      // Calculate coverage score (how many changed files this test covers)
      const coverageScore = this.calculateCoverageScore(testPath, changedFiles);
      if (coverageScore > 0.7) {
        reasons.push(`High coverage of changes (${(coverageScore * 100).toFixed(0)}%)`);
      }

      // Calculate priority score
      // Higher = should run first
      // Factors: failure probability, recent failure rate, coverage score, duration (shorter = higher priority)
      let priorityScore = 0;
      priorityScore += failureProbability * 40;      // Max 40 points for failure probability
      priorityScore += recentFailureRate * 25;       // Max 25 points for recent failures
      priorityScore += coverageScore * 25;           // Max 25 points for coverage
      // Duration factor: shorter tests get higher priority (max 10 points)
      if (estimatedDurationMs !== null) {
        const durationFactor = Math.max(0, 1 - estimatedDurationMs / 60000); // 1 minute = baseline
        priorityScore += durationFactor * 10;
      }

      if (reasons.length === 0) {
        reasons.push('Covers changed files');
      }

      recommendations.push({
        testPath,
        priorityScore,
        failureProbability,
        estimatedDurationMs,
        coverageScore,
        recentFailureRate,
        reasons,
      });
    }

    // Sort by priority score (highest first)
    return recommendations.sort((a, b) => b.priorityScore - a.priorityScore);
  }

  /**
   * Calculate how much of the changed files a test covers
   */
  private calculateCoverageScore(testPath: string, changedFiles: string[]): number {
    const testStmt = this.db.prepare('SELECT id FROM test_scripts WHERE script_path = ?');
    const testRow = testStmt.get(testPath) as { id: number } | undefined;
    if (!testRow) return 0;

    let coveredCount = 0;
    for (const filePath of changedFiles) {
      const sourceId = this.getSourceFileId(filePath);
      if (!sourceId) continue;

      const mappingStmt = this.db.prepare(`
        SELECT 1 FROM coverage_map WHERE source_file_id = ? AND test_script_id = ?
      `);
      const mapping = mappingStmt.get(sourceId, testRow.id);
      if (mapping) coveredCount++;
    }

    return changedFiles.length > 0 ? coveredCount / changedFiles.length : 0;
  }

  /**
   * Batch record test results (for CI integration)
   */
  batchRecordTestResults(results: Array<{
    testPath: string;
    passed: boolean;
    durationMs?: number;
  }>, commitHash?: string, changedFiles?: string[]): void {
    const insertMany = this.db.transaction(() => {
      for (const result of results) {
        this.recordTestResult(
          result.testPath,
          result.passed,
          result.durationMs,
          commitHash,
          changedFiles
        );
      }
    });
    insertMany();
  }

  /**
   * Get estimated total duration for a set of tests
   */
  getEstimatedDuration(testPaths: string[]): {
    totalMs: number;
    breakdown: Array<{ testPath: string; estimatedMs: number | null }>;
  } {
    let totalMs = 0;
    const breakdown: Array<{ testPath: string; estimatedMs: number | null }> = [];

    for (const testPath of testPaths) {
      const stats = this.getTestStats(testPath);
      const estimatedMs = stats?.avgDurationMs ?? null;
      breakdown.push({ testPath, estimatedMs });
      if (estimatedMs !== null) {
        totalMs += estimatedMs;
      }
    }

    return { totalMs, breakdown };
  }

  /**
   * Get tests most likely to fail based on historical data
   */
  getMostLikelyToFail(limit = 10): Array<{
    testPath: string;
    recentFailureRate: number;
    failureStreak: number;
    lastFailureDate: string | null;
  }> {
    const stmt = this.db.prepare(`
      SELECT ts.script_path, s.recent_failure_rate, s.failure_streak, s.last_failure_date
      FROM test_stats s
      JOIN test_scripts ts ON s.test_script_id = ts.id
      WHERE s.recent_failure_rate > 0
      ORDER BY s.recent_failure_rate DESC, s.failure_streak DESC
      LIMIT ?
    `);

    const rows = stmt.all(limit) as any[];
    return rows.map(row => ({
      testPath: row.script_path,
      recentFailureRate: row.recent_failure_rate,
      failureStreak: row.failure_streak,
      lastFailureDate: row.last_failure_date,
    }));
  }

  /**
   * Get smart recommendation statistics
   */
  getSmartStats(): {
    testsWithHistory: number;
    totalHistoryRecords: number;
    correlationsTracked: number;
    avgFailureRate: number;
  } {
    const testsWithHistory = (this.db.prepare('SELECT COUNT(*) as cnt FROM test_stats').get() as { cnt: number }).cnt;
    const totalHistory = (this.db.prepare('SELECT COUNT(*) as cnt FROM test_history').get() as { cnt: number }).cnt;
    const correlations = (this.db.prepare('SELECT COUNT(*) as cnt FROM failure_correlations').get() as { cnt: number }).cnt;
    const avgFailure = (this.db.prepare('SELECT AVG(recent_failure_rate) as avg FROM test_stats').get() as { avg: number | null }).avg || 0;

    return {
      testsWithHistory,
      totalHistoryRecords: totalHistory,
      correlationsTracked: correlations,
      avgFailureRate: avgFailure,
    };
  }

  // ============ Tag Operations (Phase 5) ============

  /**
   * Create or get a tag by name
   */
  upsertTag(name: string, category?: string, color?: string, description?: string): number {
    const now = new Date().toISOString();

    const selectStmt = this.db.prepare('SELECT id FROM tags WHERE name = ?');
    const row = selectStmt.get(name) as { id: number } | undefined;

    if (row) {
      // Update existing tag
      const updateStmt = this.db.prepare(`
        UPDATE tags SET category = COALESCE(?, category), color = COALESCE(?, color), description = COALESCE(?, description)
        WHERE id = ?
      `);
      updateStmt.run(category ?? null, color ?? null, description ?? null, row.id);
      return row.id;
    }

    // Insert new tag
    const insertStmt = this.db.prepare(`
      INSERT INTO tags (name, category, color, description, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = insertStmt.run(name, category ?? null, color ?? null, description ?? null, now);
    return result.lastInsertRowid as number;
  }

  /**
   * Get tag by name
   */
  getTagByName(name: string): Tag | null {
    const stmt = this.db.prepare('SELECT * FROM tags WHERE name = ?');
    const row = stmt.get(name) as any;
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      category: row.category,
      color: row.color,
      description: row.description,
    };
  }

  /**
   * Get all tags, optionally filtered by category
   */
  getAllTags(category?: string): Tag[] {
    let stmt;
    if (category) {
      stmt = this.db.prepare('SELECT * FROM tags WHERE category = ? ORDER BY name');
      return (stmt.all(category) as any[]).map(row => ({
        id: row.id,
        name: row.name,
        category: row.category,
        color: row.color,
        description: row.description,
      }));
    }

    stmt = this.db.prepare('SELECT * FROM tags ORDER BY category, name');
    return (stmt.all() as any[]).map(row => ({
      id: row.id,
      name: row.name,
      category: row.category,
      color: row.color,
      description: row.description,
    }));
  }

  /**
   * Delete a tag
   */
  deleteTag(name: string): boolean {
    const stmt = this.db.prepare('DELETE FROM tags WHERE name = ?');
    const result = stmt.run(name);
    return result.changes > 0;
  }

  // ============ Test Run Operations (Phase 5) ============

  /**
   * Create a new test run
   */
  createTestRun(options: {
    environment?: string;
    triggerType?: TriggerType;
    metadata?: Record<string, unknown>;
  } = {}): number {
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO test_runs (run_date, status, environment, trigger_type, metadata)
      VALUES (?, 'running', ?, ?, ?)
    `);

    const result = stmt.run(
      now,
      options.environment ?? null,
      options.triggerType ?? null,
      options.metadata ? JSON.stringify(options.metadata) : null
    );

    return result.lastInsertRowid as number;
  }

  /**
   * Update test run status and statistics
   */
  updateTestRun(runId: number, updates: {
    status?: RunStatus;
    totalTests?: number;
    passedTests?: number;
    failedTests?: number;
    skippedTests?: number;
    totalDurationMs?: number;
  }): void {
    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      values.push(updates.status);
    }
    if (updates.totalTests !== undefined) {
      setClauses.push('total_tests = ?');
      values.push(updates.totalTests);
    }
    if (updates.passedTests !== undefined) {
      setClauses.push('passed_tests = ?');
      values.push(updates.passedTests);
    }
    if (updates.failedTests !== undefined) {
      setClauses.push('failed_tests = ?');
      values.push(updates.failedTests);
    }
    if (updates.skippedTests !== undefined) {
      setClauses.push('skipped_tests = ?');
      values.push(updates.skippedTests);
    }
    if (updates.totalDurationMs !== undefined) {
      setClauses.push('total_duration_ms = ?');
      values.push(updates.totalDurationMs);
    }

    if (setClauses.length === 0) return;

    values.push(runId);
    const stmt = this.db.prepare(`UPDATE test_runs SET ${setClauses.join(', ')} WHERE id = ?`);
    stmt.run(...values);
  }

  /**
   * Finalize a test run with final statistics
   */
  finalizeTestRun(runId: number): void {
    // Calculate stats from test_results
    const statsStmt = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN passed = 1 AND skipped = 0 THEN 1 ELSE 0 END) as passed,
        SUM(CASE WHEN passed = 0 AND skipped = 0 THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN skipped = 1 THEN 1 ELSE 0 END) as skipped,
        SUM(duration_ms) as total_duration
      FROM test_results WHERE run_id = ?
    `);
    const stats = statsStmt.get(runId) as any;

    const status: RunStatus = stats.failed > 0 ? 'failed' : 'passed';

    this.updateTestRun(runId, {
      status,
      totalTests: stats.total || 0,
      passedTests: stats.passed || 0,
      failedTests: stats.failed || 0,
      skippedTests: stats.skipped || 0,
      totalDurationMs: stats.total_duration || 0,
    });
  }

  /**
   * Get a test run by ID
   */
  getTestRun(runId: number): TestRun | null {
    const stmt = this.db.prepare('SELECT * FROM test_runs WHERE id = ?');
    const row = stmt.get(runId) as any;
    if (!row) return null;

    const gitInfo = this.getGitInfoForRun(runId);
    const tags = this.getTagsForRun(runId);

    return {
      id: row.id,
      runDate: row.run_date,
      status: row.status as RunStatus,
      totalTests: row.total_tests,
      passedTests: row.passed_tests,
      failedTests: row.failed_tests,
      skippedTests: row.skipped_tests,
      totalDurationMs: row.total_duration_ms,
      environment: row.environment,
      triggerType: row.trigger_type as TriggerType,
      gitInfo: gitInfo ?? undefined,
      tags,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }

  /**
   * Add git information to a test run
   */
  addGitInfo(runId: number, gitInfo: GitInfo): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO git_info
      (run_id, commit_hash, branch, author, author_email, commit_message, commit_date, parent_commits, files_changed, insertions, deletions)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      runId,
      gitInfo.commitHash,
      gitInfo.branch ?? null,
      gitInfo.author ?? null,
      gitInfo.authorEmail ?? null,
      gitInfo.commitMessage ?? null,
      gitInfo.commitDate ?? null,
      gitInfo.parentCommits ? JSON.stringify(gitInfo.parentCommits) : null,
      gitInfo.diffStats?.filesChanged ?? null,
      gitInfo.diffStats?.insertions ?? null,
      gitInfo.diffStats?.deletions ?? null
    );
  }

  /**
   * Get git info for a run
   */
  getGitInfoForRun(runId: number): GitInfo | null {
    const stmt = this.db.prepare('SELECT * FROM git_info WHERE run_id = ?');
    const row = stmt.get(runId) as any;
    if (!row) return null;

    return {
      commitHash: row.commit_hash,
      branch: row.branch,
      author: row.author,
      authorEmail: row.author_email,
      commitMessage: row.commit_message,
      commitDate: row.commit_date,
      parentCommits: row.parent_commits ? JSON.parse(row.parent_commits) : undefined,
      diffStats: row.files_changed !== null ? {
        filesChanged: row.files_changed,
        insertions: row.insertions,
        deletions: row.deletions,
      } : undefined,
    };
  }

  /**
   * Add tags to a test run
   */
  addTagsToRun(runId: number, tagNames: string[]): void {
    const stmt = this.db.prepare('INSERT OR IGNORE INTO run_tags (run_id, tag_id) VALUES (?, ?)');

    const insertMany = this.db.transaction((names: string[]) => {
      for (const name of names) {
        const tagId = this.upsertTag(name);
        stmt.run(runId, tagId);
      }
    });

    insertMany(tagNames);
  }

  /**
   * Get tags for a run
   */
  getTagsForRun(runId: number): Tag[] {
    const stmt = this.db.prepare(`
      SELECT t.* FROM tags t
      JOIN run_tags rt ON t.id = rt.tag_id
      WHERE rt.run_id = ?
      ORDER BY t.name
    `);

    return (stmt.all(runId) as any[]).map(row => ({
      id: row.id,
      name: row.name,
      category: row.category,
      color: row.color,
      description: row.description,
    }));
  }

  /**
   * Remove a tag from a run
   */
  removeTagFromRun(runId: number, tagName: string): void {
    const tag = this.getTagByName(tagName);
    if (!tag?.id) return;

    const stmt = this.db.prepare('DELETE FROM run_tags WHERE run_id = ? AND tag_id = ?');
    stmt.run(runId, tag.id);
  }

  // ============ Test Result Operations (Phase 5) ============

  /**
   * Add a test result to a run
   */
  addTestResult(result: {
    runId: number;
    testScriptPath: string;
    testName?: string;
    passed: boolean;
    skipped?: boolean;
    durationMs?: number;
    errorMessage?: string;
    stackTrace?: string;
    stdout?: string;
    stderr?: string;
    retryCount?: number;
    metadata?: Record<string, unknown>;
  }): number {
    // Get or create test script
    const testScriptId = this.upsertTestScript(result.testScriptPath, result.durationMs);

    const stmt = this.db.prepare(`
      INSERT INTO test_results
      (run_id, test_script_id, test_name, passed, skipped, duration_ms, error_message, stack_trace, stdout, stderr, retry_count, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertResult = stmt.run(
      result.runId,
      testScriptId,
      result.testName ?? null,
      result.passed ? 1 : 0,
      result.skipped ? 1 : 0,
      result.durationMs ?? null,
      result.errorMessage ?? null,
      result.stackTrace ?? null,
      result.stdout ?? null,
      result.stderr ?? null,
      result.retryCount ?? 0,
      result.metadata ? JSON.stringify(result.metadata) : null
    );

    // Also update the legacy test_history for backward compatibility
    const gitInfo = this.getGitInfoForRun(result.runId);
    this.recordTestResult(
      result.testScriptPath,
      result.passed,
      result.durationMs,
      gitInfo?.commitHash,
      undefined
    );

    return insertResult.lastInsertRowid as number;
  }

  /**
   * Batch add test results
   */
  batchAddTestResults(runId: number, results: Array<{
    testScriptPath: string;
    testName?: string;
    passed: boolean;
    skipped?: boolean;
    durationMs?: number;
    errorMessage?: string;
    stackTrace?: string;
  }>): void {
    const insertMany = this.db.transaction(() => {
      for (const result of results) {
        this.addTestResult({ runId, ...result });
      }
    });
    insertMany();
  }

  /**
   * Get test results for a run
   */
  getTestResultsForRun(runId: number, filter?: { passed?: boolean; skipped?: boolean }): TestResult[] {
    let sql = `
      SELECT tr.*, ts.script_path
      FROM test_results tr
      JOIN test_scripts ts ON tr.test_script_id = ts.id
      WHERE tr.run_id = ?
    `;
    const params: any[] = [runId];

    if (filter?.passed !== undefined) {
      sql += ' AND tr.passed = ?';
      params.push(filter.passed ? 1 : 0);
    }
    if (filter?.skipped !== undefined) {
      sql += ' AND tr.skipped = ?';
      params.push(filter.skipped ? 1 : 0);
    }

    sql += ' ORDER BY tr.id';

    const stmt = this.db.prepare(sql);
    return (stmt.all(...params) as any[]).map(row => ({
      id: row.id,
      runId: row.run_id,
      testScriptId: row.test_script_id,
      testName: row.test_name,
      passed: row.passed === 1,
      skipped: row.skipped === 1,
      durationMs: row.duration_ms,
      errorMessage: row.error_message,
      stackTrace: row.stack_trace,
      stdout: row.stdout,
      stderr: row.stderr,
      retryCount: row.retry_count,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }

  /**
   * Get failed test results with error details
   */
  getFailedResults(runId: number): Array<TestResult & { scriptPath: string }> {
    const stmt = this.db.prepare(`
      SELECT tr.*, ts.script_path
      FROM test_results tr
      JOIN test_scripts ts ON tr.test_script_id = ts.id
      WHERE tr.run_id = ? AND tr.passed = 0 AND tr.skipped = 0
      ORDER BY tr.id
    `);

    return (stmt.all(runId) as any[]).map(row => ({
      id: row.id,
      runId: row.run_id,
      testScriptId: row.test_script_id,
      testName: row.test_name,
      passed: false,
      skipped: false,
      durationMs: row.duration_ms,
      errorMessage: row.error_message,
      stackTrace: row.stack_trace,
      stdout: row.stdout,
      stderr: row.stderr,
      retryCount: row.retry_count,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      scriptPath: row.script_path,
    }));
  }

  // ============ Report & Trend Operations (Phase 5) ============

  /**
   * Get test runs with optional filtering
   */
  getTestRuns(filter?: ReportFilter, limit = 100, offset = 0): TestRun[] {
    let sql = 'SELECT DISTINCT tr.* FROM test_runs tr';
    const params: any[] = [];
    const conditions: string[] = [];

    // Join with git_info if filtering by branch
    if (filter?.branch) {
      sql += ' LEFT JOIN git_info gi ON tr.id = gi.run_id';
      conditions.push('gi.branch = ?');
      params.push(filter.branch);
    }

    // Join with run_tags if filtering by tags
    if (filter?.tags && filter.tags.length > 0) {
      sql += ' LEFT JOIN run_tags rt ON tr.id = rt.run_id';
      sql += ' LEFT JOIN tags t ON rt.tag_id = t.id';
      const placeholders = filter.tags.map(() => '?').join(',');
      conditions.push(`t.name IN (${placeholders})`);
      params.push(...filter.tags);
    }

    if (filter?.startDate) {
      conditions.push('tr.run_date >= ?');
      params.push(filter.startDate);
    }
    if (filter?.endDate) {
      conditions.push('tr.run_date <= ?');
      params.push(filter.endDate);
    }
    if (filter?.status) {
      conditions.push('tr.status = ?');
      params.push(filter.status);
    }
    if (filter?.environment) {
      conditions.push('tr.environment = ?');
      params.push(filter.environment);
    }
    if (filter?.triggerType) {
      conditions.push('tr.trigger_type = ?');
      params.push(filter.triggerType);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY tr.run_date DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => {
      const gitInfo = this.getGitInfoForRun(row.id);
      const tags = this.getTagsForRun(row.id);

      return {
        id: row.id,
        runDate: row.run_date,
        status: row.status as RunStatus,
        totalTests: row.total_tests,
        passedTests: row.passed_tests,
        failedTests: row.failed_tests,
        skippedTests: row.skipped_tests,
        totalDurationMs: row.total_duration_ms,
        environment: row.environment,
        triggerType: row.trigger_type as TriggerType,
        gitInfo: gitInfo ?? undefined,
        tags,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      };
    });
  }

  /**
   * Get trend data for a time period
   */
  getTrend(filter?: ReportFilter, groupBy: 'day' | 'week' | 'month' = 'day'): TrendDataPoint[] {
    let dateFormat: string;
    switch (groupBy) {
      case 'week':
        dateFormat = '%Y-W%W';
        break;
      case 'month':
        dateFormat = '%Y-%m';
        break;
      default:
        dateFormat = '%Y-%m-%d';
    }

    let sql = `
      SELECT
        strftime('${dateFormat}', tr.run_date) as period,
        COUNT(*) as run_count,
        SUM(tr.total_tests) as total_tests,
        SUM(tr.passed_tests) as passed_tests,
        SUM(tr.failed_tests) as failed_tests,
        AVG(tr.total_duration_ms) as avg_duration
      FROM test_runs tr
    `;

    const params: any[] = [];
    const conditions: string[] = [];

    if (filter?.startDate) {
      conditions.push('tr.run_date >= ?');
      params.push(filter.startDate);
    }
    if (filter?.endDate) {
      conditions.push('tr.run_date <= ?');
      params.push(filter.endDate);
    }
    if (filter?.environment) {
      conditions.push('tr.environment = ?');
      params.push(filter.environment);
    }
    if (filter?.branch) {
      sql += ' LEFT JOIN git_info gi ON tr.id = gi.run_id';
      conditions.push('gi.branch = ?');
      params.push(filter.branch);
    }
    if (filter?.tags && filter.tags.length > 0) {
      sql += ' LEFT JOIN run_tags rt ON tr.id = rt.run_id';
      sql += ' LEFT JOIN tags t ON rt.tag_id = t.id';
      const placeholders = filter.tags.map(() => '?').join(',');
      conditions.push(`t.name IN (${placeholders})`);
      params.push(...filter.tags);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ` GROUP BY period ORDER BY period`;

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => {
      const totalTests = row.total_tests || 0;
      const passedTests = row.passed_tests || 0;
      return {
        date: row.period,
        passRate: totalTests > 0 ? (passedTests / totalTests) * 100 : 0,
        totalTests,
        failedTests: row.failed_tests || 0,
        avgDurationMs: Math.round(row.avg_duration || 0),
        runCount: row.run_count,
      };
    });
  }

  /**
   * Get summary statistics
   */
  getRunSummary(filter?: ReportFilter): TestRunSummary {
    let sql = `
      SELECT
        COUNT(*) as total_runs,
        SUM(total_tests) as total_tests,
        SUM(passed_tests) as passed_tests,
        SUM(failed_tests) as failed_tests,
        AVG(total_duration_ms) as avg_duration
      FROM test_runs tr
    `;

    const params: any[] = [];
    const conditions: string[] = [];

    if (filter?.startDate) {
      conditions.push('tr.run_date >= ?');
      params.push(filter.startDate);
    }
    if (filter?.endDate) {
      conditions.push('tr.run_date <= ?');
      params.push(filter.endDate);
    }
    if (filter?.environment) {
      conditions.push('tr.environment = ?');
      params.push(filter.environment);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    const stmt = this.db.prepare(sql);
    const row = stmt.get(...params) as any;

    const totalTests = row?.total_tests || 0;
    const passedTests = row?.passed_tests || 0;

    // Get flaky tests count (tests with mixed pass/fail in the period)
    const flakyStmt = this.db.prepare(`
      SELECT COUNT(DISTINCT test_script_id) as flaky_count
      FROM test_results
      WHERE run_id IN (SELECT id FROM test_runs WHERE run_date >= COALESCE(?, '1970-01-01') AND run_date <= COALESCE(?, '2100-01-01'))
      GROUP BY test_script_id
      HAVING SUM(passed) > 0 AND SUM(CASE WHEN passed = 0 THEN 1 ELSE 0 END) > 0
    `);
    const flakyRows = flakyStmt.all(filter?.startDate ?? null, filter?.endDate ?? null) as any[];

    return {
      totalRuns: row?.total_runs || 0,
      totalTests,
      passRate: totalTests > 0 ? (passedTests / totalTests) * 100 : 0,
      avgDurationMs: Math.round(row?.avg_duration || 0),
      failedTests: row?.failed_tests || 0,
      flakyTests: flakyRows.length,
    };
  }

  /**
   * Compare two test runs
   */
  compareRuns(runId1: number, runId2: number): {
    run1: TestRun | null;
    run2: TestRun | null;
    newFailures: string[];
    fixedTests: string[];
    newTests: string[];
    removedTests: string[];
    durationChange: number;
  } {
    const run1 = this.getTestRun(runId1);
    const run2 = this.getTestRun(runId2);

    // Get test results for both runs
    const results1 = this.getTestResultsForRun(runId1);
    const results2 = this.getTestResultsForRun(runId2);

    const getTestKey = (r: TestResult) => {
      const stmt = this.db.prepare('SELECT script_path FROM test_scripts WHERE id = ?');
      const row = stmt.get(r.testScriptId) as { script_path: string } | undefined;
      return `${row?.script_path}::${r.testName || ''}`;
    };

    const map1 = new Map(results1.map(r => [getTestKey(r), r]));
    const map2 = new Map(results2.map(r => [getTestKey(r), r]));

    const newFailures: string[] = [];
    const fixedTests: string[] = [];
    const newTests: string[] = [];
    const removedTests: string[] = [];

    // Find new failures and fixed tests
    for (const [key, r2] of map2) {
      const r1 = map1.get(key);
      if (!r1) {
        newTests.push(key);
      } else if (r1.passed && !r2.passed) {
        newFailures.push(key);
      } else if (!r1.passed && r2.passed) {
        fixedTests.push(key);
      }
    }

    // Find removed tests
    for (const key of map1.keys()) {
      if (!map2.has(key)) {
        removedTests.push(key);
      }
    }

    const durationChange = (run2?.totalDurationMs ?? 0) - (run1?.totalDurationMs ?? 0);

    return {
      run1,
      run2,
      newFailures,
      fixedTests,
      newTests,
      removedTests,
      durationChange,
    };
  }

  /**
   * Get runs by tag
   */
  getRunsByTag(tagName: string, limit = 50): TestRun[] {
    return this.getTestRuns({ tags: [tagName] }, limit);
  }

  /**
   * Get runs by commit hash
   */
  getRunsByCommit(commitHash: string): TestRun[] {
    const stmt = this.db.prepare(`
      SELECT tr.* FROM test_runs tr
      JOIN git_info gi ON tr.id = gi.run_id
      WHERE gi.commit_hash = ? OR gi.commit_hash LIKE ?
      ORDER BY tr.run_date DESC
    `);

    const rows = stmt.all(commitHash, `${commitHash}%`) as any[];

    return rows.map(row => {
      const gitInfo = this.getGitInfoForRun(row.id);
      const tags = this.getTagsForRun(row.id);

      return {
        id: row.id,
        runDate: row.run_date,
        status: row.status as RunStatus,
        totalTests: row.total_tests,
        passedTests: row.passed_tests,
        failedTests: row.failed_tests,
        skippedTests: row.skipped_tests,
        totalDurationMs: row.total_duration_ms,
        environment: row.environment,
        triggerType: row.trigger_type as TriggerType,
        gitInfo: gitInfo ?? undefined,
        tags,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      };
    });
  }

  /**
   * Delete old test runs (cleanup)
   */
  deleteOldRuns(beforeDate: string): number {
    const stmt = this.db.prepare('DELETE FROM test_runs WHERE run_date < ?');
    const result = stmt.run(beforeDate);
    return result.changes;
  }

  /**
   * Get report statistics for Phase 5
   */
  getReportStats(): {
    totalRuns: number;
    totalResults: number;
    totalTags: number;
    runsWithGitInfo: number;
  } {
    const runs = (this.db.prepare('SELECT COUNT(*) as cnt FROM test_runs').get() as { cnt: number }).cnt;
    const results = (this.db.prepare('SELECT COUNT(*) as cnt FROM test_results').get() as { cnt: number }).cnt;
    const tags = (this.db.prepare('SELECT COUNT(*) as cnt FROM tags').get() as { cnt: number }).cnt;
    const withGit = (this.db.prepare('SELECT COUNT(*) as cnt FROM git_info').get() as { cnt: number }).cnt;

    return {
      totalRuns: runs,
      totalResults: results,
      totalTags: tags,
      runsWithGitInfo: withGit,
    };
  }
}

/**
 * Initialize a new database with schema
 */
export function initDatabase(dbPath: string): TiaDatabase {
  const db = new TiaDatabase(dbPath);
  db.init();
  return db;
}

// Re-export as default alias
export { TiaDatabase as Database };
