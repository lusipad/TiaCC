/**
 * Coverage data parsers for LLVM, coverlet, and Cobertura formats.
 * Extended to support function-level symbol extraction.
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { basename, extname } from 'path';
import { XMLParser } from 'fast-xml-parser';
import type { CoverageData, CoveredSymbol } from './types.js';
import { SymbolExtractor } from './symbol-extractor.js';

/**
 * Abstract base class for coverage parsers
 */
export abstract class CoverageParser {
  abstract parse(coverageFile: string): Promise<CoverageData | null>;
  abstract getFileExtension(): string;
}

/**
 * Parser for LLVM .profraw/.profdata coverage files
 */
export class CppCoverageParser extends CoverageParser {
  private llvmProfdata: string;
  private llvmCov: string;
  private executable?: string;
  private symbolExtractor: SymbolExtractor;

  constructor(options: {
    llvmProfdata?: string;
    llvmCov?: string;
    executable?: string;
  } = {}) {
    super();
    this.llvmProfdata = options.llvmProfdata ?? 'llvm-profdata';
    this.llvmCov = options.llvmCov ?? 'llvm-cov';
    this.executable = options.executable;
    this.symbolExtractor = new SymbolExtractor();
  }

  getFileExtension(): string {
    return '.profraw';
  }

  async parse(coverageFile: string): Promise<CoverageData | null> {
    if (!existsSync(coverageFile)) {
      console.error(`Coverage file not found: ${coverageFile}`);
      return null;
    }

    const testId = basename(coverageFile, '.profraw');
    const profdataFile = coverageFile.replace('.profraw', '.profdata');

    try {
      // Step 1: Convert to profdata
      await this.runCommand(this.llvmProfdata, [
        'merge', '-sparse', coverageFile, '-o', profdataFile
      ]);

      if (!this.executable) {
        console.warn('No executable specified, cannot export coverage details');
        return { testId, coveredFiles: [], totalLines: 0, coveredLines: 0 };
      }

      // Step 2: Export to JSON
      const output = await this.runCommand(this.llvmCov, [
        'export', this.executable,
        `-instr-profile=${profdataFile}`,
        '-format=text'
      ]);

      const coverageJson = JSON.parse(output);
      const coveredFiles = this.extractFiles(coverageJson);

      // Step 3: Extract function-level symbols
      const coveredSymbols = this.symbolExtractor.extractFromLlvmCov(coverageJson);

      // Step 4: Calculate line coverage
      const { totalLines, coveredLines } = this.countLines(coverageJson);

      return {
        testId,
        coveredFiles,
        coveredSymbols,
        totalLines,
        coveredLines,
      };
    } catch (error) {
      console.error(`Error parsing coverage: ${error}`);
      return null;
    }
  }

  private countLines(coverageJson: any): { totalLines: number; coveredLines: number } {
    let total = 0;
    let covered = 0;

    for (const data of coverageJson.data ?? []) {
      for (const fileData of data.files ?? []) {
        for (const segment of fileData.segments ?? []) {
          // LLVM segment format: [line, col, count, hasCount, isRegionEntry, isGapRegion?]
          if (segment.length >= 4 && segment[3]) {
            total++;
            if (segment[2] > 0) covered++;
          }
        }
      }
    }

    return { totalLines: total, coveredLines: covered };
  }

  private runCommand(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args);
      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data; });
      proc.stderr.on('data', (data) => { stderr += data; });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`${cmd} failed with code ${code}: ${stderr}`));
        }
      });

      proc.on('error', reject);
    });
  }

  private extractFiles(coverageJson: any): string[] {
    const files = new Set<string>();

    for (const data of coverageJson.data ?? []) {
      for (const fileData of data.files ?? []) {
        const filename = fileData.filename;
        if (filename && this.hasAnyCoverage(fileData.segments ?? [])) {
          files.add(this.normalizePath(filename));
        }
      }
    }

    return Array.from(files).sort();
  }

  private hasAnyCoverage(segments: any[]): boolean {
    return segments.some(seg => seg.length >= 3 && seg[2] > 0);
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
  }
}

/**
 * Parser for pre-processed LLVM JSON coverage files (*.cov.json)
 * These are files already exported via `llvm-cov export`
 */
export class LlvmJsonCoverageParser extends CoverageParser {
  private symbolExtractor: SymbolExtractor;

  constructor() {
    super();
    this.symbolExtractor = new SymbolExtractor();
  }

  getFileExtension(): string {
    return '.cov.json';
  }

  async parse(coverageFile: string): Promise<CoverageData | null> {
    if (!existsSync(coverageFile)) {
      console.error(`Coverage file not found: ${coverageFile}`);
      return null;
    }

    // Extract test ID: test_xxx.cov.json -> test_xxx
    const testId = basename(coverageFile).replace('.cov.json', '');

    try {
      const content = await readFile(coverageFile, 'utf-8');
      const coverageJson = JSON.parse(content);

      const { coveredFiles, fileCoverage } = this.extractFilesWithCoverage(coverageJson);
      const coveredSymbols = this.symbolExtractor.extractFromLlvmCov(coverageJson);
      const { totalLines, coveredLines } = this.countLines(coverageJson);

      return {
        testId,
        coveredFiles,
        fileCoverage,
        coveredSymbols,
        totalLines,
        coveredLines,
      };
    } catch (error) {
      console.error(`Error parsing LLVM JSON coverage file: ${error}`);
      return null;
    }
  }

  private extractFilesWithCoverage(coverageJson: any): {
    coveredFiles: string[];
    fileCoverage: Map<string, number>;
  } {
    const files: string[] = [];
    const fileCoverage = new Map<string, number>();

    for (const data of coverageJson.data ?? []) {
      for (const fileData of data.files ?? []) {
        const filename = fileData.filename;
        if (!filename) continue;

        // Calculate coverage for this file
        const summary = fileData.summary;
        let coveragePct = 0;

        if (summary?.lines) {
          const totalLines = summary.lines.count || 0;
          const coveredLines = summary.lines.covered || 0;
          if (totalLines > 0) {
            coveragePct = (coveredLines / totalLines) * 100;
          }
        } else if (summary?.regions) {
          // Fallback to region coverage
          const totalRegions = summary.regions.count || 0;
          const coveredRegions = summary.regions.covered || 0;
          if (totalRegions > 0) {
            coveragePct = (coveredRegions / totalRegions) * 100;
          }
        } else {
          // Calculate from segments if no summary
          const segments = fileData.segments ?? [];
          let totalSegs = 0;
          let coveredSegs = 0;
          for (const seg of segments) {
            if (seg.length >= 4 && seg[3]) { // hasCount
              totalSegs++;
              if (seg[2] > 0) coveredSegs++;
            }
          }
          if (totalSegs > 0) {
            coveragePct = (coveredSegs / totalSegs) * 100;
          }
        }

        // Only add files with coverage
        if (this.hasAnyCoverage(fileData.segments ?? [])) {
          const normalizedPath = this.normalizePath(filename);
          files.push(normalizedPath);
          fileCoverage.set(normalizedPath, Math.round(coveragePct * 100) / 100);
        }
      }
    }

    return { coveredFiles: files.sort(), fileCoverage };
  }

  private hasAnyCoverage(segments: any[]): boolean {
    return segments.some(seg => seg.length >= 3 && seg[2] > 0);
  }

  private countLines(coverageJson: any): { totalLines: number; coveredLines: number } {
    let total = 0;
    let covered = 0;

    for (const data of coverageJson.data ?? []) {
      for (const fileData of data.files ?? []) {
        for (const segment of fileData.segments ?? []) {
          if (segment.length >= 4 && segment[3]) {
            total++;
            if (segment[2] > 0) covered++;
          }
        }
      }
    }

    return { totalLines: total, coveredLines: covered };
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
  }
}

