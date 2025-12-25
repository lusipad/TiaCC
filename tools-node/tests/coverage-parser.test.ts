/**
 * Unit tests for the coverage parser module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmdirSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { CSharpCoverageParser, getParserForFile } from '../src/coverage-parser.js';

describe('CSharpCoverageParser', () => {
  let tempDir: string;
  let parser: CSharpCoverageParser;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tiacc-test-'));
    parser = new CSharpCoverageParser();
  });

  afterEach(() => {
    // Clean up temp files
    const files = ['test.coverage.json', 'empty.coverage.json', 'invalid.coverage.json', 'nocov.coverage.json'];
    for (const file of files) {
      const path = join(tempDir, file);
      if (existsSync(path)) {
        unlinkSync(path);
      }
    }
    rmdirSync(tempDir);
  });

  it('should return correct file extension', () => {
    expect(parser.getFileExtension()).toBe('.coverage.json');
  });

  it('should parse valid coverage file', async () => {
    const coverageData = {
      MyAssembly: {
        'src/Engine.cs': {
          'MyNamespace.Engine.Update': {
            Lines: { '10': 5, '11': 5, '12': 0 }
          }
        },
        'src/Utils.cs': {
          'MyNamespace.Utils.Helper': {
            Lines: { '1': 1, '2': 1 }
          }
        }
      }
    };

    const coverageFile = join(tempDir, 'test.coverage.json');
    writeFileSync(coverageFile, JSON.stringify(coverageData));

    const result = await parser.parse(coverageFile);

    expect(result).not.toBeNull();
    expect(result!.testId).toBe('test');
    expect(result!.coveredFiles).toHaveLength(2);
    expect(result!.coveredFiles).toContain('src/Engine.cs');
    expect(result!.coveredFiles).toContain('src/Utils.cs');
    expect(result!.totalLines).toBe(5);
    expect(result!.coveredLines).toBe(4);
  });

  it('should parse empty coverage file', async () => {
    const coverageFile = join(tempDir, 'empty.coverage.json');
    writeFileSync(coverageFile, '{}');

    const result = await parser.parse(coverageFile);

    expect(result).not.toBeNull();
    expect(result!.coveredFiles).toEqual([]);
  });

  it('should return null for non-existent file', async () => {
    const result = await parser.parse(join(tempDir, 'nonexistent.json'));
    expect(result).toBeNull();
  });

  it('should return null for invalid JSON', async () => {
    const coverageFile = join(tempDir, 'invalid.coverage.json');
    writeFileSync(coverageFile, 'not valid json');

    const result = await parser.parse(coverageFile);
    expect(result).toBeNull();
  });

  it('should exclude files with no covered lines', async () => {
    const coverageData = {
      MyAssembly: {
        'src/Unused.cs': {
          'MyNamespace.Unused.Method': {
            Lines: { '1': 0, '2': 0, '3': 0 }
          }
        }
      }
    };

    const coverageFile = join(tempDir, 'nocov.coverage.json');
    writeFileSync(coverageFile, JSON.stringify(coverageData));

    const result = await parser.parse(coverageFile);

    expect(result).not.toBeNull();
    expect(result!.coveredFiles).toEqual([]);
  });
});

describe('getParserForFile', () => {
  it('should return CSharpCoverageParser for .coverage.json files', () => {
    const parser = getParserForFile('test.coverage.json');
    expect(parser).toBeInstanceOf(CSharpCoverageParser);
  });

  it('should return null for unknown file types', () => {
    const parser = getParserForFile('test.unknown');
    expect(parser).toBeNull();
  });

  it('should return null for regular JSON files', () => {
    const parser = getParserForFile('config.json');
    expect(parser).toBeNull();
  });
});
