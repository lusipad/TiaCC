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

// ============ Test Run & Results types (Phase 5) ============

/** Trigger type for test runs */
export type TriggerType = 'manual' | 'push' | 'pull_request' | 'schedule' | 'api' | 'other';

/** Test run status */
export type RunStatus = 'running' | 'passed' | 'failed' | 'cancelled' | 'timeout';

/** Git information for a test run */
export interface GitInfo {
  commitHash: string;
  branch?: string;
  author?: string;
  authorEmail?: string;
  commitMessage?: string;
  commitDate?: string;
  parentCommits?: string[];
  diffStats?: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}

/** Tag for categorizing test runs */
export interface Tag {
  id?: number;
  name: string;
  category?: string;  // e.g., 'version', 'environment', 'build', 'custom'
  color?: string;     // hex color for UI display
  description?: string;
}

/** A complete test run (collection of test results) */
export interface TestRun {
  id?: number;
  runDate: string;
  status: RunStatus;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  totalDurationMs: number;
  environment?: string;
  triggerType?: TriggerType;
  gitInfo?: GitInfo;
  tags?: Tag[];
  metadata?: Record<string, unknown>;
}

/** Individual test result within a run */
export interface TestResult {
  id?: number;
  runId: number;
  testScriptId: number;
  testName?: string;        // specific test case name within script
  passed: boolean;
  skipped?: boolean;
  durationMs?: number;
  errorMessage?: string;
  stackTrace?: string;
  stdout?: string;
  stderr?: string;
  retryCount?: number;
  metadata?: Record<string, unknown>;
}

/** Summary statistics for reports */
export interface TestRunSummary {
  totalRuns: number;
  totalTests: number;
  passRate: number;
  avgDurationMs: number;
  failedTests: number;
  flakyTests: number;
}

/** Trend data point for charts */
export interface TrendDataPoint {
  date: string;
  passRate: number;
  totalTests: number;
  failedTests: number;
  avgDurationMs: number;
  runCount: number;
}

/** Report filter options */
export interface ReportFilter {
  startDate?: string;
  endDate?: string;
  tags?: string[];
  branch?: string;
  status?: RunStatus;
  environment?: string;
  triggerType?: TriggerType;
}

/** Report export format */
export type ExportFormat = 'json' | 'csv' | 'html' | 'markdown';

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