/**
 * Parser for coverlet JSON coverage files
 */
export class CSharpCoverageParser extends CoverageParser {
  private symbolExtractor: SymbolExtractor;

  constructor() {
    super();
    this.symbolExtractor = new SymbolExtractor();
  }

  getFileExtension(): string {
    return '.coverage.json';
  }

  async parse(coverageFile: string): Promise<CoverageData | null> {
    if (!existsSync(coverageFile)) {
      console.error(`Coverage file not found: ${coverageFile}`);
      return null;
    }

    const testId = basename(coverageFile).replace('.coverage.json', '');

    try {
      const content = await readFile(coverageFile, 'utf-8');
      const coverageJson = JSON.parse(content);

      const coveredFiles = this.extractFiles(coverageJson);
      const { totalLines, coveredLines } = this.countLines(coverageJson);

      // Extract method-level symbols for C#
      const coveredSymbols = this.symbolExtractor.extractFromCoverlet(coverageJson);

      return {
        testId,
        coveredFiles,
        coveredSymbols,
        totalLines,
        coveredLines,
      };
    } catch (error) {
      console.error(`Error parsing coverage file: ${error}`);
      return null;
    }
  }

  private extractFiles(coverageJson: Record<string, any>): string[] {
    const files = new Set<string>();

    for (const [moduleName, moduleData] of Object.entries(coverageJson)) {
      if (typeof moduleData !== 'object' || moduleData === null) continue;

      for (const [filePath, fileData] of Object.entries(moduleData as Record<string, any>)) {
        if (typeof fileData !== 'object' || fileData === null) continue;

        if (this.fileHasCoverage(fileData)) {
          files.add(this.normalizePath(filePath));
        }
      }
    }

    return Array.from(files).sort();
  }

  private fileHasCoverage(fileData: Record<string, any>): boolean {
    for (const methodData of Object.values(fileData)) {
      if (typeof methodData !== 'object' || methodData === null) continue;

      const lines = (methodData as any).Lines;
      if (typeof lines !== 'object' || lines === null) continue;

      for (const hitCount of Object.values(lines)) {
        if (typeof hitCount === 'number' && hitCount > 0) {
          return true;
        }
      }
    }
    return false;
  }

  private countLines(coverageJson: Record<string, any>): { totalLines: number; coveredLines: number } {
    let total = 0;
    let covered = 0;

    for (const moduleData of Object.values(coverageJson)) {
      if (typeof moduleData !== 'object' || moduleData === null) continue;

      for (const fileData of Object.values(moduleData as Record<string, any>)) {
        if (typeof fileData !== 'object' || fileData === null) continue;

        for (const methodData of Object.values(fileData as Record<string, any>)) {
          if (typeof methodData !== 'object' || methodData === null) continue;

          const lines = (methodData as any).Lines;
          if (typeof lines !== 'object' || lines === null) continue;

          for (const hitCount of Object.values(lines)) {
            if (typeof hitCount === 'number') {
              total++;
              if (hitCount > 0) covered++;
            }
          }
        }
      }
    }

    return { totalLines: total, coveredLines: covered };
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
  }
}

/**
 * Cobertura XML coverage format structure
 */
interface CoberturaXml {
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
 * Options for Cobertura parser
 */
export interface CoberturaParserOptions {
  /**
   * Environment variable name to read testId from.
   * If set, the testId will be read from process.env[testIdFromEnv].
   */
  testIdFromEnv?: string;

  /**
   * Use the <source> tag content as testId.
   * This is useful when the source tag contains test method name (e.g., from LuaUnit).
   */
  testIdFromSource?: boolean;

  /**
   * Parse testId from filename format: Test_ClassName__test_methodName.cobertura.xml
   * This extracts "ClassName::test_methodName" as the testId.
   */
  testIdFromFilename?: boolean;

  /**
   * Custom testId to use instead of deriving from filename.
   */
  testId?: string;
}

/**
 * Parser for Cobertura XML coverage files
 * Supports custom testId from environment variable or <source> tag
 */
export class CoberturaCoverageParser extends CoverageParser {
  private symbolExtractor: SymbolExtractor;
  private xmlParser: XMLParser;
  private options: CoberturaParserOptions;

