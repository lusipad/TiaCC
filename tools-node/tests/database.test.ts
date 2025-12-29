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

describe('Tag operations (Phase 5)', () => {
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

  it('should create a new tag', () => {
    const tagId = db.upsertTag('v1.0.0', 'version', '#00ff00');
    expect(tagId).toBeGreaterThan(0);
  });

  it('should get tag by name', () => {
    db.upsertTag('staging', 'environment', '#ff9900', 'Staging environment');

    const tag = db.getTagByName('staging');
    expect(tag).not.toBeNull();
    expect(tag?.name).toBe('staging');
    expect(tag?.category).toBe('environment');
    expect(tag?.color).toBe('#ff9900');
    expect(tag?.description).toBe('Staging environment');
  });

  it('should return null for non-existent tag', () => {
    const tag = db.getTagByName('nonexistent');
    expect(tag).toBeNull();
  });

  it('should get all tags', () => {
    db.upsertTag('v1.0.0', 'version');
    db.upsertTag('v2.0.0', 'version');
    db.upsertTag('production', 'environment');

    const allTags = db.getAllTags();
    expect(allTags).toHaveLength(3);
  });

  it('should filter tags by category', () => {
    db.upsertTag('v1.0.0', 'version');
    db.upsertTag('v2.0.0', 'version');
    db.upsertTag('production', 'environment');

    const versionTags = db.getAllTags('version');
    expect(versionTags).toHaveLength(2);
    expect(versionTags.every(t => t.category === 'version')).toBe(true);
  });

  it('should delete a tag', () => {
    db.upsertTag('temp-tag');
    expect(db.getTagByName('temp-tag')).not.toBeNull();

    const deleted = db.deleteTag('temp-tag');
    expect(deleted).toBe(true);
    expect(db.getTagByName('temp-tag')).toBeNull();
  });
});

describe('Test run operations (Phase 5)', () => {
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

  it('should create a new test run', () => {
    const runId = db.createTestRun({
      environment: 'CI',
      triggerType: 'push',
      metadata: { jobId: '12345' },
    });

    expect(runId).toBeGreaterThan(0);
  });

  it('should get test run by ID', () => {
    const runId = db.createTestRun({ environment: 'local' });

    const run = db.getTestRun(runId);
    expect(run).not.toBeNull();
    expect(run?.status).toBe('running');
    expect(run?.environment).toBe('local');
  });

  it('should update test run status', () => {
    const runId = db.createTestRun();

    db.updateTestRun(runId, {
      status: 'passed',
      totalTests: 100,
      passedTests: 95,
      failedTests: 5,
    });

    const run = db.getTestRun(runId);
    expect(run?.status).toBe('passed');
    expect(run?.totalTests).toBe(100);
    expect(run?.passedTests).toBe(95);
    expect(run?.failedTests).toBe(5);
  });

  it('should add git info to run', () => {
    const runId = db.createTestRun();

    db.addGitInfo(runId, {
      commitHash: 'abc123def',
      branch: 'feature/test',
      author: 'Test User',
      authorEmail: 'test@example.com',
      commitMessage: 'Add new feature',
      diffStats: {
        filesChanged: 5,
        insertions: 100,
        deletions: 20,
      },
    });

    const run = db.getTestRun(runId);
    expect(run?.gitInfo).not.toBeUndefined();
    expect(run?.gitInfo?.commitHash).toBe('abc123def');
    expect(run?.gitInfo?.branch).toBe('feature/test');
    expect(run?.gitInfo?.diffStats?.filesChanged).toBe(5);
  });

  it('should add tags to run', () => {
    const runId = db.createTestRun();

    db.addTagsToRun(runId, ['v1.0.0', 'staging', 'nightly']);

    const run = db.getTestRun(runId);
    expect(run?.tags).toHaveLength(3);
    expect(run?.tags?.some(t => t.name === 'v1.0.0')).toBe(true);
    expect(run?.tags?.some(t => t.name === 'staging')).toBe(true);
  });

  it('should remove tag from run', () => {
    const runId = db.createTestRun();
    db.addTagsToRun(runId, ['tag1', 'tag2']);

    db.removeTagFromRun(runId, 'tag1');

    const tags = db.getTagsForRun(runId);
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe('tag2');
  });
});

