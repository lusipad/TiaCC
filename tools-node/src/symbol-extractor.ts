/**
 * Symbol Extractor for TiaCC
 * Extracts function/method/class symbols from LLVM and Coverlet coverage data
 */

import { Symbol, SymbolType, CoveredSymbol } from './types.js';

/**
 * LLVM Coverage JSON structure (from llvm-cov export)
 */
interface LlvmCoverageData {
  data: Array<{
    files: Array<{
      filename: string;
      functions: Array<{
        name: string;
        count: number;
        regions: Array<[number, number, number, number, number, number, number, number?]>;
      }>;
      segments?: Array<[number, number, number, boolean, boolean, boolean?]>;
    }>;
  }>;
}

/**
 * Coverlet JSON structure (from dotnet test with Coverlet)
 */
interface CoverletCoverageData {
  [moduleName: string]: {
    [filePath: string]: {
      [className: string]: {
        [methodName: string]: {
          Lines: { [lineNumber: string]: number };
          Branches?: Array<{
            Line: number;
            Offset: number;
            EndOffset: number;
            Path: number;
            Ordinal: number;
            Hits: number;
          }>;
        };
      };
    };
  };
}

/**
 * Cobertura XML parsed structure (alternative format)
 */
interface CoberturaCoverageData {
  packages: Array<{
    name: string;
    classes: Array<{
      name: string;
      filename: string;
      'line-rate': number;
      methods: Array<{
        name: string;
        signature: string;
        'line-rate': number;
        lines: Array<{
          number: number;
          hits: number;
        }>;
      }>;
    }>;
  }>;
}

export class SymbolExtractor {
  /**
   * Extract symbols from LLVM coverage export JSON
   * LLVM format already contains function-level information
   */
  extractFromLlvmCov(coverageJson: LlvmCoverageData): CoveredSymbol[] {
    const symbols: CoveredSymbol[] = [];

    for (const dataEntry of coverageJson.data || []) {
      for (const file of dataEntry.files || []) {
        const filePath = this.normalizePath(file.filename);

        for (const func of file.functions || []) {
          // Parse regions to get line range
          const lineRange = this.extractLineRangeFromRegions(func.regions);

          if (lineRange) {
            // Determine symbol type from name
            const symbolType = this.inferSymbolType(func.name);

            symbols.push({
              filePath,
              name: func.name,
              type: symbolType,
              startLine: lineRange.start,
              endLine: lineRange.end,
              hitCount: func.count,
              lineCoveragePct: this.calculateCoverageFromRegions(func.regions),
            });
          }
        }
      }
    }

    return symbols;
  }

  /**
   * Extract symbols from Coverlet JSON format
   * Coverlet provides method-level coverage for .NET
   */
  extractFromCoverlet(coverageJson: CoverletCoverageData): CoveredSymbol[] {
    const symbols: CoveredSymbol[] = [];

    for (const moduleName of Object.keys(coverageJson)) {
      const module = coverageJson[moduleName];

      for (const filePath of Object.keys(module)) {
        const normalizedPath = this.normalizePath(filePath);
        const fileData = module[filePath];

        for (const className of Object.keys(fileData)) {
          const classData = fileData[className];

          // Add class as a symbol
          const classLines = this.getClassLineRange(classData);
          if (classLines) {
            symbols.push({
              filePath: normalizedPath,
              name: className,
              type: 'class',
              startLine: classLines.start,
              endLine: classLines.end,
              hitCount: this.getClassHitCount(classData),
              lineCoveragePct: this.calculateClassCoverage(classData),
            });
          }

          // Add methods as symbols
          for (const methodName of Object.keys(classData)) {
            const methodData = classData[methodName];
            const lines = Object.keys(methodData.Lines).map(Number);

            if (lines.length > 0) {
              const startLine = Math.min(...lines);
              const endLine = Math.max(...lines);
              const hitCount = this.calculateMethodHitCount(methodData.Lines);
              const coveredLines = Object.values(methodData.Lines).filter(h => h > 0).length;

              symbols.push({
                filePath: normalizedPath,
                name: `${className}::${methodName}`,
                type: 'method',
                startLine,
                endLine,
                hitCount,
                lineCoveragePct: lines.length > 0 ? (coveredLines / lines.length) * 100 : 0,
              });
            }
          }
        }
      }
    }

    return symbols;
  }