  constructor(options: CoberturaParserOptions = {}) {
    super();
    this.options = options;
    this.symbolExtractor = new SymbolExtractor();
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      allowBooleanAttributes: true,
      parseAttributeValue: false,  // Keep as strings for precise parsing
    });
  }

  getFileExtension(): string {
    return '.xml';
  }

  async parse(coverageFile: string): Promise<CoverageData | null> {
    if (!existsSync(coverageFile)) {
      console.error(`Coverage file not found: ${coverageFile}`);
      return null;
    }

    try {
      const content = await readFile(coverageFile, 'utf-8');
      const parsed = this.xmlParser.parse(content) as CoberturaXml;

      if (!parsed.coverage) {
        console.error(`Invalid Cobertura XML format: missing <coverage> root element`);
        return null;
      }

      // Determine testId based on options priority:
      // 1. Explicit testId option
      // 2. Environment variable (--test-id-from-env)
      // 3. <source> tag (--test-id-from-source)
      // 4. Fallback to filename
      const testId = this.resolveTestId(coverageFile, parsed);

      const { coveredFiles, fileCoverage, totalLines, coveredLines, coveredSymbols } =
        this.extractCoverageData(parsed);

      return {
        testId,
        coveredFiles,
        fileCoverage,
        coveredSymbols,
        totalLines,
        coveredLines,
      };
    } catch (error) {
      console.error(`Error parsing Cobertura XML coverage file: ${error}`);
      return null;
    }
  }

  /**
   * Resolve testId based on configuration options
   */
  private resolveTestId(coverageFile: string, parsed: CoberturaXml): string {
    // Priority 1: Explicit testId option
    if (this.options.testId) {
      return this.options.testId;
    }

    // Priority 2: Environment variable
    if (this.options.testIdFromEnv) {
      const envValue = process.env[this.options.testIdFromEnv];
      if (envValue) {
        return envValue;
      }
      console.warn(`Environment variable ${this.options.testIdFromEnv} not set, falling back to filename`);
    }

    // Priority 3: <source> tag
    if (this.options.testIdFromSource) {
      const sourceValue = this.extractSourceAsTestId(parsed);
      if (sourceValue) {
        return sourceValue;
      }
      console.warn(`No valid <source> tag found, falling back to filename`);
    }

    // Priority 4: Parse from filename format Test_ClassName__test_methodName.cobertura.xml
    if (this.options.testIdFromFilename) {
      const testId = this.extractTestIdFromFilename(coverageFile);
      if (testId) {
        return testId;
      }
      console.warn(`Could not parse testId from filename, falling back to default`);
    }

    // Priority 5: Fallback to filename
    return basename(coverageFile).replace(/\.(cobertura\.)?xml$/i, '');
  }

  /**
   * Extract testId from filename format: Test_ClassName__test_methodName.cobertura.xml
   * Returns "ClassName::test_methodName" format
   */
  private extractTestIdFromFilename(coverageFile: string): string | null {
    const filename = basename(coverageFile);

    // Match pattern: Test_ClassName__test_methodName.cobertura.xml
    // or: Test_ClassName__test_methodName.xml
    const pattern = /^Test_([^_]+(?:_[^_]+)*)__(.+?)(?:\.cobertura)?\.xml$/i;
    const match = filename.match(pattern);

    if (match) {
      const className = match[1].replace(/_/g, '.');  // Convert underscores back to dots if needed
      const methodName = match[2];
      return `${className}::${methodName}`;
    }

    // Alternative pattern without Test_ prefix: ClassName__methodName.cobertura.xml
    const altPattern = /^([^_]+(?:_[^_]+)*)__(.+?)(?:\.cobertura)?\.xml$/i;
    const altMatch = filename.match(altPattern);

    if (altMatch) {
      const className = altMatch[1];
      const methodName = altMatch[2];
      return `${className}::${methodName}`;
    }

    return null;
  }

  /**
   * Extract test method name from <source> tag
   * Supports LuaUnit-style source tags containing test method names
   */
  private extractSourceAsTestId(parsed: CoberturaXml): string | null {
    const sources = parsed.coverage.sources?.source;
    if (!sources) {
      return null;
    }

    // Handle single source or array of sources
    const sourceList = Array.isArray(sources) ? sources : [sources];

    // Find the first non-empty, non-path source (likely a test method name)
    for (const source of sourceList) {
      if (typeof source === 'string' && source.trim()) {
        const trimmed = source.trim();
        // Check if it looks like a test method name rather than a file path
        // Test method names typically don't contain path separators
        if (!trimmed.includes('/') && !trimmed.includes('\\')) {
          return trimmed;
        }
        // If it's a path, extract just the last segment as potential test name
        const lastSegment = trimmed.split(/[/\\]/).pop();
        if (lastSegment && !lastSegment.includes('.')) {
          // Doesn't have extension, could be a test method name
          return lastSegment;
        }
      }
    }

    // If all sources are paths, try to extract meaningful test name from first source
    if (sourceList.length > 0 && typeof sourceList[0] === 'string') {
      return sourceList[0].trim();
    }

    return null;
  }

  /**
   * Extract coverage data from parsed Cobertura XML
   */
  private extractCoverageData(parsed: CoberturaXml): {
    coveredFiles: string[];
    fileCoverage: Map<string, number>;
    totalLines: number;
    coveredLines: number;
    coveredSymbols: CoveredSymbol[];
  } {
    const files: string[] = [];
    const fileCoverage = new Map<string, number>();
    const coveredSymbols: CoveredSymbol[] = [];
    let totalLines = 0;
    let coveredLines = 0;

    const packages = parsed.coverage.packages?.package;
    if (!packages) {
      return { coveredFiles: files, fileCoverage, totalLines, coveredLines, coveredSymbols };
    }

    const packageList = Array.isArray(packages) ? packages : [packages];

    for (const pkg of packageList) {
      const classes = pkg.classes?.class;
      if (!classes) continue;

      const classList = Array.isArray(classes) ? classes : [classes];

      for (const cls of classList) {
        const filename = this.normalizePath(cls['@_filename']);
        const lineRate = parseFloat(cls['@_line-rate'] ?? '0');

        // Process class-level lines
        const classLines = this.extractLines(cls.lines);
        const classTotal = classLines.length;
        const classCovered = classLines.filter(l => parseInt(l['@_hits']) > 0).length;

        // Add class as symbol
        if (classLines.length > 0) {
          const lineNumbers = classLines.map(l => parseInt(l['@_number']));
          coveredSymbols.push({
            filePath: filename,
            name: cls['@_name'],
            type: 'class',
            startLine: Math.min(...lineNumbers),
            endLine: Math.max(...lineNumbers),
            hitCount: classCovered,
            lineCoveragePct: lineRate * 100,
          });
        }

        // Process methods
        const methods = cls.methods?.method;
        if (methods) {
          const methodList = Array.isArray(methods) ? methods : [methods];

          for (const method of methodList) {
            const methodLines = this.extractLines(method.lines);
            const methodTotal = methodLines.length;
            const methodCovered = methodLines.filter(l => parseInt(l['@_hits']) > 0).length;
            const methodLineRate = parseFloat(method['@_line-rate'] ?? '0');

            if (methodLines.length > 0) {
              const lineNumbers = methodLines.map(l => parseInt(l['@_number']));
              coveredSymbols.push({
                filePath: filename,
                name: `${cls['@_name']}::${method['@_name']}`,
                type: 'method',
                startLine: Math.min(...lineNumbers),
                endLine: Math.max(...lineNumbers),
                hitCount: methodCovered,
                lineCoveragePct: methodLineRate * 100,
              });
            }

            totalLines += methodTotal;
            coveredLines += methodCovered;
          }
        }

        // If no methods, count class lines directly
        if (!methods || (Array.isArray(methods) ? methods.length === 0 : false)) {
          totalLines += classTotal;
          coveredLines += classCovered;
        }

        // Track file coverage
        if (!fileCoverage.has(filename)) {
          files.push(filename);
          fileCoverage.set(filename, Math.round(lineRate * 100 * 100) / 100);
        } else {
          // Average the coverage if file appears multiple times
          const existing = fileCoverage.get(filename)!;
          fileCoverage.set(filename, (existing + lineRate * 100) / 2);
        }
      }
    }

    return { coveredFiles: files.sort(), fileCoverage, totalLines, coveredLines, coveredSymbols };
  }

  /**
   * Extract lines array from potentially single or array value
   */
  private extractLines(linesData?: { line: CoberturaLine | CoberturaLine[] }): CoberturaLine[] {
    if (!linesData?.line) {
      return [];
    }
    return Array.isArray(linesData.line) ? linesData.line : [linesData.line];
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
  }
}

/**
 * Options for OpenCppCoverage parser
 */
export interface OpenCppCoverageOptions {
  /**
   * Test ID to use for this coverage file
   */
  testId?: string;

  /**
   * Parse testId from filename format
   */
  testIdFromFilename?: boolean;

  /**
   * Base path to strip from source file paths
   */
  basePath?: string;
}

/**
 * Parser for OpenCppCoverage binary format (.cov files)
 * OpenCppCoverage is a Windows C++ code coverage tool.
 *
 * Note: OpenCppCoverage can also export to Cobertura XML format,
 * which is handled by CoberturaCoverageParser.
 *
 * This parser handles the native binary format and merged coverage files.
 */
export class OpenCppCoverageParser extends CoverageParser {
  private options: OpenCppCoverageOptions;
  private xmlParser: XMLParser;