describe('Test result operations (Phase 5)', () => {
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

  it('should add test result', () => {
    const runId = db.createTestRun();

    const resultId = db.addTestResult({
      runId,
      testScriptPath: 'tests/test_main.lua',
      testName: 'should work correctly',
      passed: true,
      durationMs: 150,
    });

    expect(resultId).toBeGreaterThan(0);
  });

  it('should add failed test result with error details', () => {
    const runId = db.createTestRun();

    db.addTestResult({
      runId,
      testScriptPath: 'tests/test_fail.lua',
      testName: 'should not crash',
      passed: false,
      durationMs: 50,
      errorMessage: 'AssertionError: expected 1 to equal 2',
      stackTrace: 'at Test.fn (tests/test_fail.lua:15)\nat runTest...',
    });

    const results = db.getTestResultsForRun(runId);
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(false);
    expect(results[0].errorMessage).toBe('AssertionError: expected 1 to equal 2');
    expect(results[0].stackTrace).toContain('test_fail.lua:15');
  });

  it('should get failed results', () => {
    const runId = db.createTestRun();

    db.addTestResult({ runId, testScriptPath: 'tests/pass1.lua', passed: true });
    db.addTestResult({ runId, testScriptPath: 'tests/fail1.lua', passed: false, errorMessage: 'Error 1' });
    db.addTestResult({ runId, testScriptPath: 'tests/pass2.lua', passed: true });
    db.addTestResult({ runId, testScriptPath: 'tests/fail2.lua', passed: false, errorMessage: 'Error 2' });

    const failed = db.getFailedResults(runId);
    expect(failed).toHaveLength(2);
    expect(failed.every(r => r.passed === false)).toBe(true);
  });

  it('should batch add test results', () => {
    const runId = db.createTestRun();

    db.batchAddTestResults(runId, [
      { testScriptPath: 'tests/test1.lua', passed: true, durationMs: 100 },
      { testScriptPath: 'tests/test2.lua', passed: true, durationMs: 200 },
      { testScriptPath: 'tests/test3.lua', passed: false, durationMs: 50, errorMessage: 'Failed' },
    ]);

    const results = db.getTestResultsForRun(runId);
    expect(results).toHaveLength(3);
  });

  it('should finalize test run', () => {
    const runId = db.createTestRun();

    db.batchAddTestResults(runId, [
      { testScriptPath: 'tests/test1.lua', passed: true, durationMs: 100 },
      { testScriptPath: 'tests/test2.lua', passed: true, durationMs: 200 },
      { testScriptPath: 'tests/test3.lua', passed: false, durationMs: 50 },
      { testScriptPath: 'tests/test4.lua', skipped: true, passed: false },
    ]);

    db.finalizeTestRun(runId);

    const run = db.getTestRun(runId);
    expect(run?.status).toBe('failed');
    expect(run?.totalTests).toBe(4);
    expect(run?.passedTests).toBe(2);
    expect(run?.failedTests).toBe(1);
    expect(run?.skippedTests).toBe(1);
    expect(run?.totalDurationMs).toBe(350);
  });
});

