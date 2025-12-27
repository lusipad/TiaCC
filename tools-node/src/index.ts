/**
 * TiaCC - Test Impact Analysis for Code Coverage
 *
 * A system for mapping code changes to affected tests using coverage data.
 */

export { Database, initDatabase } from './database.js';
export { CoverageParser, CppCoverageParser, CSharpCoverageParser, LlvmJsonCoverageParser, getParserForFile } from './coverage-parser.js';
export { GitUtils } from './git-utils.js';
export { SymbolExtractor } from './symbol-extractor.js';
export type { CoverageData, SourceFile, TestScript, CoverageMapping, DbStats } from './types.js';

// Error handling
export {
  TiaError,
  DatabaseError,
  CoverageParseError,
  GitError,
  ConfigError,
  IpcError,
  handleError,
  formatErrorMessage,
} from './errors.js';