  constructor(options: OpenCppCoverageOptions = {}) {
    super();
    this.options = options;
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      allowBooleanAttributes: true,
      parseAttributeValue: false,
    });
  }

  getFileExtension(): string {
    return '.xml';
  }

  async parse(coverageFile: string): Promise<CoverageData | null> {
    if (!existsSync(coverageFile)) {
      console.error(`Coverage file not found: ${coverageFile}`);
      return null;
    }

    try {
      const content = await readFile(coverageFile, 'utf-8');

      // Check if this is a Cobertura XML (OpenCppCoverage export format)
      if (content.includes('<coverage') && content.includes('line-rate')) {
        return this.parseCobertura(coverageFile, content);
      }

      // Check if this is OpenCppCoverage HTML format summary
      if (content.includes('OpenCppCoverage')) {
        return this.parseOpenCppCoverageHtml(coverageFile, content);
      }

      console.warn(`Unrecognized OpenCppCoverage format: ${coverageFile}`);
      return null;
    } catch (error) {
      console.error(`Error parsing OpenCppCoverage file: ${error}`);
      return null;
    }
  }

  /**
   * Parse Cobertura XML exported from OpenCppCoverage
   */
  private async parseCobertura(coverageFile: string, content: string): Promise<CoverageData | null> {
    const parsed = this.xmlParser.parse(content) as CoberturaXml;

    if (!parsed.coverage) {
      return null;
    }

    const testId = this.resolveTestId(coverageFile);
    const { coveredFiles, fileCoverage, totalLines, coveredLines, coveredSymbols } =
      this.extractCoverageData(parsed);

    return {
      testId,
      coveredFiles,
      fileCoverage,
      coveredSymbols,
      totalLines,
      coveredLines,
    };
  }

  /**
   * Parse OpenCppCoverage HTML report to extract coverage data
   * This is a fallback for when only HTML output is available
   */
  private parseOpenCppCoverageHtml(coverageFile: string, content: string): CoverageData | null {
    // Extract basic coverage info from HTML
    // This is a simplified parser - prefer Cobertura XML export when available
    const testId = this.resolveTestId(coverageFile);

    const coveredFiles: string[] = [];
    const fileCoverage = new Map<string, number>();

    // Try to extract file coverage from HTML
    // Pattern: <td class="filename">path/to/file.cpp</td>
    const filePattern = /<td[^>]*class="[^"]*filename[^"]*"[^>]*>([^<]+)<\/td>/g;
    const coveragePattern = /<td[^>]*class="[^"]*coverage[^"]*"[^>]*>(\d+(?:\.\d+)?)\s*%<\/td>/g;

    let fileMatch;
    const files: string[] = [];
    while ((fileMatch = filePattern.exec(content)) !== null) {
      files.push(this.normalizePath(fileMatch[1]));
    }

    let coverageMatch;
    const coverages: number[] = [];
    while ((coverageMatch = coveragePattern.exec(content)) !== null) {
      coverages.push(parseFloat(coverageMatch[1]));
    }

    // Match files with coverages
    for (let i = 0; i < Math.min(files.length, coverages.length); i++) {
      if (coverages[i] > 0) {
        coveredFiles.push(files[i]);
        fileCoverage.set(files[i], coverages[i]);
      }
    }

    return {
      testId,
      coveredFiles,
      fileCoverage,
      totalLines: 0,
      coveredLines: 0,
    };
  }

  private resolveTestId(coverageFile: string): string {
    if (this.options.testId) {
      return this.options.testId;
    }

    if (this.options.testIdFromFilename) {
      const testId = this.extractTestIdFromFilename(coverageFile);
      if (testId) {
        return testId;
      }
    }

    // Default: use filename without extension
    return basename(coverageFile).replace(/\.(cobertura\.)?xml$/i, '').replace(/\.html?$/i, '');
  }

  private extractTestIdFromFilename(coverageFile: string): string | null {
    const filename = basename(coverageFile);

    // Match pattern: Test_ClassName__test_methodName.xml
    const pattern = /^Test_([^_]+(?:_[^_]+)*)__(.+?)(?:\.cobertura)?\.xml$/i;
    const match = filename.match(pattern);

    if (match) {
      const className = match[1];
      const methodName = match[2];
      return `${className}::${methodName}`;
    }

    // Match pattern: coverage_TestName.xml
    const altPattern = /^coverage[_-](.+?)\.xml$/i;
    const altMatch = filename.match(altPattern);
    if (altMatch) {
      return altMatch[1];
    }

    return null;
  }

  private extractCoverageData(parsed: CoberturaXml): {
    coveredFiles: string[];
    fileCoverage: Map<string, number>;
    totalLines: number;
    coveredLines: number;
    coveredSymbols: CoveredSymbol[];
  } {
    const files: string[] = [];
    const fileCoverage = new Map<string, number>();
    const coveredSymbols: CoveredSymbol[] = [];
    let totalLines = 0;
    let coveredLines = 0;

    const packages = parsed.coverage.packages?.package;
    if (!packages) {
      return { coveredFiles: files, fileCoverage, totalLines, coveredLines, coveredSymbols };
    }

    const packageList = Array.isArray(packages) ? packages : [packages];

    for (const pkg of packageList) {
      const classes = pkg.classes?.class;
      if (!classes) continue;

      const classList = Array.isArray(classes) ? classes : [classes];

      for (const cls of classList) {
        let filename = cls['@_filename'];

        // Normalize Windows paths and apply base path stripping
        filename = this.normalizePath(filename);
        if (this.options.basePath) {
          const basePath = this.normalizePath(this.options.basePath);
          if (filename.startsWith(basePath)) {
            filename = filename.slice(basePath.length);
            if (filename.startsWith('/')) {
              filename = filename.slice(1);
            }
          }
        }

        const lineRate = parseFloat(cls['@_line-rate'] ?? '0');

        // Process class-level lines
        const classLines = this.extractLines(cls.lines);
        const classTotal = classLines.length;
        const classCovered = classLines.filter(l => parseInt(l['@_hits']) > 0).length;

        // Add class as symbol
        if (classLines.length > 0) {
          const lineNumbers = classLines.map(l => parseInt(l['@_number']));
          coveredSymbols.push({
            filePath: filename,
            name: cls['@_name'],
            type: 'class',
            startLine: Math.min(...lineNumbers),
            endLine: Math.max(...lineNumbers),
            hitCount: classCovered,
            lineCoveragePct: lineRate * 100,
          });
        }

        // Process methods
        const methods = cls.methods?.method;
        if (methods) {
          const methodList = Array.isArray(methods) ? methods : [methods];

          for (const method of methodList) {
            const methodLines = this.extractLines(method.lines);
            const methodTotal = methodLines.length;
            const methodCovered = methodLines.filter(l => parseInt(l['@_hits']) > 0).length;
            const methodLineRate = parseFloat(method['@_line-rate'] ?? '0');

            if (methodLines.length > 0) {
              const lineNumbers = methodLines.map(l => parseInt(l['@_number']));
              coveredSymbols.push({
                filePath: filename,
                name: `${cls['@_name']}::${method['@_name']}`,
                type: 'method',
                startLine: Math.min(...lineNumbers),
                endLine: Math.max(...lineNumbers),
                hitCount: methodCovered,
                lineCoveragePct: methodLineRate * 100,
              });
            }

            totalLines += methodTotal;
            coveredLines += methodCovered;
          }
        }

        // If no methods, count class lines directly
        if (!methods || (Array.isArray(methods) ? methods.length === 0 : false)) {
          totalLines += classTotal;
          coveredLines += classCovered;
        }

        // Track file coverage
        if (!fileCoverage.has(filename)) {
          files.push(filename);
          fileCoverage.set(filename, Math.round(lineRate * 100 * 100) / 100);
        }
      }
    }

    return { coveredFiles: files.sort(), fileCoverage, totalLines, coveredLines, coveredSymbols };
  }

  private extractLines(linesData?: { line: CoberturaLine | CoberturaLine[] }): CoberturaLine[] {
    if (!linesData?.line) {
      return [];
    }
    return Array.isArray(linesData.line) ? linesData.line : [linesData.line];
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
  }
}

/**
 * Options for LCOV parser
 */
export interface LcovParserOptions {
  /**
   * Test ID to use for this coverage file
   */
  testId?: string;

  /**
   * Parse testId from filename
   */
  testIdFromFilename?: boolean;

  /**
   * Base path to strip from source file paths
   */
  basePath?: string;
}

/**
 * Parser for LCOV coverage format (.info files)
 * LCOV is the most common coverage format for C/C++ on Linux (generated by gcov/lcov).
 *
 * LCOV format specification:
 * - TN: Test name
 * - SF: Source file path
 * - FN: Function line,name
 * - FNDA: Function hits,name
 * - FNF: Functions found
 * - FNH: Functions hit
 * - DA: Line data (line_number,hit_count)
 * - LF: Lines found
 * - LH: Lines hit
 * - BRDA: Branch data
 * - BRF: Branches found
 * - BRH: Branches hit
 * - end_of_record: End marker
 */
