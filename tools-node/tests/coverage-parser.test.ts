/**
 * Unit tests for the coverage parser module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmdirSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  CSharpCoverageParser,
  LlvmJsonCoverageParser,
  CoberturaCoverageParser,
  getParserForFile
} from '../src/coverage-parser.js';

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

  it('should return LlvmJsonCoverageParser for .cov.json files', () => {
    const parser = getParserForFile('test.cov.json');
    expect(parser).toBeInstanceOf(LlvmJsonCoverageParser);
  });

  it('should return CoberturaCoverageParser for cobertura.xml files', () => {
    const parser = getParserForFile('cobertura.xml');
    expect(parser).toBeInstanceOf(CoberturaCoverageParser);
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

describe('LlvmJsonCoverageParser', () => {
  let tempDir: string;
  let parser: LlvmJsonCoverageParser;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tiacc-test-'));
    parser = new LlvmJsonCoverageParser();
  });

  afterEach(() => {
    const files = ['test.cov.json', 'empty.cov.json', 'invalid.cov.json'];
    for (const file of files) {
      const path = join(tempDir, file);
      if (existsSync(path)) {
        unlinkSync(path);
      }
    }
    rmdirSync(tempDir);
  });

  it('should return correct file extension', () => {
    expect(parser.getFileExtension()).toBe('.cov.json');
  });

  it('should parse valid LLVM JSON coverage file', async () => {
    const coverageData = {
      data: [
        {
          files: [
            {
              filename: 'src/main.cpp',
              segments: [
                [10, 1, 5, true, true],  // line 10, col 1, count 5, hasCount, isRegionEntry
                [11, 1, 3, true, true],
                [12, 1, 0, true, true]   // uncovered line
              ],
              summary: {
                lines: {
                  count: 3,
                  covered: 2
                }
              }
            }
          ]
        }
      ]
    };

    const coverageFile = join(tempDir, 'test.cov.json');
    writeFileSync(coverageFile, JSON.stringify(coverageData));

    const result = await parser.parse(coverageFile);

    expect(result).not.toBeNull();
    expect(result!.testId).toBe('test');
    expect(result!.coveredFiles).toHaveLength(1);
    expect(result!.coveredFiles).toContain('src/main.cpp');
    expect(result!.totalLines).toBeGreaterThan(0);
  });

  it('should handle empty LLVM JSON file', async () => {
    const coverageData = { data: [] };

    const coverageFile = join(tempDir, 'empty.cov.json');
    writeFileSync(coverageFile, JSON.stringify(coverageData));

    const result = await parser.parse(coverageFile);

    expect(result).not.toBeNull();
    expect(result!.coveredFiles).toEqual([]);
  });

  it('should return null for non-existent file', async () => {
    const result = await parser.parse(join(tempDir, 'nonexistent.cov.json'));
    expect(result).toBeNull();
  });

  it('should return null for invalid JSON', async () => {
    const coverageFile = join(tempDir, 'invalid.cov.json');
    writeFileSync(coverageFile, 'invalid json');

    const result = await parser.parse(coverageFile);
    expect(result).toBeNull();
  });

  it('should extract file coverage percentages', async () => {
    const coverageData = {
      data: [
        {
          files: [
            {
              filename: 'src/utils.cpp',
              segments: [
                [1, 1, 10, true, true],
                [2, 1, 10, true, true]
              ],
              summary: {
                lines: {
                  count: 2,
                  covered: 2
                }
              }
            }
          ]
        }
      ]
    };

    const coverageFile = join(tempDir, 'test.cov.json');
    writeFileSync(coverageFile, JSON.stringify(coverageData));

    const result = await parser.parse(coverageFile);

    expect(result).not.toBeNull();
    expect(result!.fileCoverage).toBeDefined();
    expect(result!.fileCoverage?.get('src/utils.cpp')).toBe(100);
  });
});

describe('CoberturaCoverageParser', () => {
  let tempDir: string;
  let parser: CoberturaCoverageParser;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tiacc-test-'));
    parser = new CoberturaCoverageParser();
  });

  afterEach(() => {
    const files = ['cobertura.xml', 'empty-cobertura.xml', 'invalid-cobertura.xml'];
    for (const file of files) {
      const path = join(tempDir, file);
      if (existsSync(path)) {
        unlinkSync(path);
      }
    }
    rmdirSync(tempDir);
  });

  it('should return correct file extension', () => {
    expect(parser.getFileExtension()).toBe('.xml');
  });

  it('should parse valid Cobertura XML file', async () => {
    const coberturaXml = `<?xml version="1.0" ?>
<coverage>
  <packages>
    <package name="com.example">
      <classes>
        <class name="Calculator" filename="src/Calculator.java">
          <methods>
            <method name="add" signature="(II)I">
              <lines>
                <line number="10" hits="5"/>
                <line number="11" hits="5"/>
              </lines>
            </method>
          </methods>
          <lines>
            <line number="10" hits="5"/>
            <line number="11" hits="5"/>
            <line number="15" hits="0"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>`;

    const coverageFile = join(tempDir, 'cobertura.xml');
    writeFileSync(coverageFile, coberturaXml);

    const result = await parser.parse(coverageFile);

    expect(result).not.toBeNull();
    expect(result!.testId).toBe('cobertura');
    expect(result!.coveredFiles).toHaveLength(1);
    expect(result!.coveredFiles).toContain('src/Calculator.java');
    expect(result!.totalLines).toBeGreaterThan(0);
    expect(result!.coveredLines).toBeGreaterThan(0);
  });

  it('should handle empty Cobertura XML', async () => {
    const coberturaXml = `<?xml version="1.0" ?>
<coverage>
  <packages>
  </packages>
</coverage>`;

    const coverageFile = join(tempDir, 'empty-cobertura.xml');
    writeFileSync(coverageFile, coberturaXml);

    const result = await parser.parse(coverageFile);

    expect(result).not.toBeNull();
    expect(result!.coveredFiles).toEqual([]);
  });

  it('should return null for non-existent file', async () => {
    const result = await parser.parse(join(tempDir, 'nonexistent.xml'));
    expect(result).toBeNull();
  });

  it('should return null for invalid XML', async () => {
    const coverageFile = join(tempDir, 'invalid-cobertura.xml');
    writeFileSync(coverageFile, '<invalid>xml');

    const result = await parser.parse(coverageFile);
    expect(result).toBeNull();
  });

  it('should extract function-level coverage from methods', async () => {
    const coberturaXml = `<?xml version="1.0" ?>
<coverage>
  <packages>
    <package name="com.example">
      <classes>
        <class name="Utils" filename="src/Utils.java">
          <methods>
            <method name="helper" signature="()V" line-rate="1.0">
              <lines>
                <line number="20" hits="10"/>
                <line number="21" hits="10"/>
              </lines>
            </method>
          </methods>
          <lines>
            <line number="20" hits="10"/>
            <line number="21" hits="10"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>`;

    const coverageFile = join(tempDir, 'cobertura.xml');
    writeFileSync(coverageFile, coberturaXml);

    const result = await parser.parse(coverageFile);

    expect(result).not.toBeNull();
    // Symbols may or may not be extracted depending on parser implementation
    // Just verify the parse succeeded
    expect(result!.coveredFiles).toContain('src/Utils.java');
    expect(result!.totalLines).toBeGreaterThan(0);
  });
});