  /**
   * Extract symbols from Cobertura XML (parsed to JSON)
   */
  extractFromCobertura(coverageData: CoberturaCoverageData): CoveredSymbol[] {
    const symbols: CoveredSymbol[] = [];

    for (const pkg of coverageData.packages || []) {
      for (const cls of pkg.classes || []) {
        const filePath = this.normalizePath(cls.filename);

        // Add class as symbol
        const classLines = cls.methods.flatMap(m => m.lines.map(l => l.number));
        if (classLines.length > 0) {
          symbols.push({
            filePath,
            name: cls.name,
            type: 'class',
            startLine: Math.min(...classLines),
            endLine: Math.max(...classLines),
            hitCount: cls.methods.reduce((sum, m) => sum + m.lines.filter(l => l.hits > 0).length, 0),
            lineCoveragePct: cls['line-rate'] * 100,
          });
        }

        // Add methods as symbols
        for (const method of cls.methods || []) {
          const lines = method.lines.map(l => l.number);
          if (lines.length > 0) {
            const coveredLines = method.lines.filter(l => l.hits > 0).length;

            symbols.push({
              filePath,
              name: `${cls.name}::${method.name}`,
              type: 'method',
              startLine: Math.min(...lines),
              endLine: Math.max(...lines),
              hitCount: coveredLines,
              lineCoveragePct: method['line-rate'] * 100,
              // signature is available in Cobertura
            });
          }
        }
      }
    }

    return symbols;
  }

  /**
   * Map covered lines to symbols
   * Useful when we only have line-level coverage and need to aggregate to symbols
   */
  mapLinesToSymbols(
    coveredLines: number[],
    symbols: Symbol[],
    filePath: string
  ): CoveredSymbol[] {
    const result: CoveredSymbol[] = [];

    for (const symbol of symbols) {
      // Count how many covered lines fall within this symbol's range
      const linesInSymbol = coveredLines.filter(
        line => line >= symbol.startLine && line <= symbol.endLine
      );

      if (linesInSymbol.length > 0) {
        const totalLinesInSymbol = symbol.endLine - symbol.startLine + 1;
        result.push({
          filePath,
          name: symbol.name,
          type: symbol.type,
          startLine: symbol.startLine,
          endLine: symbol.endLine,
          hitCount: linesInSymbol.length,
          lineCoveragePct: (linesInSymbol.length / totalLinesInSymbol) * 100,
        });
      }
    }

    return result;
  }

  /**
   * Detect coverage format and extract symbols accordingly
   */
  extractSymbols(coverageJson: unknown): CoveredSymbol[] {
    // Detect LLVM format
    if (this.isLlvmFormat(coverageJson)) {
      return this.extractFromLlvmCov(coverageJson as LlvmCoverageData);
    }

    // Detect Coverlet format
    if (this.isCoverletFormat(coverageJson)) {
      return this.extractFromCoverlet(coverageJson as CoverletCoverageData);
    }

    // Detect Cobertura format
    if (this.isCoberturaFormat(coverageJson)) {
      return this.extractFromCobertura(coverageJson as CoberturaCoverageData);
    }

    console.warn('Unknown coverage format, cannot extract symbols');
    return [];
  }

  // ============ Private helper methods ============

  private isLlvmFormat(data: unknown): boolean {
    return (
      typeof data === 'object' &&
      data !== null &&
      'data' in data &&
      Array.isArray((data as any).data)
    );
  }