export class LcovCoverageParser extends CoverageParser {
  private options: LcovParserOptions;

  constructor(options: LcovParserOptions = {}) {
    super();
    this.options = options;
  }

  getFileExtension(): string {
    return '.info';
  }

  async parse(coverageFile: string): Promise<CoverageData | null> {
    if (!existsSync(coverageFile)) {
      console.error(`Coverage file not found: ${coverageFile}`);
      return null;
    }

    try {
      const content = await readFile(coverageFile, 'utf-8');
      return this.parseLcov(coverageFile, content);
    } catch (error) {
      console.error(`Error parsing LCOV coverage file: ${error}`);
      return null;
    }
  }

  private parseLcov(coverageFile: string, content: string): CoverageData | null {
    const files: string[] = [];
    const fileCoverage = new Map<string, number>();
    const coveredSymbols: CoveredSymbol[] = [];
    let totalLines = 0;
    let coveredLines = 0;
    let testName = '';

    let currentFile = '';
    let currentFileLines = 0;
    let currentFileHits = 0;
    const functions = new Map<string, { line: number; hits: number }>();

    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Test name
      if (trimmed.startsWith('TN:')) {
        testName = trimmed.slice(3).trim();
        continue;
      }

      // Source file
      if (trimmed.startsWith('SF:')) {
        currentFile = this.normalizePath(trimmed.slice(3));
        if (this.options.basePath) {
          const basePath = this.normalizePath(this.options.basePath);
          if (currentFile.startsWith(basePath)) {
            currentFile = currentFile.slice(basePath.length);
            if (currentFile.startsWith('/')) {
              currentFile = currentFile.slice(1);
            }
          }
        }
        currentFileLines = 0;
        currentFileHits = 0;
        functions.clear();
        continue;
      }

      // Function definition
      if (trimmed.startsWith('FN:')) {
        const parts = trimmed.slice(3).split(',');
        if (parts.length >= 2) {
          const lineNum = parseInt(parts[0]);
          const funcName = parts.slice(1).join(','); // Function name may contain commas
          functions.set(funcName, { line: lineNum, hits: 0 });
        }
        continue;
      }

      // Function hits
      if (trimmed.startsWith('FNDA:')) {
        const parts = trimmed.slice(5).split(',');
        if (parts.length >= 2) {
          const hits = parseInt(parts[0]);
          const funcName = parts.slice(1).join(',');
          const func = functions.get(funcName);
          if (func) {
            func.hits = hits;
          }
        }
        continue;
      }

      // Line data
      if (trimmed.startsWith('DA:')) {
        const parts = trimmed.slice(3).split(',');
        if (parts.length >= 2) {
          const hits = parseInt(parts[1]);
          currentFileLines++;
          if (hits > 0) {
            currentFileHits++;
          }
        }
        continue;
      }

      // Lines found (alternative to counting DA lines)
      if (trimmed.startsWith('LF:')) {
        const lf = parseInt(trimmed.slice(3));
        if (lf > currentFileLines) {
          currentFileLines = lf;
        }
        continue;
      }

      // Lines hit
      if (trimmed.startsWith('LH:')) {
        const lh = parseInt(trimmed.slice(3));
        if (lh > currentFileHits) {
          currentFileHits = lh;
        }
        continue;
      }

      // End of record
      if (trimmed === 'end_of_record') {
        if (currentFile && currentFileHits > 0) {
          files.push(currentFile);
          const coveragePct = currentFileLines > 0
            ? Math.round((currentFileHits / currentFileLines) * 100 * 100) / 100
            : 0;
          fileCoverage.set(currentFile, coveragePct);

          // Add function symbols
          for (const [funcName, funcData] of functions) {
            if (funcData.hits > 0) {
              coveredSymbols.push({
                filePath: currentFile,
                name: funcName,
                type: 'function',
                startLine: funcData.line,
                endLine: funcData.line, // LCOV doesn't provide end line
                hitCount: funcData.hits,
              });
            }
          }
        }

        totalLines += currentFileLines;
        coveredLines += currentFileHits;
        currentFile = '';
        continue;
      }
    }

    const testId = this.resolveTestId(coverageFile, testName);

    return {
      testId,
      coveredFiles: files.sort(),
      fileCoverage,
      coveredSymbols,
      totalLines,
      coveredLines,
    };
  }

  private resolveTestId(coverageFile: string, testName: string): string {
    if (this.options.testId) {
      return this.options.testId;
    }

    if (testName) {
      return testName;
    }

    if (this.options.testIdFromFilename) {
      // Extract test ID from filename like: test_name.info or coverage_test_name.info
      const filename = basename(coverageFile);
      const match = filename.match(/^(?:coverage[_-])?(.+?)\.info$/i);
      if (match) {
        return match[1];
      }
    }

    return basename(coverageFile).replace(/\.info$/i, '');
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
  }
}

/**
 * Options for JaCoCo parser
 */
export interface JacocoParserOptions {
  /**
   * Test ID to use for this coverage file
   */
  testId?: string;

  /**
   * Parse testId from filename
   */
  testIdFromFilename?: boolean;

  /**
   * Base package to strip from class names
   */
  basePackage?: string;
}

/**
 * Parser for JaCoCo XML coverage format
 * JaCoCo is the most common coverage tool for Java projects.
 *
 * JaCoCo XML structure:
 * - report: Root element with name attribute
 * - package: Java package with name and classes
 * - class: Java class with sourcefilename and methods
 * - method: Method with name, desc, and counters
 * - counter: Coverage counters (INSTRUCTION, BRANCH, LINE, COMPLEXITY, METHOD, CLASS)
 */
export class JacocoCoverageParser extends CoverageParser {
  private options: JacocoParserOptions;
  private xmlParser: XMLParser;

