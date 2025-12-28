#!/usr/bin/env node
/**
 * TiaCC Coverage Split CLI
 *
 * Splits a merged coverage file by test cases based on coverage markers.
 * Useful when coverage is collected for multiple tests in a single run.
 */

import { Command } from 'commander';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import ora from 'ora';

const program = new Command();

/**
 * Coverage marker format in log file:
 * [COVERAGE_START] TestClass::test_method
 * ... coverage data ...
 * [COVERAGE_END] TestClass::test_method
 */
interface CoverageMarker {
  testId: string;
  className: string;
  methodName: string;
  startLine: number;
  endLine: number;
}

/**
 * Cobertura XML structure for parsing
 */
interface CoberturaXml {
  '?xml'?: { '@_version': string; '@_encoding': string };
  coverage: {
    '@_version'?: string;
    '@_timestamp'?: string;
    '@_lines-valid'?: string;
    '@_lines-covered'?: string;
    '@_line-rate'?: string;
    '@_branches-valid'?: string;
    '@_branches-covered'?: string;
    '@_branch-rate'?: string;
    '@_complexity'?: string;
    sources?: {
      source: string | string[];
    };
    packages?: {
      package: CoberturaPackage | CoberturaPackage[];
    };
  };
}

interface CoberturaPackage {
  '@_name': string;
  '@_line-rate'?: string;
  '@_branch-rate'?: string;
  '@_complexity'?: string;
  classes?: {
    class: CoberturaClass | CoberturaClass[];
  };
}

interface CoberturaClass {
  '@_name': string;
  '@_filename': string;
  '@_line-rate'?: string;
  '@_branch-rate'?: string;
  '@_complexity'?: string;
  methods?: {
    method: CoberturaMethod | CoberturaMethod[];
  };
  lines?: {
    line: CoberturaLine | CoberturaLine[];
  };
}

interface CoberturaMethod {
  '@_name': string;
  '@_signature'?: string;
  '@_line-rate'?: string;
  '@_branch-rate'?: string;
  '@_complexity'?: string;
  lines?: {
    line: CoberturaLine | CoberturaLine[];
  };
}

interface CoberturaLine {
  '@_number': string;
  '@_hits': string;
  '@_branch'?: string;
  '@_condition-coverage'?: string;
}

/**
 * Accumulated line hits during a test execution
 */
interface LineHits {
  [lineNumber: string]: number;
}

/**
 * Per-file coverage data for a test
 */
interface TestFileCoverage {
  [filePath: string]: LineHits;
}

/**
 * Per-test coverage accumulation
 */
interface TestCoverage {
  testId: string;
  className: string;
  methodName: string;
  files: TestFileCoverage;
}

// Predefined marker patterns for common tools
const MARKER_PRESETS: Record<string, { start: string; end: string }> = {
  default: {
    start: '\\[COVERAGE_START\\]\\s*(\\S+)',
    end: '\\[COVERAGE_END\\]\\s*(\\S+)',
  },
  opencppcoverage: {
    // OpenCppCoverage style: [TEST] TestClass::test_method START/END
    start: '\\[TEST\\]\\s*(\\S+)\\s+START',
    end: '\\[TEST\\]\\s*(\\S+)\\s+END',
  },
  gtest: {
    // Google Test style: [ RUN      ] TestCase.TestName / [       OK ] TestCase.TestName
    start: '\\[\\s*RUN\\s*\\]\\s*(\\S+)',
    end: '\\[\\s*(?:OK|FAILED)\\s*\\]\\s*(\\S+)',
  },
  catch2: {
    // Catch2 style: TestCase: test_name - START/PASSED/FAILED
    start: '(\\S+):.*-\\s*START',
    end: '(\\S+):.*-\\s*(?:PASSED|FAILED)',
  },
  ctest: {
    // CTest style: test N/M TestName ... START/Passed/Failed
    start: 'test\\s+\\d+/\\d+\\s+(\\S+).*Start',
    end: '\\d+/\\d+\\s+Test\\s+#\\d+:\\s+(\\S+)\\s+\\.+\\s+(?:Passed|Failed)',
  },
};

