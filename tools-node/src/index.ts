/**
 * TiaCC - Test Impact Analysis for Code Coverage
 *
 * A system for mapping code changes to affected tests using coverage data.
 *
 * @example Quick Start
 * ```typescript
 * import { TiaCC } from '@tiacc/tools';
 *
 * // Initialize
 * const tia = await TiaCC.init('./impact_map.db');
 *
 * // Build mapping (in nightly CI)
 * await tia.buildMapping('./coverage');
 *
 * // Get affected tests (in PR check)
 * const result = await tia.getAffectedTests({ baseBranch: 'origin/main' });
 * console.log(result.tests);
 * ```
 */

// ============ High-level API (recommended for external users) ============
export { TiaCC, createTiaCC } from './tiacc.js';
export type {
  TiaCCConfig,
  BuildMappingOptions,
  GetAffectedTestsOptions,
  AffectedTestsResult,
} from './tiacc.js';

// ============ Low-level components ============
export { Database, initDatabase } from './database.js';
export {
  CoverageParser,
  CppCoverageParser,
  CSharpCoverageParser,
  LlvmJsonCoverageParser,
  OpenCppCoverageParser,
  CoberturaCoverageParser,
  LcovCoverageParser,
  JacocoCoverageParser,
  IstanbulCoverageParser,
  CoveragePyCoverageParser,
  DotCoverCoverageParser,
  getParserForFile,
} from './coverage-parser.js';
export type {
  CoberturaParserOptions,
  OpenCppCoverageOptions,
  LcovParserOptions,
  JacocoParserOptions,
  IstanbulParserOptions,
  CoveragePyParserOptions,
  DotCoverParserOptions,
} from './coverage-parser.js';
export { GitUtils } from './git-utils.js';
export { SymbolExtractor } from './symbol-extractor.js';
export { loadConfig, findConfigDir, mergeWithConfig, getProjectRoot } from './config.js';
export type { CoverageData, SourceFile, TestScript, CoverageMapping, DbStats, ProjectConfig, ProjectPreset } from './types.js';

// ============ Error handling ============
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