  constructor(options: JacocoParserOptions = {}) {
    super();
    this.options = options;
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      allowBooleanAttributes: true,
      parseAttributeValue: false,
    });
  }

  getFileExtension(): string {
    return '.xml';
  }

  async parse(coverageFile: string): Promise<CoverageData | null> {
    if (!existsSync(coverageFile)) {
      console.error(`Coverage file not found: ${coverageFile}`);
      return null;
    }

    try {
      const content = await readFile(coverageFile, 'utf-8');

      // Verify this is a JaCoCo report
      if (!content.includes('<report') || !content.includes('INSTRUCTION')) {
        return null;
      }

      const parsed = this.xmlParser.parse(content);
      return this.parseJacoco(coverageFile, parsed);
    } catch (error) {
      console.error(`Error parsing JaCoCo coverage file: ${error}`);
      return null;
    }
  }

  private parseJacoco(coverageFile: string, parsed: any): CoverageData | null {
    const report = parsed.report;
    if (!report) {
      return null;
    }

    const files: string[] = [];
    const fileCoverage = new Map<string, number>();
    const coveredSymbols: CoveredSymbol[] = [];
    let totalLines = 0;
    let coveredLines = 0;

    const reportName = report['@_name'] || '';
    const packages = report.package;
    if (!packages) {
      return null;
    }

    const packageList = Array.isArray(packages) ? packages : [packages];

    for (const pkg of packageList) {
      const pkgName = pkg['@_name'] || '';
      const classes = pkg.class;
      if (!classes) continue;

      const classList = Array.isArray(classes) ? classes : [classes];

      for (const cls of classList) {
        const className = cls['@_name'] || '';
        const sourceFile = cls['@_sourcefilename'] || '';

        // Build file path from package and source filename
        const filePath = this.buildFilePath(pkgName, sourceFile);

        // Get class line counter
        const classCounters = this.extractCounters(cls.counter);
        const classLineMissed = classCounters.LINE?.missed || 0;
        const classLineCovered = classCounters.LINE?.covered || 0;
        const classTotal = classLineMissed + classLineCovered;

        if (classLineCovered > 0) {
          if (!fileCoverage.has(filePath)) {
            files.push(filePath);
          }

          const existingCoverage = fileCoverage.get(filePath) || 0;
          const coveragePct = classTotal > 0
            ? Math.round((classLineCovered / classTotal) * 100 * 100) / 100
            : 0;
          fileCoverage.set(filePath, Math.max(existingCoverage, coveragePct));

          // Add class as symbol
          coveredSymbols.push({
            filePath,
            name: className.replace(/\//g, '.'),
            type: 'class',
            startLine: 1,
            endLine: 1,
            hitCount: classLineCovered,
            lineCoveragePct: coveragePct,
          });
        }

        totalLines += classTotal;
        coveredLines += classLineCovered;

        // Process methods
        const methods = cls.method;
        if (methods) {
          const methodList = Array.isArray(methods) ? methods : [methods];

          for (const method of methodList) {
            const methodName = method['@_name'] || '';
            const methodDesc = method['@_desc'] || '';
            const methodLine = parseInt(method['@_line'] || '0');

            const methodCounters = this.extractCounters(method.counter);
            const methodLineMissed = methodCounters.LINE?.missed || 0;
            const methodLineCovered = methodCounters.LINE?.covered || 0;

            if (methodLineCovered > 0) {
              const methodTotal = methodLineMissed + methodLineCovered;
              const methodPct = methodTotal > 0
                ? Math.round((methodLineCovered / methodTotal) * 100 * 100) / 100
                : 0;

              coveredSymbols.push({
                filePath,
                name: `${className.replace(/\//g, '.')}.${methodName}`,
                type: 'method',
                startLine: methodLine,
                endLine: methodLine,
                hitCount: methodLineCovered,
                lineCoveragePct: methodPct,
              });
            }
          }
        }
      }
    }

    const testId = this.resolveTestId(coverageFile, reportName);

    return {
      testId,
      coveredFiles: files.sort(),
      fileCoverage,
      coveredSymbols,
      totalLines,
      coveredLines,
    };
  }

  private extractCounters(counters: any): Record<string, { missed: number; covered: number }> {
    const result: Record<string, { missed: number; covered: number }> = {};
    if (!counters) return result;

    const counterList = Array.isArray(counters) ? counters : [counters];
    for (const counter of counterList) {
      const type = counter['@_type'];
      if (type) {
        result[type] = {
          missed: parseInt(counter['@_missed'] || '0'),
          covered: parseInt(counter['@_covered'] || '0'),
        };
      }
    }
    return result;
  }

  private buildFilePath(packageName: string, sourceFile: string): string {
    if (!packageName) return sourceFile;
    // Convert package name to path (com/example/pkg -> com/example/pkg/File.java)
    return `${packageName}/${sourceFile}`;
  }

  private resolveTestId(coverageFile: string, reportName: string): string {
    if (this.options.testId) {
      return this.options.testId;
    }

    if (reportName) {
      return reportName;
    }

    if (this.options.testIdFromFilename) {
      const filename = basename(coverageFile);
      const match = filename.match(/^(?:jacoco[_-])?(.+?)\.xml$/i);
      if (match) {
        return match[1];
      }
    }

    return basename(coverageFile).replace(/\.xml$/i, '');
  }
}

/**
 * Options for Istanbul/nyc parser
 */
export interface IstanbulParserOptions {
  /**
   * Test ID to use for this coverage file
   */
  testId?: string;

  /**
   * Parse testId from filename
   */
  testIdFromFilename?: boolean;

  /**
   * Base path to strip from source file paths
   */
  basePath?: string;
}

/**
 * Parser for Istanbul/nyc JSON coverage format
 * Istanbul (nyc) is the most common coverage tool for JavaScript/TypeScript.
 *
 * Istanbul JSON format:
 * - Keys are file paths
 * - Each file has: path, statementMap, fnMap, branchMap, s, f, b
 * - s: statement coverage (key -> hit count)
 * - f: function coverage (key -> hit count)
 * - b: branch coverage (key -> [hit counts])
 */
export class IstanbulCoverageParser extends CoverageParser {
  private options: IstanbulParserOptions;

  constructor(options: IstanbulParserOptions = {}) {
    super();
    this.options = options;
  }

  getFileExtension(): string {
    return '.json';
  }

  async parse(coverageFile: string): Promise<CoverageData | null> {
    if (!existsSync(coverageFile)) {
      console.error(`Coverage file not found: ${coverageFile}`);
      return null;
    }

    try {
      const content = await readFile(coverageFile, 'utf-8');
      const coverageJson = JSON.parse(content);

      // Check if this is Istanbul format (object with file paths as keys)
      if (typeof coverageJson !== 'object' || Array.isArray(coverageJson)) {
        return null;
      }

      // Check for Istanbul-specific structure
      const firstKey = Object.keys(coverageJson)[0];
      if (!firstKey) return null;

      const firstEntry = coverageJson[firstKey];
      if (!firstEntry || typeof firstEntry !== 'object') return null;

      // Istanbul format has 's' (statements), 'f' (functions), 'b' (branches)
      if (!('s' in firstEntry) && !('statementMap' in firstEntry)) {
        return null;
      }

      return this.parseIstanbul(coverageFile, coverageJson);
    } catch (error) {
      console.error(`Error parsing Istanbul coverage file: ${error}`);
      return null;
    }
  }

  private parseIstanbul(coverageFile: string, coverageJson: Record<string, any>): CoverageData | null {
    const files: string[] = [];
    const fileCoverage = new Map<string, number>();
    const coveredSymbols: CoveredSymbol[] = [];
    let totalLines = 0;
    let coveredLines = 0;

    for (const [filePath, fileData] of Object.entries(coverageJson)) {
      if (!fileData || typeof fileData !== 'object') continue;

      let normalizedPath = this.normalizePath(filePath);
      if (this.options.basePath) {
        const basePath = this.normalizePath(this.options.basePath);
        if (normalizedPath.startsWith(basePath)) {
          normalizedPath = normalizedPath.slice(basePath.length);
          if (normalizedPath.startsWith('/')) {
            normalizedPath = normalizedPath.slice(1);
          }
        }
      }

      // Statement coverage
      const statements = fileData.s || {};
      const statementMap = fileData.statementMap || {};
      let fileTotal = Object.keys(statements).length;
      let fileCovered = 0;

      for (const [key, hits] of Object.entries(statements)) {
        if (typeof hits === 'number' && hits > 0) {
          fileCovered++;
        }
      }

      // Function coverage
      const functions = fileData.f || {};
      const fnMap = fileData.fnMap || {};

      for (const [key, hits] of Object.entries(functions)) {
        const fnInfo = fnMap[key];
        if (fnInfo && typeof hits === 'number' && hits > 0) {
          const fnName = fnInfo.name || `anonymous_${key}`;
          const startLine = fnInfo.decl?.start?.line || fnInfo.loc?.start?.line || 1;
          const endLine = fnInfo.decl?.end?.line || fnInfo.loc?.end?.line || startLine;

          coveredSymbols.push({
            filePath: normalizedPath,
            name: fnName,
            type: 'function',
            startLine,
            endLine,
            hitCount: hits as number,
          });
        }
      }

      if (fileCovered > 0) {
        files.push(normalizedPath);
        const coveragePct = fileTotal > 0
          ? Math.round((fileCovered / fileTotal) * 100 * 100) / 100
          : 0;
        fileCoverage.set(normalizedPath, coveragePct);
      }

      totalLines += fileTotal;
      coveredLines += fileCovered;
    }

    const testId = this.resolveTestId(coverageFile);

    return {
      testId,
      coveredFiles: files.sort(),
      fileCoverage,
      coveredSymbols,
      totalLines,
      coveredLines,
    };
  }