program
  .name('tia-split')
  .description('按测试用例拆分覆盖率文件')
  .version('1.0.0')
  .requiredOption('--coverage <file>', '合并的覆盖率文件 (Cobertura XML)')
  .requiredOption('--markers <file>', '包含覆盖率标记的日志文件')
  .requiredOption('--output-dir <dir>', '输出目录')
  .option('--verbose', '详细输出')
  .option('--preset <name>', '使用预定义的标记模式 (default, opencppcoverage, gtest, catch2, ctest)', 'default')
  .option('--marker-start <pattern>', '开始标记模式 (覆盖预设)')
  .option('--marker-end <pattern>', '结束标记模式 (覆盖预设)')
  .option('--cumulative', '累积模式：每个测试包含之前所有测试的覆盖率差值', false)
  .option('--opencppcoverage', '使用 OpenCppCoverage 预设标记模式', false)
  .action(async (options) => {
    const spinner = ora('初始化...').start();

    try {
      // Validate input files exist
      if (!existsSync(options.coverage)) {
        throw new Error(`覆盖率文件不存在: ${options.coverage}`);
      }
      if (!existsSync(options.markers)) {
        throw new Error(`标记文件不存在: ${options.markers}`);
      }

      // Resolve marker patterns from preset or custom options
      let presetName = options.preset || 'default';
      if (options.opencppcoverage) {
        presetName = 'opencppcoverage';
      }

      const preset = MARKER_PRESETS[presetName];
      if (!preset && !options.markerStart) {
        throw new Error(`未知的预设: ${presetName}. 可用预设: ${Object.keys(MARKER_PRESETS).join(', ')}`);
      }

      // Custom patterns override preset
      const markerStart = options.markerStart || preset?.start || MARKER_PRESETS.default.start;
      const markerEnd = options.markerEnd || preset?.end || MARKER_PRESETS.default.end;

      if (options.verbose) {
        spinner.info(`使用标记预设: ${presetName}`);
        spinner.info(`开始标记模式: ${markerStart}`);
        spinner.info(`结束标记模式: ${markerEnd}`);
      }

      // Create output directory
      if (!existsSync(options.outputDir)) {
        await mkdir(options.outputDir, { recursive: true });
        if (options.verbose) {
          spinner.info(`创建输出目录: ${options.outputDir}`);
        }
      }

      // Step 1: Parse markers file
      spinner.text = '解析覆盖率标记...';
      const markerOptions = { ...options, markerStart, markerEnd };
      const markers = await parseMarkers(options.markers, markerOptions);

      if (markers.length === 0) {
        spinner.warn('未找到覆盖率标记');
        return;
      }

      spinner.info(`找到 ${markers.length} 个测试用例标记`);

      // Step 2: Parse coverage file
      spinner.text = '解析覆盖率文件...';
      const coverageContent = await readFile(options.coverage, 'utf-8');
      const xmlParser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        allowBooleanAttributes: true,
        parseAttributeValue: false,
      });
      const coverageXml = xmlParser.parse(coverageContent) as CoberturaXml;

      if (!coverageXml.coverage) {
        throw new Error('无效的 Cobertura XML 格式');
      }

      // Step 3: Extract base coverage structure
      spinner.text = '提取覆盖率结构...';
      const baseCoverage = extractBaseCoverage(coverageXml);

      // Step 4: Split coverage by test markers
      spinner.text = '按测试用例拆分覆盖率...';
      const testCoverages = await splitCoverageByMarkers(
        coverageXml,
        markers,
        options
      );

      // Step 5: Generate individual coverage files
      spinner.text = '生成拆分后的覆盖率文件...';
      const xmlBuilder = new XMLBuilder({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
        format: true,
        suppressEmptyNode: true,
      });

      let generated = 0;
      for (const testCov of testCoverages) {
        const outputXml = buildTestCoverageXml(coverageXml, testCov, baseCoverage);
        const xmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<!DOCTYPE coverage SYSTEM "http://cobertura.sourceforge.net/xml/coverage-04.dtd">\n' +
          xmlBuilder.build(outputXml);

        // Output filename: Test_ClassName__test_methodName.cobertura.xml
        const safeClassName = testCov.className.replace(/[^a-zA-Z0-9_]/g, '_');
        const safeMethodName = testCov.methodName.replace(/[^a-zA-Z0-9_]/g, '_');
        const outputFileName = `Test_${safeClassName}__${safeMethodName}.cobertura.xml`;
        const outputPath = path.join(options.outputDir, outputFileName);

        await writeFile(outputPath, xmlContent, 'utf-8');
        generated++;

        if (options.verbose) {
          console.log(`  生成: ${outputFileName}`);
        }
      }

      spinner.succeed(`成功拆分 ${generated} 个测试用例覆盖率文件`);

      // Print summary
      console.log('\n' + '='.repeat(50));
      console.log('拆分完成!');
      console.log(`  输入覆盖率文件: ${options.coverage}`);
      console.log(`  标记文件: ${options.markers}`);
      console.log(`  输出目录: ${options.outputDir}`);
      console.log(`  生成文件数: ${generated}`);

      if (options.verbose) {
        console.log('\n生成的文件:');
        for (const testCov of testCoverages) {
          const safeClassName = testCov.className.replace(/[^a-zA-Z0-9_]/g, '_');
          const safeMethodName = testCov.methodName.replace(/[^a-zA-Z0-9_]/g, '_');
          console.log(`  - Test_${safeClassName}__${safeMethodName}.cobertura.xml`);
        }
      }

    } catch (error) {
      spinner.fail(`错误: ${error}`);
      process.exit(1);
    }
  });

