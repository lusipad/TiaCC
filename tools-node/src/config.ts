/**
 * TiaCC Configuration Loader
 *
 * Loads and validates project configuration from .tiacc/config.json
 */

import { existsSync, readFileSync } from 'fs';
import { join, resolve, dirname } from 'path';
import type { ProjectConfig, ProjectPreset } from './types.js';

const CONFIG_DIR = '.tiacc';
const CONFIG_FILE = 'config.json';

/**
 * Find the .tiacc directory by walking up from the current directory
 */
export function findConfigDir(startDir: string = process.cwd()): string | null {
  let dir = resolve(startDir);
  const root = dirname(dir);

  while (dir !== root) {
    const configDir = join(dir, CONFIG_DIR);
    if (existsSync(join(configDir, CONFIG_FILE))) {
      return configDir;
    }
    dir = dirname(dir);
  }

  // Check root as well
  const rootConfig = join(root, CONFIG_DIR);
  if (existsSync(join(rootConfig, CONFIG_FILE))) {
    return rootConfig;
  }

  return null;
}

/**
 * Load configuration from .tiacc/config.json
 */
export function loadConfig(startDir?: string): ProjectConfig | null {
  const configDir = findConfigDir(startDir);
  if (!configDir) {
    return null;
  }

  const configPath = join(configDir, CONFIG_FILE);
  try {
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content) as ProjectConfig;
    return validateConfig(config);
  } catch {
    return null;
  }
}

/**
 * Get the project root directory (parent of .tiacc)
 */
export function getProjectRoot(startDir?: string): string | null {
  const configDir = findConfigDir(startDir);
  if (!configDir) {
    return null;
  }
  return dirname(configDir);
}

/**
 * Resolve a path relative to .tiacc directory
 */
export function resolveConfigPath(relativePath: string, startDir?: string): string | null {
  const configDir = findConfigDir(startDir);
  if (!configDir) {
    return null;
  }
  return join(configDir, relativePath);
}

/**
 * Validate configuration structure
 */
function validateConfig(config: unknown): ProjectConfig {
  if (!config || typeof config !== 'object') {
    throw new Error('Invalid configuration: expected object');
  }

  const c = config as Record<string, unknown>;

  if (c.version !== 1) {
    throw new Error(`Unsupported configuration version: ${c.version}`);
  }

  const validPresets: ProjectPreset[] = ['dotnet', 'cpp', 'typescript', 'java', 'python', 'lua', 'custom'];
  if (!validPresets.includes(c.preset as ProjectPreset)) {
    throw new Error(`Invalid preset: ${c.preset}`);
  }

  if (typeof c.db !== 'string') {
    throw new Error('Invalid configuration: db must be a string');
  }

  if (typeof c.coverageDir !== 'string') {
    throw new Error('Invalid configuration: coverageDir must be a string');
  }

  if (!Array.isArray(c.sourcePatterns)) {
    throw new Error('Invalid configuration: sourcePatterns must be an array');
  }

  if (!Array.isArray(c.excludePatterns)) {
    throw new Error('Invalid configuration: excludePatterns must be an array');
  }

  return config as ProjectConfig;
}

/**
 * Merge CLI options with configuration file
 * CLI options take precedence over config file
 */
export interface MergedOptions {
  db: string;
  coverageDir: string;
  basePath?: string;
  testIdFrom?: 'filename' | 'env' | 'source';
  testIdEnvVar?: string;
  concurrency: number;
  verbose: boolean;
  format?: string;
}

export function mergeWithConfig(
  cliOptions: Partial<MergedOptions>,
  startDir?: string
): MergedOptions {
  const config = loadConfig(startDir);
  const configDir = findConfigDir(startDir);

  // Default values
  const defaults: MergedOptions = {
    db: 'impact_map.db',
    coverageDir: './coverage_data',
    concurrency: 4,
    verbose: false,
  };

  // If no config file, use CLI options with defaults
  if (!config || !configDir) {
    return {
      ...defaults,
      ...cliOptions,
    };
  }

  // Merge config file with CLI options (CLI takes precedence)
  return {
    db: cliOptions.db || join(configDir, config.db),
    coverageDir: cliOptions.coverageDir || join(configDir, config.coverageDir),
    basePath: cliOptions.basePath || config.basePath,
    testIdFrom: cliOptions.testIdFrom || config.coverage?.testIdFrom,
    testIdEnvVar: cliOptions.testIdEnvVar || config.coverage?.testIdEnvVar,
    concurrency: cliOptions.concurrency ?? config.build?.concurrency ?? defaults.concurrency,
    verbose: cliOptions.verbose ?? config.build?.verbose ?? defaults.verbose,
    format: cliOptions.format || config.coverage?.format,
  };
}
