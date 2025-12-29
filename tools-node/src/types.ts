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

// ============ Project Configuration (.tiacc/config.json) ============

export type ProjectPreset = 'dotnet' | 'cpp' | 'typescript' | 'java' | 'python' | 'lua' | 'custom';

export interface ProjectConfig {
  /** Configuration version */
  version: 1;
  /** Project preset type */
  preset: ProjectPreset;
  /** Path to SQLite database (relative to .tiacc/) */
  db: string;
  /** Directory for coverage files (relative to .tiacc/) */
  coverageDir: string;
  /** Test project patterns */
  testProjects?: string[];
  /** Source file patterns to include */
  sourcePatterns: string[];
  /** Patterns to exclude */
  excludePatterns: string[];
  /** Base path to strip from file paths */
  basePath?: string;
  /** Coverage format options */
  coverage?: {
    /** Coverage format: coverlet, cobertura, llvm, istanbul, etc. */
    format?: string;
    /** Test ID extraction method */
    testIdFrom?: 'filename' | 'env' | 'source';
    /** Environment variable name for testId (when testIdFrom is 'env') */
    testIdEnvVar?: string;
  };
  /** Build options */
  build?: {
    /** Number of parallel workers */
    concurrency?: number;
    /** Enable verbose output */
    verbose?: boolean;
  };
}