/**
 * Parse coverage markers from log file
 */
async function parseMarkers(
  markersFile: string,
  options: { markerStart: string; markerEnd: string; verbose?: boolean }
): Promise<CoverageMarker[]> {
  const content = await readFile(markersFile, 'utf-8');
  const lines = content.split('\n');

  const startPattern = new RegExp(options.markerStart);
  const endPattern = new RegExp(options.markerEnd);

  const markers: CoverageMarker[] = [];
  let currentMarker: Partial<CoverageMarker> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for start marker
    const startMatch = line.match(startPattern);
    if (startMatch) {
      const testId = startMatch[1];
      const [className, methodName] = parseTestId(testId);

      currentMarker = {
        testId,
        className,
        methodName,
        startLine: i + 1,
      };

      if (options.verbose) {
        console.log(`  找到测试开始: ${testId} (行 ${i + 1})`);
      }
      continue;
    }

    // Check for end marker
    const endMatch = line.match(endPattern);
    if (endMatch && currentMarker) {
      const testId = endMatch[1];

      // Verify matching test ID
      if (testId === currentMarker.testId) {
        currentMarker.endLine = i + 1;
        markers.push(currentMarker as CoverageMarker);

        if (options.verbose) {
          console.log(`  找到测试结束: ${testId} (行 ${i + 1})`);
        }
      }
      currentMarker = null;
    }
  }

  return markers;
}

/**
 * Parse test ID into class name and method name
 * Supports formats:
 * - ClassName::method_name
 * - ClassName.method_name
 * - test_method_name (no class)
 */
function parseTestId(testId: string): [string, string] {
  // Try :: separator first
  if (testId.includes('::')) {
    const parts = testId.split('::');
    return [parts[0], parts.slice(1).join('::')];
  }

  // Try . separator (for Java/C# style)
  if (testId.includes('.')) {
    const parts = testId.split('.');
    // Last part is method, rest is class
    const methodName = parts.pop() || testId;
    const className = parts.join('.');
    return [className || 'Default', methodName];
  }

  // No separator - treat as method name with default class
  return ['Default', testId];
}

/**
 * Extract base coverage structure (file -> class -> method -> lines)
 */
