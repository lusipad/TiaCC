#!/usr/bin/env node
/**
 * TiaCC Init CLI
 *
 * Initialize TiaCC configuration for a project.
 * Detects project type and generates appropriate configuration.
 */

import { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import ora from 'ora';
import type { ProjectConfig, ProjectPreset } from '../types.js';

const CONFIG_DIR = '.tiacc';
const CONFIG_FILE = 'config.json';

/**
 * Preset configurations for different project types
 */
const PRESETS: Record<ProjectPreset, Omit<ProjectConfig, 'version' | 'preset'>> = {
  dotnet: {
    db: 'impact_map.db',
    coverageDir: 'coverage',
    testProjects: ['**/*.Tests.csproj', '**/*.Test.csproj', '**/Tests/**/*.csproj'],
    sourcePatterns: ['**/*.cs'],
    excludePatterns: ['**/obj/**', '**/bin/**', '**/node_modules/**', '**/*.Tests/**', '**/*.Test/**'],
    coverage: {
      format: 'coverlet',
      testIdFrom: 'filename',
    },
    build: {
      concurrency: 4,
      verbose: false,
    },
  },
  cpp: {
    db: 'impact_map.db',
    coverageDir: 'coverage',
    sourcePatterns: ['**/*.cpp', '**/*.cc', '**/*.cxx', '**/*.c', '**/*.h', '**/*.hpp'],
    excludePatterns: ['**/build/**', '**/cmake-build-*/**', '**/third_party/**', '**/vendor/**'],
    coverage: {
      format: 'llvm',
    },
    build: {
      concurrency: 4,
      verbose: false,
    },
  },
  typescript: {
    db: 'impact_map.db',
    coverageDir: 'coverage',
    testProjects: ['**/*.test.ts', '**/*.spec.ts', '**/tests/**/*.ts'],
    sourcePatterns: ['**/*.ts', '**/*.tsx'],
    excludePatterns: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/*.test.ts', '**/*.spec.ts'],
    coverage: {
      format: 'istanbul',
    },
    build: {
      concurrency: 4,
      verbose: false,
    },
  },
  java: {
    db: 'impact_map.db',
    coverageDir: 'coverage',
    testProjects: ['**/src/test/**/*.java'],
    sourcePatterns: ['**/*.java'],
    excludePatterns: ['**/target/**', '**/build/**', '**/src/test/**'],
    coverage: {
      format: 'jacoco',
    },
    build: {
      concurrency: 4,
      verbose: false,
    },
  },
  python: {
    db: 'impact_map.db',
    coverageDir: 'coverage',
    testProjects: ['**/test_*.py', '**/*_test.py', '**/tests/**/*.py'],
    sourcePatterns: ['**/*.py'],
    excludePatterns: ['**/__pycache__/**', '**/venv/**', '**/.venv/**', '**/test_*.py', '**/*_test.py'],
    coverage: {
      format: 'coveragepy',
    },
    build: {
      concurrency: 4,
      verbose: false,
    },
  },
  lua: {
    db: 'impact_map.db',
    coverageDir: 'coverage',
    testProjects: ['**/test_*.lua', '**/*_test.lua'],
    sourcePatterns: ['**/*.lua'],
    excludePatterns: ['**/test_*.lua', '**/*_test.lua'],
    coverage: {
      format: 'luacov',
      testIdFrom: 'source',
    },
    build: {
      concurrency: 4,
      verbose: false,
    },
  },
  custom: {
    db: 'impact_map.db',
    coverageDir: 'coverage',
    sourcePatterns: ['**/*'],
    excludePatterns: [],
    build: {
      concurrency: 4,
      verbose: false,
    },
  },
};

/**
 * Detect project type by looking for characteristic files
 */
function detectProjectType(dir: string): ProjectPreset {
  const files = readdirSync(dir, { recursive: false }) as string[];

  // Check for .NET
  if (files.some(f => f.endsWith('.csproj') || f.endsWith('.sln'))) {
    return 'dotnet';
  }

  // Check for TypeScript/JavaScript
  if (files.includes('package.json') && (files.includes('tsconfig.json') || files.some(f => f.endsWith('.ts')))) {
    return 'typescript';
  }

  // Check for Java/Maven/Gradle
  if (files.includes('pom.xml') || files.includes('build.gradle') || files.includes('build.gradle.kts')) {
    return 'java';
  }

  // Check for Python
  if (files.includes('setup.py') || files.includes('pyproject.toml') || files.includes('requirements.txt')) {
    return 'python';
  }

  // Check for C++
  if (files.includes('CMakeLists.txt') || files.some(f => f.endsWith('.cpp') || f.endsWith('.cc'))) {
    return 'cpp';
  }

  // Check for Lua
  if (files.some(f => f.endsWith('.lua')) || files.includes('.luacov')) {
    return 'lua';
  }

  return 'custom';
}

/**
 * Generate configuration for a preset
 */
function generateConfig(preset: ProjectPreset): ProjectConfig {
  return {
    version: 1,
    preset,
    ...PRESETS[preset],
  };
}

const program = new Command();

program
  .name('tiacc-init')
  .description('Initialize TiaCC configuration for a project')
  .version('1.0.0');

program
  .command('init', { isDefault: true })
  .description('Initialize TiaCC in the current directory')
  .option('-p, --preset <type>', 'Project preset (dotnet, cpp, typescript, java, python, lua, custom)')
  .option('-f, --force', 'Overwrite existing configuration')
  .option('-d, --dir <path>', 'Project directory', '.')
  .action(async (options: { preset?: ProjectPreset; force?: boolean; dir: string }) => {
    const projectDir = resolve(options.dir);
    const configDir = join(projectDir, CONFIG_DIR);
    const configPath = join(configDir, CONFIG_FILE);

    // Check if already initialized
    if (existsSync(configPath) && !options.force) {
      console.error(`❌ TiaCC already initialized. Use --force to overwrite.`);
      process.exit(1);
    }

    const spinner = ora('Detecting project type...').start();

    try {
      // Detect or use specified preset
      const preset = options.preset || detectProjectType(projectDir);
      spinner.text = `Detected project type: ${preset}`;

      // Generate configuration
      const config = generateConfig(preset);

      // Create .tiacc directory
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }

      // Create coverage directory
      const coverageDir = join(configDir, config.coverageDir);
      if (!existsSync(coverageDir)) {
        mkdirSync(coverageDir, { recursive: true });
      }

      // Write configuration file
      writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

      // Create .gitignore for .tiacc directory
      const gitignorePath = join(configDir, '.gitignore');
      if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, `# TiaCC generated files
impact_map.db
impact_map.db-journal
coverage/
*.log
`);
      }

      spinner.succeed(`TiaCC initialized with ${preset} preset`);

      console.log(`
📁 Created:
   ${CONFIG_DIR}/
   ├── ${CONFIG_FILE}     # Configuration file
   ├── .gitignore         # Git ignore rules
   └── coverage/          # Coverage data directory

📝 Next steps:
   1. Review and customize ${CONFIG_DIR}/${CONFIG_FILE}
   2. Run your tests with coverage collection
   3. Build the mapping: tiacc build
   4. Get recommendations: tiacc recommend --branch origin/main
`);

      // Show preset-specific instructions
      if (preset === 'dotnet') {
        console.log(`💡 For .NET projects:
   # Install TiaCC.Coverlet.Collector (coming soon)
   dotnet add package TiaCC.Coverlet.Collector

   # Or use Coverlet manually:
   dotnet test --collect:"XPlat Code Coverage" \\
     --results-directory .tiacc/coverage
`);
      }
    } catch (error) {
      spinner.fail('Failed to initialize TiaCC');
      console.error(error);
      process.exit(1);
    }
  });

program.parse();
