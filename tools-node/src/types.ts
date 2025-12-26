/**
 * Type definitions for TiaCC
 */

export interface SourceFile {
  id: number;
  filePath: string;
  fileHash: string | null;
  lastUpdated: string;
}

export interface TestScript {
  id: number;
  scriptPath: string;
  lastRun: string | null;
  avgDurationMs: number | null;
}

export interface CoverageMapping {
  sourceFileId: number;
  testScriptId: number;
  lineCoveragePct: number;
  createdAt: string;
}

export interface CoverageRun {
  id: number;
  runDate: string;
  totalTests: number;
  totalSources: number;
  commitHash: string | null;
}

export interface DbStats {
  sourceFiles: number;
  testScripts: number;
  mappings: number;
}

export interface CoverageData {
  testId: string;
  coveredFiles: string[];
  fileCoverage?: Map<string, number>;  // File path -> coverage percentage
  coveredSymbols?: CoveredSymbol[];  // Function-level coverage
  totalLines: number;
  coveredLines: number;
}

// ============ Symbol-level types ============

export type SymbolType = 'function' | 'method' | 'class' | 'namespace';

export interface Symbol {
  id?: number;
  sourceFileId: number;
  name: string;
  type: SymbolType;
  startLine: number;
  endLine: number;
  signature?: string;
}

export interface CoveredSymbol {
  filePath: string;
  name: string;
  type: SymbolType;
  startLine: number;
  endLine: number;
  hitCount: number;
  lineCoveragePct?: number;
}

export interface SymbolCoverage {
  symbolId: number;
  testScriptId: number;
  hitCount: number;
  lineCoveragePct: number;
}

export interface FunctionTestMapping {
  functionName: string;
  filePath: string;
  startLine: number;
  endLine: number;
  tests: Array<{
    testPath: string;
    coverage: number;
  }>;
}

export interface TiaConfig {
  recordingMode: 'precise' | 'bucket';
  bucketSize: number;
  outputDir: string;
  cppService: {
    host: string;
    port: number;
  };
  csharpService: {
    host: string;
    port: number;
  };
  sourceExtensions: string[];
  testExtensions: string[];
}