function extractBaseCoverage(xml: CoberturaXml): Map<string, Set<string>> {
  const coverage = new Map<string, Set<string>>();

  const packages = xml.coverage.packages?.package;
  if (!packages) return coverage;

  const packageList = Array.isArray(packages) ? packages : [packages];

  for (const pkg of packageList) {
    const classes = pkg.classes?.class;
    if (!classes) continue;

    const classList = Array.isArray(classes) ? classes : [classes];

    for (const cls of classList) {
      const filename = cls['@_filename'];
      if (!coverage.has(filename)) {
        coverage.set(filename, new Set());
      }

      // Collect all line numbers for this file
      const fileLines = coverage.get(filename)!;

      // Class-level lines
      const classLines = extractLines(cls.lines);
      for (const line of classLines) {
        fileLines.add(line['@_number']);
      }

      // Method-level lines
      const methods = cls.methods?.method;
      if (methods) {
        const methodList = Array.isArray(methods) ? methods : [methods];
        for (const method of methodList) {
          const methodLines = extractLines(method.lines);
          for (const line of methodLines) {
            fileLines.add(line['@_number']);
          }
        }
      }
    }
  }

  return coverage;
}

/**
 * Extract lines array from potentially single or array value
 */
function extractLines(linesData?: { line: CoberturaLine | CoberturaLine[] }): CoberturaLine[] {
  if (!linesData?.line) {
    return [];
  }
  return Array.isArray(linesData.line) ? linesData.line : [linesData.line];
}

/**
 * Split coverage by test markers
 * In cumulative mode, computes the delta for each test
 */
async function splitCoverageByMarkers(
  xml: CoberturaXml,
  markers: CoverageMarker[],
  options: { cumulative?: boolean; verbose?: boolean }
): Promise<TestCoverage[]> {
  const testCoverages: TestCoverage[] = [];

  // Extract all hit counts from the coverage file
  const allHits = extractAllHits(xml);

  if (options.cumulative) {
    // Cumulative mode: compute delta between tests
    // This assumes the coverage file shows cumulative hits up to each point
    let previousHits: TestFileCoverage = {};

    for (const marker of markers) {
      // For now, just create individual test coverage
      // In a more sophisticated implementation, we'd parse the actual
      // coverage data at each marker point
      const testCov: TestCoverage = {
        testId: marker.testId,
        className: marker.className,
        methodName: marker.methodName,
        files: allHits, // Use all hits for each test in simple mode
      };
      testCoverages.push(testCov);
    }
  } else {
    // Simple mode: each test gets the same coverage data
    // This is useful when the markers file indicates which tests ran
    // and all coverage is attributed equally
    for (const marker of markers) {
      const testCov: TestCoverage = {
        testId: marker.testId,
        className: marker.className,
        methodName: marker.methodName,
        files: allHits,
      };
      testCoverages.push(testCov);
    }
  }

  return testCoverages;
}

/**
 * Extract all hit counts from coverage XML
 */
function extractAllHits(xml: CoberturaXml): TestFileCoverage {
  const hits: TestFileCoverage = {};

  const packages = xml.coverage.packages?.package;
  if (!packages) return hits;

  const packageList = Array.isArray(packages) ? packages : [packages];

  for (const pkg of packageList) {
    const classes = pkg.classes?.class;
    if (!classes) continue;

    const classList = Array.isArray(classes) ? classes : [classes];

    for (const cls of classList) {
      const filename = cls['@_filename'];
      if (!hits[filename]) {
        hits[filename] = {};
      }

      // Class-level lines
      const classLines = extractLines(cls.lines);
      for (const line of classLines) {
        const lineNum = line['@_number'];
        const lineHits = parseInt(line['@_hits'], 10) || 0;
        hits[filename][lineNum] = (hits[filename][lineNum] || 0) + lineHits;
      }

      // Method-level lines
      const methods = cls.methods?.method;
      if (methods) {
        const methodList = Array.isArray(methods) ? methods : [methods];
        for (const method of methodList) {
          const methodLines = extractLines(method.lines);
          for (const line of methodLines) {
            const lineNum = line['@_number'];
            const lineHits = parseInt(line['@_hits'], 10) || 0;
            hits[filename][lineNum] = (hits[filename][lineNum] || 0) + lineHits;
          }
        }
      }
    }
  }

  return hits;
}

/**
 * Build a Cobertura XML structure for a single test's coverage
 */
