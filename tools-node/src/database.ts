/**
 * SQLite database operations for test impact mapping.
 */

import Database from 'better-sqlite3';
import type { DbStats, SourceFile, TestScript, CoverageRun } from './types.js';

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
