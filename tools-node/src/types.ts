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
  totalLines: number;
  coveredLines: number;
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