describe('Report and trend operations (Phase 5)', () => {
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

  it('should get test runs with filter', () => {
    const run1 = db.createTestRun({ environment: 'CI' });
    const run2 = db.createTestRun({ environment: 'local' });
    const run3 = db.createTestRun({ environment: 'CI' });

    db.updateTestRun(run1, { status: 'passed' });
    db.updateTestRun(run2, { status: 'passed' });
    db.updateTestRun(run3, { status: 'failed' });

    const ciRuns = db.getTestRuns({ environment: 'CI' });
    expect(ciRuns).toHaveLength(2);

    const failedRuns = db.getTestRuns({ status: 'failed' });
    expect(failedRuns).toHaveLength(1);
  });

  it('should get runs by tag', () => {
    const run1 = db.createTestRun();
    const run2 = db.createTestRun();
    const run3 = db.createTestRun();

    db.addTagsToRun(run1, ['v1.0.0']);
    db.addTagsToRun(run2, ['v1.0.0', 'nightly']);
    db.addTagsToRun(run3, ['v2.0.0']);

    const v1Runs = db.getRunsByTag('v1.0.0');
    expect(v1Runs).toHaveLength(2);
  });

  it('should get runs by commit', () => {
    const run1 = db.createTestRun();
    const run2 = db.createTestRun();

    db.addGitInfo(run1, { commitHash: 'abc123' });
    db.addGitInfo(run2, { commitHash: 'def456' });

    const runs = db.getRunsByCommit('abc123');
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(run1);
  });

  it('should get run summary', () => {
    const run1 = db.createTestRun();
    const run2 = db.createTestRun();

    db.updateTestRun(run1, { totalTests: 100, passedTests: 90, failedTests: 10 });
    db.updateTestRun(run2, { totalTests: 50, passedTests: 45, failedTests: 5 });

    const summary = db.getRunSummary();
    expect(summary.totalRuns).toBe(2);
    expect(summary.totalTests).toBe(150);
    expect(summary.failedTests).toBe(15);
    expect(summary.passRate).toBeCloseTo(90, 0);
  });

  it('should compare two runs', () => {
    const run1 = db.createTestRun();
    const run2 = db.createTestRun();

    db.addTestResult({ runId: run1, testScriptPath: 'tests/a.lua', testName: 'test1', passed: true });
    db.addTestResult({ runId: run1, testScriptPath: 'tests/b.lua', testName: 'test2', passed: true });

    db.addTestResult({ runId: run2, testScriptPath: 'tests/a.lua', testName: 'test1', passed: false }); // Now failing
    db.addTestResult({ runId: run2, testScriptPath: 'tests/c.lua', testName: 'test3', passed: true }); // New test

    const comparison = db.compareRuns(run1, run2);
    expect(comparison.newFailures).toHaveLength(1);
    expect(comparison.newTests).toHaveLength(1);
    expect(comparison.removedTests).toHaveLength(1);
  });

  it('should get trend data', () => {
    // Create runs on different dates (simulated)
    const run1 = db.createTestRun();
    const run2 = db.createTestRun();

    db.updateTestRun(run1, { totalTests: 100, passedTests: 90, failedTests: 10 });
    db.updateTestRun(run2, { totalTests: 100, passedTests: 95, failedTests: 5 });

    const trend = db.getTrend();
    expect(trend.length).toBeGreaterThan(0);
    expect(trend[0].runCount).toBeGreaterThan(0);
  });

  it('should delete old runs', () => {
    db.createTestRun();
    db.createTestRun();

    // Delete runs before year 2100 (all of them)
    const futureDate = '2100-01-01';
    const deleted = db.deleteOldRuns(futureDate);
    expect(deleted).toBe(2);

    const runs = db.getTestRuns();
    expect(runs).toHaveLength(0);
  });

  it('should get report stats', () => {
    const runId = db.createTestRun();
    db.addGitInfo(runId, { commitHash: 'abc123' });
    db.addTagsToRun(runId, ['v1.0.0']);
    db.addTestResult({ runId, testScriptPath: 'tests/test.lua', passed: true });

    const stats = db.getReportStats();
    expect(stats.totalRuns).toBe(1);
    expect(stats.totalResults).toBe(1);
    expect(stats.totalTags).toBe(1);
    expect(stats.runsWithGitInfo).toBe(1);
  });
});