  private isCoverletFormat(data: unknown): boolean {
    if (typeof data !== 'object' || data === null) return false;

    // Coverlet format has module names as top-level keys
    const keys = Object.keys(data);
    if (keys.length === 0) return false;

    // Check if first key's value contains file paths
    const firstModule = (data as any)[keys[0]];
    if (typeof firstModule !== 'object' || firstModule === null) return false;

    // Check for class/method structure
    const filePaths = Object.keys(firstModule);
    if (filePaths.length === 0) return false;

    const firstFile = firstModule[filePaths[0]];
    if (typeof firstFile !== 'object' || firstFile === null) return false;

    // Check if it has Lines property in nested structure
    const classNames = Object.keys(firstFile);
    if (classNames.length === 0) return false;

    const firstClass = firstFile[classNames[0]];
    const methodNames = Object.keys(firstClass);
    if (methodNames.length === 0) return false;

    return 'Lines' in firstClass[methodNames[0]];
  }

  private isCoberturaFormat(data: unknown): boolean {
    return (
      typeof data === 'object' &&
      data !== null &&
      'packages' in data &&
      Array.isArray((data as any).packages)
    );
  }

  private normalizePath(filePath: string): string {
    // Normalize path separators
    return filePath.replace(/\\/g, '/');
  }

  private inferSymbolType(name: string): SymbolType {
    // C++ method detection (contains ::)
    if (name.includes('::')) {
      // Check if it's a namespace or class method
      const parts = name.split('::');
      if (parts.length >= 2) {
        // If the last part matches the second-to-last, it's likely a constructor
        const lastName = parts[parts.length - 1];
        const secondLastName = parts[parts.length - 2];

        // Destructors
        if (lastName.startsWith('~')) {
          return 'method';
        }

        // Constructors
        if (lastName === secondLastName) {
          return 'method';
        }

        return 'method';
      }
    }

    // Default to function
    return 'function';
  }

  private extractLineRangeFromRegions(
    regions: Array<[number, number, number, number, number, number, number, number?]>
  ): { start: number; end: number } | null {
    if (!regions || regions.length === 0) return null;

    // LLVM region format: [startLine, startCol, endLine, endCol, count, fileId, expandedFileId, kind?]
    let minLine = Infinity;
    let maxLine = -Infinity;

    for (const region of regions) {
      const startLine = region[0];
      const endLine = region[2];
      minLine = Math.min(minLine, startLine);
      maxLine = Math.max(maxLine, endLine);
    }

    if (minLine === Infinity || maxLine === -Infinity) return null;

    return { start: minLine, end: maxLine };
  }

  private calculateCoverageFromRegions(
    regions: Array<[number, number, number, number, number, number, number, number?]>
  ): number {
    if (!regions || regions.length === 0) return 0;

    let coveredRegions = 0;
    for (const region of regions) {
      const count = region[4];
      if (count > 0) coveredRegions++;
    }

    return (coveredRegions / regions.length) * 100;
  }

  private getClassLineRange(
    classData: { [methodName: string]: { Lines: { [lineNumber: string]: number } } }
  ): { start: number; end: number } | null {
    const allLines: number[] = [];

    for (const methodName of Object.keys(classData)) {
      const lines = Object.keys(classData[methodName].Lines).map(Number);
      allLines.push(...lines);
    }

    if (allLines.length === 0) return null;

    return {
      start: Math.min(...allLines),
      end: Math.max(...allLines),
    };
  }

  private getClassHitCount(
    classData: { [methodName: string]: { Lines: { [lineNumber: string]: number } } }
  ): number {
    let totalHits = 0;

    for (const methodName of Object.keys(classData)) {
      for (const hits of Object.values(classData[methodName].Lines)) {
        if (hits > 0) totalHits++;
      }
    }

    return totalHits;
  }

  private calculateClassCoverage(
    classData: { [methodName: string]: { Lines: { [lineNumber: string]: number } } }
  ): number {
    let totalLines = 0;
    let coveredLines = 0;

    for (const methodName of Object.keys(classData)) {
      const lines = classData[methodName].Lines;
      totalLines += Object.keys(lines).length;
      coveredLines += Object.values(lines).filter(h => h > 0).length;
    }

    return totalLines > 0 ? (coveredLines / totalLines) * 100 : 0;
  }

  private calculateMethodHitCount(lines: { [lineNumber: string]: number }): number {
    return Object.values(lines).reduce((sum, hits) => sum + (hits > 0 ? 1 : 0), 0);
  }
}

// Export singleton instance
export const symbolExtractor = new SymbolExtractor();
