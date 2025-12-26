/**
 * SQLite database operations for test impact mapping.
 */

import Database from 'better-sqlite3';
import type { DbStats, SourceFile, TestScript, CoverageRun, Symbol, SymbolType, CoveredSymbol, FunctionTestMapping } from './types.js';

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
    // Use LIKE for fuzzy matching to handle path differences
    const fileName = filePath.split(/[/\\]/).pop() ?? filePath;

    const stmt = this.db.prepare(`
      SELECT DISTINCT ts.script_path
      FROM coverage_map cm
      JOIN source_files sf ON cm.source_file_id = sf.id
      JOIN test_scripts ts ON cm.test_script_id = ts.id
      WHERE sf.file_path LIKE ?
    `);

    const rows = stmt.all(`%${fileName}`) as { script_path: string }[];
    return rows.map(r => r.script_path);
  }

  /**
   * Get all tests that cover any of the given source files
   */
  getTestsForSources(filePaths: string[]): string[] {
    const testsSet = new Set<string>();

    for (const path of filePaths) {
      const tests = this.getTestsForSource(path);
      tests.forEach(t => testsSet.add(t));
    }

    return Array.from(testsSet).sort();
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
      SELECT * FROM coverage_runs ORDER BY run_date DESC LIMIT 1
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
    const stmt = this.db.prepare(`
      SELECT
        CASE
          WHEN INSTR(sf.file_path, '/') > 0
          THEN SUBSTR(sf.file_path, 1,
            LENGTH(sf.file_path) - LENGTH(SUBSTR(sf.file_path,
              LENGTH(sf.file_path) - INSTR(REVERSE(sf.file_path), '/') + 2)))
          ELSE '.'
        END as directory,
        COUNT(DISTINCT sf.id) as file_count,
        AVG(cm.line_coverage_pct) as avg_coverage,
        COUNT(DISTINCT cm.test_script_id) as test_count
      FROM source_files sf
      LEFT JOIN coverage_map cm ON sf.id = cm.source_file_id
      GROUP BY directory
      ORDER BY file_count DESC
    `);
    const rows = stmt.all() as any[];
    return rows.map(row => ({
      directory: row.directory || '.',
      fileCount: row.file_count,
      avgCoverage: row.avg_coverage || 0,
      testCount: row.test_count || 0,
    }));
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
