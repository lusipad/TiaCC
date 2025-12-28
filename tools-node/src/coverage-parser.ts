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
 * Get appropriate parser for a coverage file
 */
export function getParserForFile(filePath: string, options?: {
  executable?: string;
  coberturaOptions?: CoberturaParserOptions;
  openCppCoverageOptions?: OpenCppCoverageOptions;
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

  // Generic XML files - try to auto-detect format
  if (ext === '.xml') {
    // Will be handled by caller with content inspection
    return new CoberturaCoverageParser(options?.coberturaOptions);
  }

  return null;
}
