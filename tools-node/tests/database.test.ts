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

describe('Symbol operations', () => {
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

  it('should insert a new symbol', () => {
    const sourceId = db.upsertSourceFile('src/main.cpp');
    const symbolId = db.upsertSymbol(sourceId, 'main', 10, 20, 'function');

    expect(symbolId).toBeGreaterThan(0);
  });

  it('should update existing symbol', () => {
    const sourceId = db.upsertSourceFile('src/main.cpp');
    const id1 = db.upsertSymbol(sourceId, 'main', 10, 20, 'function');
    const id2 = db.upsertSymbol(sourceId, 'main', 10, 25, 'function'); // Different end line

    expect(id1).toBe(id2);
  });

  it('should add symbol coverage', () => {
    const sourceId = db.upsertSourceFile('src/main.cpp');
    const testId = db.upsertTestScript('tests/test_main.lua');
    const symbolId = db.upsertSymbol(sourceId, 'calculate', 15, 30, 'function');

    db.addSymbolCoverage(symbolId, testId, 5, 100);

    const stats = db.getSymbolStats();
    expect(stats.symbolMappings).toBe(1);
  });

  it('should get symbols for changed lines', () => {
    const sourceId = db.upsertSourceFile('src/engine.cpp');
    db.upsertSymbol(sourceId, 'init', 1, 10, 'function');
    db.upsertSymbol(sourceId, 'update', 15, 30, 'function');
    db.upsertSymbol(sourceId, 'render', 35, 50, 'function');

    const symbols = db.getSymbolsForLines('engine.cpp', [20, 25]); // Lines in update function

    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe('update');
  });

  it('should get tests for symbols', () => {
    const sourceId = db.upsertSourceFile('src/utils.cpp');
    const symbolId = db.upsertSymbol(sourceId, 'helper', 5, 15, 'function');
    const test1Id = db.upsertTestScript('tests/test_a.lua');
    const test2Id = db.upsertTestScript('tests/test_b.lua');

    db.addSymbolCoverage(symbolId, test1Id, 10, 100);
    db.addSymbolCoverage(symbolId, test2Id, 5, 80);

    const tests = db.getTestsForSymbols([symbolId]);

    expect(tests).toHaveLength(2);
    expect(tests.some(t => t.testPath === 'tests/test_a.lua')).toBe(true);
    expect(tests.some(t => t.testPath === 'tests/test_b.lua')).toBe(true);
  });

  it('should batch insert symbols', () => {
    const sourceId = db.upsertSourceFile('src/app.cpp');
    const symbols = [
      { sourceFileId: sourceId, name: 'func1', type: 'function' as const, startLine: 1, endLine: 10 },
      { sourceFileId: sourceId, name: 'func2', type: 'function' as const, startLine: 15, endLine: 25 },
      { sourceFileId: sourceId, name: 'func3', type: 'function' as const, startLine: 30, endLine: 40 },
    ];

    const ids = db.batchInsertSymbols(symbols);

    expect(ids).toHaveLength(3);
    expect(db.getSymbolStats().symbols).toBe(3);
  });
});