  private resolveTestId(coverageFile: string): string {
    if (this.options.testId) {
      return this.options.testId;
    }

    if (this.options.testIdFromFilename) {
      const filename = basename(coverageFile);
      const match = filename.match(/^(?:coverage[_-])?(.+?)\.json$/i);
      if (match) {
        return match[1];
      }
    }

    return basename(coverageFile).replace(/\.json$/i, '');
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
  }
}

/**
 * Options for coverage.py parser
 */
export interface CoveragePyParserOptions {
  /**
   * Test ID to use for this coverage file
   */
  testId?: string;

  /**
   * Parse testId from filename
   */
  testIdFromFilename?: boolean;

  /**
   * Base path to strip from source file paths
   */
  basePath?: string;
}

/**
 * Parser for coverage.py JSON and XML formats
 * coverage.py is the standard coverage tool for Python.
 *
 * JSON format (coverage.py >= 5.0):
 * - meta: metadata including version, timestamp
 * - files: object with file paths as keys
 * - Each file has: executed_lines, missing_lines, excluded_lines, summary
 *
 * XML format (Cobertura-compatible):
 * - Uses same structure as Cobertura XML
 */
export class CoveragePyCoverageParser extends CoverageParser {
  private options: CoveragePyParserOptions;
  private xmlParser: XMLParser;

  constructor(options: CoveragePyParserOptions = {}) {
    super();
    this.options = options;
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      allowBooleanAttributes: true,
      parseAttributeValue: false,
    });
  }

  getFileExtension(): string {
    return '.json';
  }

  async parse(coverageFile: string): Promise<CoverageData | null> {
    if (!existsSync(coverageFile)) {
      console.error(`Coverage file not found: ${coverageFile}`);
      return null;
    }

    try {
      const content = await readFile(coverageFile, 'utf-8');

      // Try JSON format first
      if (coverageFile.endsWith('.json')) {
        try {
          const coverageJson = JSON.parse(content);
          if (coverageJson.meta && coverageJson.files) {
            return this.parseCoveragePyJson(coverageFile, coverageJson);
          }
        } catch {
          // Not JSON, try XML
        }
      }

      // Try XML format (Cobertura-compatible)
      if (content.includes('<coverage') && content.includes('python')) {
        const parsed = this.xmlParser.parse(content);
        return await this.parseCoveragePyXml(coverageFile, parsed);
      }

      return null;
    } catch (error) {
      console.error(`Error parsing coverage.py file: ${error}`);
      return null;
    }
  }

  private parseCoveragePyJson(coverageFile: string, coverageJson: any): CoverageData | null {
    const files: string[] = [];
    const fileCoverage = new Map<string, number>();
    const coveredSymbols: CoveredSymbol[] = [];
    let totalLines = 0;
    let coveredLines = 0;

    const filesData = coverageJson.files || {};

    for (const [filePath, fileData] of Object.entries(filesData)) {
      if (!fileData || typeof fileData !== 'object') continue;

      const data = fileData as any;
      let normalizedPath = this.normalizePath(filePath);

      if (this.options.basePath) {
        const basePath = this.normalizePath(this.options.basePath);
        if (normalizedPath.startsWith(basePath)) {
          normalizedPath = normalizedPath.slice(basePath.length);
          if (normalizedPath.startsWith('/')) {
            normalizedPath = normalizedPath.slice(1);
          }
        }
      }

      // coverage.py JSON format
      const executedLines = data.executed_lines || [];
      const missingLines = data.missing_lines || [];
      const summary = data.summary || {};

      const fileTotal = summary.num_statements || (executedLines.length + missingLines.length);
      const fileCovered = summary.covered_lines || executedLines.length;

      if (fileCovered > 0) {
        files.push(normalizedPath);
        const coveragePct = fileTotal > 0
          ? Math.round((fileCovered / fileTotal) * 100 * 100) / 100
          : 0;
        fileCoverage.set(normalizedPath, coveragePct);
      }

      totalLines += fileTotal;
      coveredLines += fileCovered;

      // Add function coverage if available
      const functions = data.functions || {};
      for (const [funcName, funcData] of Object.entries(functions)) {
        const func = funcData as any;
        if (func && func.executed_lines && func.executed_lines.length > 0) {
          coveredSymbols.push({
            filePath: normalizedPath,
            name: funcName,
            type: 'function',
            startLine: Math.min(...func.executed_lines),
            endLine: Math.max(...func.executed_lines),
            hitCount: func.executed_lines.length,
          });
        }
      }
    }

    const testId = this.resolveTestId(coverageFile);

    return {
      testId,
      coveredFiles: files.sort(),
      fileCoverage,
      coveredSymbols,
      totalLines,
      coveredLines,
    };
  }

  private async parseCoveragePyXml(coverageFile: string, parsed: any): Promise<CoverageData | null> {
    // Use Cobertura parser for XML format
    const coberturaParser = new CoberturaCoverageParser({
      testId: this.options.testId,
      testIdFromFilename: this.options.testIdFromFilename,
    });

    // Re-read file since we need to pass through Cobertura parser
    return coberturaParser.parse(coverageFile);
  }

  private resolveTestId(coverageFile: string): string {
    if (this.options.testId) {
      return this.options.testId;
    }

    if (this.options.testIdFromFilename) {
      const filename = basename(coverageFile);
      const match = filename.match(/^(?:coverage[_-])?(.+?)\.(?:json|xml)$/i);
      if (match) {
        return match[1];
      }
    }

    return basename(coverageFile).replace(/\.(?:json|xml)$/i, '');
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
  }
}

/**
 * Options for dotCover parser
 */
export interface DotCoverParserOptions {
  /**
   * Test ID to use for this coverage file
   */
  testId?: string;

  /**
   * Parse testId from filename
   */
  testIdFromFilename?: boolean;

  /**
   * Base path to strip from source file paths
   */
  basePath?: string;
}

/**
 * Parser for JetBrains dotCover XML format
 * dotCover is a .NET coverage tool from JetBrains.
 *
 * XML format structure:
 * - Root: Root element with name and coverage stats
 * - Assembly: .NET assembly with name and coverage
 * - Namespace: .NET namespace
 * - Type: Class/struct with methods
 * - Method: Method with statement coverage
 * - Statement: Source location with coverage
 */
export class DotCoverCoverageParser extends CoverageParser {
  private options: DotCoverParserOptions;
  private xmlParser: XMLParser;

