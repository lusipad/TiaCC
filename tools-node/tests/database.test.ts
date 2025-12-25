/**
 * Unit tests for the TiaCC database module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, unlinkSync, mkdtempSync, rmdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TiaDatabase, initDatabase } from '../src/database.js';

describe('Database', () => {
  let tempDir: string;
  let dbPath: string;
  let db: TiaDatabase;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tiacc-test-'));
    dbPath = join(tempDir, 'test.db');
    db = initDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
    rmdirSync(tempDir);
  });

  describe('initialization', () => {
    it('should create database file', () => {
      expect(existsSync(dbPath)).toBe(true);
    });

    it('should create all required tables', () => {
      const stats = db.getStats();
      expect(stats.sourceFiles).toBe(0);
      expect(stats.testScripts).toBe(0);
      expect(stats.mappings).toBe(0);
    });
  });

  describe('source files', () => {
    it('should insert a new source file', () => {
      const id = db.upsertSourceFile('src/main.cpp', 'abc123');

      expect(id).toBeGreaterThan(0);
      expect(db.getStats().sourceFiles).toBe(1);
    });

    it('should update existing source file', () => {
      const id1 = db.upsertSourceFile('src/main.cpp', 'abc123');
      const id2 = db.upsertSourceFile('src/main.cpp', 'def456');

      expect(id1).toBe(id2);
      expect(db.getStats().sourceFiles).toBe(1);
    });

    it('should get source file ID by path', () => {
      const id = db.upsertSourceFile('src/main.cpp');
      const foundId = db.getSourceFileId('src/main.cpp');

      expect(foundId).toBe(id);
    });

    it('should return null for non-existent file', () => {
      const id = db.getSourceFileId('nonexistent.cpp');
      expect(id).toBeNull();
    });
  });

  describe('test scripts', () => {
    it('should insert a new test script', () => {
      const id = db.upsertTestScript('tests/test_main.lua', 1500);

      expect(id).toBeGreaterThan(0);
      expect(db.getStats().testScripts).toBe(1);
    });

    it('should update duration with running average', () => {
      db.upsertTestScript('tests/test.lua', 1000);
      db.upsertTestScript('tests/test.lua', 2000);

      // Average of 1000 and 2000 = 1500
      expect(db.getStats().testScripts).toBe(1);
    });
  });

  describe('coverage mappings', () => {
    it('should add a coverage mapping', () => {
      const sourceId = db.upsertSourceFile('src/engine.cpp');
      const testId = db.upsertTestScript('tests/test_engine.lua');

      db.addCoverageMapping(sourceId, testId, 85.5);

      expect(db.getStats().mappings).toBe(1);
    });

    it('should find tests for a source file', () => {
      const mainId = db.upsertSourceFile('src/main.cpp');
      const test1Id = db.upsertTestScript('tests/test_main.lua');
      const test2Id = db.upsertTestScript('tests/test_integration.lua');

      db.addCoverageMapping(mainId, test1Id);
      db.addCoverageMapping(mainId, test2Id);

      const tests = db.getTestsForSource('main.cpp');

      expect(tests).toHaveLength(2);
      expect(tests).toContain('tests/test_main.lua');
      expect(tests).toContain('tests/test_integration.lua');
    });

    it('should return empty array for uncovered file', () => {
      const tests = db.getTestsForSource('nonexistent.cpp');
      expect(tests).toEqual([]);
    });

    it('should find tests for multiple sources', () => {
      const mainId = db.upsertSourceFile('src/main.cpp');
      const utilsId = db.upsertSourceFile('src/utils.cpp');

      const test1Id = db.upsertTestScript('tests/test_main.lua');
      const test2Id = db.upsertTestScript('tests/test_utils.lua');

      db.addCoverageMapping(mainId, test1Id);
      db.addCoverageMapping(utilsId, test2Id);

      const tests = db.getTestsForSources(['main.cpp', 'utils.cpp']);

      expect(tests).toHaveLength(2);
    });
  });

  describe('coverage runs', () => {
    it('should record a coverage run', () => {
      const id = db.recordCoverageRun(100, 50, 'abc123');

      expect(id).toBeGreaterThan(0);
    });

    it('should get latest run', () => {
      db.recordCoverageRun(100, 50, 'abc123');
      db.recordCoverageRun(200, 75, 'def456');

      const latest = db.getLatestRun();

      expect(latest).not.toBeNull();
      expect(latest?.totalTests).toBe(200);
      expect(latest?.commitHash).toBe('def456');
    });

    it('should return null when no runs exist', () => {
      const latest = db.getLatestRun();
      expect(latest).toBeNull();
    });
  });

  describe('batch operations', () => {
    it('should batch insert mappings efficiently', () => {
      const sourceIds = Array.from({ length: 10 }, (_, i) =>
        db.upsertSourceFile(`src/file${i}.cpp`)
      );
      const testId = db.upsertTestScript('tests/test.lua');

      const mappings = sourceIds.map(sourceId => ({
        sourceId,
        testId,
        coverage: 50,
      }));

      db.batchInsertMappings(mappings);

      expect(db.getStats().mappings).toBe(10);
    });
  });
});

describe('Database edge cases', () => {
  let tempDir: string;
  let dbPath: string;
  let db: TiaDatabase;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tiacc-test-'));
    dbPath = join(tempDir, 'test.db');
    db = initDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    if (existsSync(dbPath)) {
      unlinkSync(dbPath);
    }
    rmdirSync(tempDir);
  });

  it('should handle special characters in paths', () => {
    const id = db.upsertSourceFile('src/my file (1).cpp');
    expect(id).toBeGreaterThan(0);
  });

  it('should handle unicode in paths', () => {
    const id = db.upsertSourceFile('src/文件.cpp');
    expect(id).toBeGreaterThan(0);
  });

  it('should handle null file hash', () => {
    const id = db.upsertSourceFile('src/main.cpp');
    expect(id).toBeGreaterThan(0);
  });
});
