/**
 * SQLite database operations for test impact mapping.
 */

import Database from 'better-sqlite3';
import type { DbStats, SourceFile, TestScript, CoverageRun, Symbol, SymbolType, CoveredSymbol, FunctionTestMapping } from './types.js';

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