  constructor(options: DotCoverParserOptions = {}) {
    super();
    this.options = options;
    this.xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      allowBooleanAttributes: true,
      parseAttributeValue: false,
    });
  }

  getFileExtension(): string {
    return '.xml';
  }

  async parse(coverageFile: string): Promise<CoverageData | null> {
    if (!existsSync(coverageFile)) {
      console.error(`Coverage file not found: ${coverageFile}`);
      return null;
    }

    try {
      const content = await readFile(coverageFile, 'utf-8');

      // Check for dotCover format
      if (!content.includes('<Root') && !content.includes('dotCover')) {
        return null;
      }

      const parsed = this.xmlParser.parse(content);
      return this.parseDotCover(coverageFile, parsed);
    } catch (error) {
      console.error(`Error parsing dotCover coverage file: ${error}`);
      return null;
    }
  }

  private parseDotCover(coverageFile: string, parsed: any): CoverageData | null {
    const root = parsed.Root;
    if (!root) {
      return null;
    }

    const files: string[] = [];
    const fileCoverage = new Map<string, number>();
    const coveredSymbols: CoveredSymbol[] = [];
    let totalLines = 0;
    let coveredLines = 0;

    // Track file statistics
    const fileStats = new Map<string, { total: number; covered: number }>();

    // Process assemblies
    const assemblies = root.Assembly;
    if (!assemblies) {
      return null;
    }

    const assemblyList = Array.isArray(assemblies) ? assemblies : [assemblies];

    for (const assembly of assemblyList) {
      this.processAssembly(assembly, coveredSymbols, fileStats);
    }

    // Calculate totals and file coverage
    for (const [filePath, stats] of fileStats) {
      let normalizedPath = filePath;
      if (this.options.basePath) {
        const basePath = this.normalizePath(this.options.basePath);
        if (normalizedPath.startsWith(basePath)) {
          normalizedPath = normalizedPath.slice(basePath.length);
          if (normalizedPath.startsWith('/')) {
            normalizedPath = normalizedPath.slice(1);
          }
        }
      }

      if (stats.covered > 0) {
        files.push(normalizedPath);
        const coveragePct = stats.total > 0
          ? Math.round((stats.covered / stats.total) * 100 * 100) / 100
          : 0;
        fileCoverage.set(normalizedPath, coveragePct);
      }

      totalLines += stats.total;
      coveredLines += stats.covered;
    }

    const testId = this.resolveTestId(coverageFile);

    return {
      testId,
      coveredFiles: files.sort(),
      fileCoverage,
      coveredSymbols,
      totalLines,
      coveredLines,
    };
  }

  private processAssembly(
    assembly: any,
    coveredSymbols: CoveredSymbol[],
    fileStats: Map<string, { total: number; covered: number }>
  ): void {
    const namespaces = assembly.Namespace;
    if (!namespaces) return;

    const namespaceList = Array.isArray(namespaces) ? namespaces : [namespaces];

    for (const ns of namespaceList) {
      this.processNamespace(ns, coveredSymbols, fileStats);
    }
  }

  private processNamespace(
    ns: any,
    coveredSymbols: CoveredSymbol[],
    fileStats: Map<string, { total: number; covered: number }>
  ): void {
    const types = ns.Type;
    if (!types) return;

    const typeList = Array.isArray(types) ? types : [types];
    const nsName = ns['@_Name'] || '';

    for (const type of typeList) {
      this.processType(type, nsName, coveredSymbols, fileStats);
    }
  }

  private processType(
    type: any,
    nsName: string,
    coveredSymbols: CoveredSymbol[],
    fileStats: Map<string, { total: number; covered: number }>
  ): void {
    const typeName = type['@_Name'] || '';
    const fullTypeName = nsName ? `${nsName}.${typeName}` : typeName;

    const methods = type.Method;
    if (!methods) return;

    const methodList = Array.isArray(methods) ? methods : [methods];

    for (const method of methodList) {
      const methodName = method['@_Name'] || '';
      const statements = method.Statement;
      if (!statements) continue;

      const statementList = Array.isArray(statements) ? statements : [statements];

      for (const stmt of statementList) {
        const filePath = this.normalizePath(stmt['@_File'] || '');
        const line = parseInt(stmt['@_Line'] || '0');
        const endLine = parseInt(stmt['@_EndLine'] || stmt['@_Line'] || '0');
        const covered = stmt['@_Covered'] === 'True' || stmt['@_Covered'] === 'true';

        if (!filePath) continue;

        // Update file stats
        if (!fileStats.has(filePath)) {
          fileStats.set(filePath, { total: 0, covered: 0 });
        }
        const stats = fileStats.get(filePath)!;
        stats.total++;
        if (covered) {
          stats.covered++;
        }

        // Add method symbol on first covered statement
        if (covered) {
          const existingSymbol = coveredSymbols.find(
            s => s.filePath === filePath && s.name === `${fullTypeName}.${methodName}`
          );
          if (!existingSymbol) {
            coveredSymbols.push({
              filePath,
              name: `${fullTypeName}.${methodName}`,
              type: 'method',
              startLine: line,
              endLine,
              hitCount: 1,
            });
          }
        }
      }
    }
  }

  private resolveTestId(coverageFile: string): string {
    if (this.options.testId) {
      return this.options.testId;
    }

    if (this.options.testIdFromFilename) {
      const filename = basename(coverageFile);
      const match = filename.match(/^(?:dotcover[_-])?(.+?)\.(?:xml|dcvr)$/i);
      if (match) {
        return match[1];
      }
    }

    return basename(coverageFile).replace(/\.(?:xml|dcvr)$/i, '');
  }

  private normalizePath(path: string): string {
    return path.replace(/\\/g, '/');
  }
}

/**
 * Get appropriate parser for a coverage file
 */
export function getParserForFile(filePath: string, options?: {
  executable?: string;
  coberturaOptions?: CoberturaParserOptions;
  openCppCoverageOptions?: OpenCppCoverageOptions;
  lcovOptions?: LcovParserOptions;
  jacocoOptions?: JacocoParserOptions;
  istanbulOptions?: IstanbulParserOptions;
  coveragePyOptions?: CoveragePyParserOptions;
  dotCoverOptions?: DotCoverParserOptions;
}): CoverageParser | null {
  const ext = extname(filePath).toLowerCase();
  const name = basename(filePath).toLowerCase();

  if (ext === '.profraw') {
    return new CppCoverageParser(options);
  }

  // LLVM pre-processed JSON format (*.cov.json)
  if (name.endsWith('.cov.json')) {
    return new LlvmJsonCoverageParser();
  }

  // Coverlet JSON format (*.coverage.json)
  if (ext === '.json' && name.includes('.coverage')) {
    return new CSharpCoverageParser();
  }

  // Cobertura XML format (*.cobertura.xml or *.xml with cobertura in name)
  if (ext === '.xml' && (name.includes('cobertura') || name.includes('coverage'))) {
    return new CoberturaCoverageParser(options?.coberturaOptions);
  }

  // OpenCppCoverage format (CoverageReport*.xml or opencppcoverage*.xml)
  if (ext === '.xml' && (name.includes('coveragereport') || name.includes('opencppcoverage'))) {
    return new OpenCppCoverageParser(options?.openCppCoverageOptions);
  }

  // LCOV/gcov format (.info files)
  if (ext === '.info' || name.endsWith('.lcov')) {
    return new LcovCoverageParser(options?.lcovOptions);
  }

  // JaCoCo format (jacoco*.xml)
  if (ext === '.xml' && (name.includes('jacoco') || name.startsWith('jacoco'))) {
    return new JacocoCoverageParser(options?.jacocoOptions);
  }

  // dotCover format (dotcover*.xml or *.dcvr)
  if ((ext === '.xml' && name.includes('dotcover')) || ext === '.dcvr') {
    return new DotCoverCoverageParser(options?.dotCoverOptions);
  }

  // Istanbul format (coverage-final.json, coverage*.json)
  if (ext === '.json' && (name.includes('istanbul') || name === 'coverage-final.json')) {
    return new IstanbulCoverageParser(options?.istanbulOptions);
  }

  // coverage.py format (coverage.json with meta/files structure)
  if (ext === '.json' && name.startsWith('coverage') && !name.includes('.coverage')) {
    return new CoveragePyCoverageParser(options?.coveragePyOptions);
  }

  // Generic XML files - try to auto-detect format
  if (ext === '.xml') {
    // Will be handled by caller with content inspection
    return new CoberturaCoverageParser(options?.coberturaOptions);
  }

  return null;
}