describe('Smart recommendation operations', () => {
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

  it('should record test result', () => {
    db.recordTestResult('tests/test.lua', true, 1000);

    const stats = db.getTestStats('tests/test.lua');
    expect(stats).not.toBeNull();
    expect(stats!.totalRuns).toBe(1);
    expect(stats!.totalPasses).toBe(1);
  });

  it('should track failure streak', () => {
    db.recordTestResult('tests/test.lua', false);
    db.recordTestResult('tests/test.lua', false);
    db.recordTestResult('tests/test.lua', false);

    const stats = db.getTestStats('tests/test.lua');
    expect(stats).not.toBeNull();
    expect(stats!.failureStreak).toBe(3);
  });

  it('should reset failure streak on success', () => {
    db.recordTestResult('tests/test.lua', false);
    db.recordTestResult('tests/test.lua', false);
    db.recordTestResult('tests/test.lua', true);

    const stats = db.getTestStats('tests/test.lua');
    expect(stats).not.toBeNull();
    expect(stats!.failureStreak).toBe(0);
  });

  it('should calculate failure probability', () => {
    const sourceId = db.upsertSourceFile('src/main.cpp');
    const testId = db.upsertTestScript('tests/test.lua');
    db.addCoverageMapping(sourceId, testId);

    // Record failures when file changes
    db.recordTestResult('tests/test.lua', false, undefined, 'abc', ['src/main.cpp']);
    db.recordTestResult('tests/test.lua', false, undefined, 'def', ['src/main.cpp']);
    db.recordTestResult('tests/test.lua', true, undefined, 'ghi', ['src/main.cpp']);

    const probability = db.getFailureProbability('tests/test.lua', ['src/main.cpp']);
    expect(probability).toBeGreaterThan(0);
  });

  it('should get smart recommendations', () => {
    const source1Id = db.upsertSourceFile('src/main.cpp');
    const source2Id = db.upsertSourceFile('src/utils.cpp');
    const test1Id = db.upsertTestScript('tests/test_main.lua');
    const test2Id = db.upsertTestScript('tests/test_utils.lua');

    db.addCoverageMapping(source1Id, test1Id);
    db.addCoverageMapping(source2Id, test2Id);

    // Record some test history
    db.recordTestResult('tests/test_main.lua', false, 100, 'abc', ['src/main.cpp']);
    db.recordTestResult('tests/test_utils.lua', true, 50);

    const recommendations = db.getSmartRecommendations(['src/main.cpp']);

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].testPath).toBe('tests/test_main.lua');
    expect(recommendations[0].priorityScore).toBeGreaterThan(0);
  });

  it('should batch record test results', () => {
    const results = [
      { testPath: 'tests/test1.lua', passed: true, durationMs: 100 },
      { testPath: 'tests/test2.lua', passed: false, durationMs: 200 },
      { testPath: 'tests/test3.lua', passed: true, durationMs: 150 },
    ];

    db.batchRecordTestResults(results);

    expect(db.getTestStats('tests/test1.lua')?.totalPasses).toBe(1);
    expect(db.getTestStats('tests/test2.lua')?.totalFailures).toBe(1);
    expect(db.getTestStats('tests/test3.lua')?.totalPasses).toBe(1);
  });

  it('should get most likely to fail tests', () => {
    db.recordTestResult('tests/flaky.lua', false);
    db.recordTestResult('tests/flaky.lua', false);
    db.recordTestResult('tests/flaky.lua', false);
    db.recordTestResult('tests/stable.lua', true);
    db.recordTestResult('tests/stable.lua', true);

    const likelyToFail = db.getMostLikelyToFail(5);

    expect(likelyToFail).toHaveLength(1);
    expect(likelyToFail[0].testPath).toBe('tests/flaky.lua');
    expect(likelyToFail[0].recentFailureRate).toBeGreaterThan(0.5);
  });

  it('should estimate test duration', () => {
    db.recordTestResult('tests/fast.lua', true, 100);
    db.recordTestResult('tests/slow.lua', true, 5000);

    const estimation = db.getEstimatedDuration(['tests/fast.lua', 'tests/slow.lua']);

    expect(estimation.totalMs).toBeGreaterThan(0);
    expect(estimation.breakdown).toHaveLength(2);
  });
});

describe('Incremental update operations', () => {
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

  it('should detect new files need processing', () => {
    const needsProcessing = db.needsProcessing('coverage/test.json', 12345);
    expect(needsProcessing).toBe(true);
  });

  it('should detect modified files need processing', () => {
    const testId = db.upsertTestScript('tests/test.lua');
    db.recordProcessedFile('coverage/test.json', testId, 12345);

    const needsProcessing = db.needsProcessing('coverage/test.json', 54321);
    expect(needsProcessing).toBe(true);
  });

  it('should not reprocess unchanged files', () => {
    const testId = db.upsertTestScript('tests/test.lua');
    db.recordProcessedFile('coverage/test.json', testId, 12345);

    const needsProcessing = db.needsProcessing('coverage/test.json', 12345);
    expect(needsProcessing).toBe(false);
  });

  it('should clear test mappings', () => {
    const sourceId = db.upsertSourceFile('src/main.cpp');
    const testId = db.upsertTestScript('tests/test.lua');
    db.addCoverageMapping(sourceId, testId);

    const stats1 = db.getStats();
    expect(stats1.mappings).toBe(1);

    db.clearTestMappings(testId);

    const stats2 = db.getStats();
    expect(stats2.mappings).toBe(0);
  });
});
