/**
 * Coverage data parsers for LLVM and coverlet formats.
 * Extended to support function-level symbol extraction.
 */

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { basename, extname } from 'path';
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
 * Get appropriate parser for a coverage file
 */
export function getParserForFile(filePath: string, options?: {
  executable?: string;
}): CoverageParser | null {
  const ext = extname(filePath).toLowerCase();
  const name = basename(filePath).toLowerCase();

  if (ext === '.profraw') {
    return new CppCoverageParser(options);
  }

  if (ext === '.json' && name.includes('.coverage')) {
    return new CSharpCoverageParser();
  }

  return null;
}