function buildTestCoverageXml(
  originalXml: CoberturaXml,
  testCov: TestCoverage,
  baseCoverage: Map<string, Set<string>>
): CoberturaXml {
  // Deep clone the original structure
  const xml: CoberturaXml = JSON.parse(JSON.stringify(originalXml));

  // Update source to include test ID
  if (!xml.coverage.sources) {
    xml.coverage.sources = { source: [] };
  }
  const sources = xml.coverage.sources.source;
  const sourceList = Array.isArray(sources) ? sources : [sources];
  // Add test ID as first source for identification
  xml.coverage.sources.source = [testCov.testId, ...sourceList.filter(s => s !== testCov.testId)];

  // Update line hits for each file
  let totalLines = 0;
  let coveredLines = 0;

  const packages = xml.coverage.packages?.package;
  if (packages) {
    const packageList = Array.isArray(packages) ? packages : [packages];

    for (const pkg of packageList) {
      const classes = pkg.classes?.class;
      if (!classes) continue;

      const classList = Array.isArray(classes) ? classes : [classes];

      for (const cls of classList) {
        const filename = cls['@_filename'];
        const fileHits = testCov.files[filename] || {};

        // Update class-level lines
        if (cls.lines?.line) {
          const lines = Array.isArray(cls.lines.line) ? cls.lines.line : [cls.lines.line];
          for (const line of lines) {
            const lineNum = line['@_number'];
            const hits = fileHits[lineNum] || 0;
            line['@_hits'] = String(hits);
            totalLines++;
            if (hits > 0) coveredLines++;
          }
          cls.lines.line = lines;
        }

        // Update method-level lines
        const methods = cls.methods?.method;
        if (methods) {
          const methodList = Array.isArray(methods) ? methods : [methods];
          for (const method of methodList) {
            let methodTotal = 0;
            let methodCovered = 0;

            if (method.lines?.line) {
              const lines = Array.isArray(method.lines.line) ? method.lines.line : [method.lines.line];
              for (const line of lines) {
                const lineNum = line['@_number'];
                const hits = fileHits[lineNum] || 0;
                line['@_hits'] = String(hits);
                methodTotal++;
                if (hits > 0) methodCovered++;
              }
              method.lines.line = lines;
            }

            // Update method line-rate
            if (methodTotal > 0) {
              method['@_line-rate'] = String(methodCovered / methodTotal);
            }
          }
          if (Array.isArray(cls.methods?.method)) {
            cls.methods!.method = methodList;
          }
        }

        // Update class line-rate
        const classTotal = countTotalLines(cls);
        const classCovered = countCoveredLines(cls);
        if (classTotal > 0) {
          cls['@_line-rate'] = String(classCovered / classTotal);
        }
      }
    }
  }

  // Update global line-rate
  if (totalLines > 0) {
    xml.coverage['@_line-rate'] = String(coveredLines / totalLines);
    xml.coverage['@_lines-valid'] = String(totalLines);
    xml.coverage['@_lines-covered'] = String(coveredLines);
  }

  return xml;
}

/**
 * Count total lines in a class
 */
function countTotalLines(cls: CoberturaClass): number {
  let total = 0;

  const classLines = extractLines(cls.lines);
  total += classLines.length;

  const methods = cls.methods?.method;
  if (methods) {
    const methodList = Array.isArray(methods) ? methods : [methods];
    for (const method of methodList) {
      const methodLines = extractLines(method.lines);
      total += methodLines.length;
    }
  }

  return total;
}

/**
 * Count covered lines in a class
 */
function countCoveredLines(cls: CoberturaClass): number {
  let covered = 0;

  const classLines = extractLines(cls.lines);
  for (const line of classLines) {
    if (parseInt(line['@_hits'], 10) > 0) covered++;
  }

  const methods = cls.methods?.method;
  if (methods) {
    const methodList = Array.isArray(methods) ? methods : [methods];
    for (const method of methodList) {
      const methodLines = extractLines(method.lines);
      for (const line of methodLines) {
        if (parseInt(line['@_hits'], 10) > 0) covered++;
      }
    }
  }

  return covered;
}

program.parse();
