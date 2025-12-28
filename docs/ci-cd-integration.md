# TiaCC CI/CD Integration Guide

TiaCC can be integrated into your CI/CD pipeline to automatically run only affected tests on pull requests, significantly reducing CI time.

## Quick Start

### GitHub Actions

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Required for git diff

      - uses: tiacc/action@v1
        id: tiacc
        with:
          mode: auto
          coverage-dir: ./coverage
          format: auto

      - name: Run tests
        run: |
          if [ -n "${{ steps.tiacc.outputs.affected-tests }}" ]; then
            # Run only affected tests
            npm test -- --grep "${{ steps.tiacc.outputs.affected-tests }}"
          else
            npm test
          fi
```

### GitLab CI

```yaml
include:
  - remote: 'https://raw.githubusercontent.com/your-org/TiaCC/main/ci-templates/gitlab-ci.yml'

stages:
  - analyze
  - test

tiacc-recommend:
  stage: analyze

unit-tests:
  extends: .tiacc-test
  stage: test
  script:
    - |
      if [ -n "$TIACC_TEST_FILTER" ]; then
        npm test -- --grep "$TIACC_TEST_FILTER"
      else
        npm test
      fi
```

### Jenkins

```groovy
// Jenkinsfile
pipeline {
    agent any

    environment {
        TIACC_DATABASE = 'impact_map.db'
        TIACC_COVERAGE_DIR = './coverage'
    }

    stages {
        stage('Setup') {
            steps {
                sh 'npm install -g @tiacc/tools'
            }
        }

        stage('Restore Database') {
            steps {
                copyArtifacts(
                    projectName: env.JOB_NAME,
                    filter: 'impact_map.db',
                    selector: lastSuccessful(),
                    optional: true
                )
            }
        }

        stage('Build Mapping') {
            when { branch 'main' }
            steps {
                sh 'npm test -- --coverage'
                sh 'tia-mapper build -c ./coverage -d impact_map.db'
                archiveArtifacts artifacts: 'impact_map.db'
            }
        }

        stage('Recommend Tests') {
            when { changeRequest() }
            steps {
                script {
                    env.AFFECTED = sh(
                        script: 'tia-recommend --db impact_map.db --base origin/main',
                        returnStdout: true
                    ).trim()
                }
            }
        }

        stage('Run Tests') {
            steps {
                script {
                    if (env.AFFECTED) {
                        sh "npm test -- --grep '${env.AFFECTED}'"
                    } else {
                        sh 'npm test'
                    }
                }
            }
        }
    }
}
```

For advanced usage, see the Jenkins shared library in `ci-templates/jenkins-shared-library/`.

### Azure DevOps Server

```yaml
# azure-pipelines.yml
trigger:
  - main

pr:
  - main

variables:
  TIACC_DATABASE: 'impact_map.db'

stages:
  - stage: BuildMapping
    condition: eq(variables['Build.SourceBranch'], 'refs/heads/main')
    jobs:
      - job: Build
        steps:
          - script: npm install -g @tiacc/tools
          - script: npm test -- --coverage
          - script: tia-mapper build -c ./coverage -d $(TIACC_DATABASE)
          - publish: $(TIACC_DATABASE)
            artifact: tiacc-database

  - stage: RecommendTests
    condition: eq(variables['Build.Reason'], 'PullRequest')
    jobs:
      - job: Recommend
        steps:
          - task: DownloadBuildArtifacts@1
            inputs:
              artifactName: tiacc-database
            continueOnError: true
          - script: npm install -g @tiacc/tools
          - script: |
              tia-recommend --db $(TIACC_DATABASE) \
                --base origin/$(System.PullRequest.TargetBranch) \
                > affected-tests.txt
            name: tiacc
```

For Windows agents and classic builds, see PowerShell scripts in `ci-templates/azure-devops-server/`.

## Workflow Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TiaCC CI/CD Workflow                               │
└─────────────────────────────────────────────────────────────────────────────┘

    Nightly/Main Branch                              Pull Request
    ─────────────────                              ──────────────
           │                                              │
           ▼                                              ▼
    ┌─────────────┐                              ┌───────────────┐
    │  Run Tests  │                              │  Git Diff     │
    │  with       │                              │  (changed     │
    │  Coverage   │                              │   files)      │
    └──────┬──────┘                              └───────┬───────┘
           │                                              │
           ▼                                              ▼
    ┌─────────────┐                              ┌───────────────┐
    │  TiaCC      │                              │  TiaCC        │
    │  Build      │◄─────── Database ───────────►│  Recommend    │
    │  Mapping    │         (cached)             │  Tests        │
    └──────┬──────┘                              └───────┬───────┘
           │                                              │
           ▼                                              ▼
    ┌─────────────┐                              ┌───────────────┐
    │  Upload     │                              │  Run Only     │
    │  Database   │                              │  Affected     │
    │  Artifact   │                              │  Tests        │
    └─────────────┘                              └───────────────┘
```

## Configuration Options

### GitHub Action Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `mode` | Operation mode: `build`, `recommend`, or `auto` | `auto` |
| `coverage-dir` | Directory containing coverage files | `./coverage` |
| `database` | Path to the impact map database | `./impact_map.db` |
| `base-branch` | Base branch to compare against | `origin/main` |
| `format` | Coverage format (see below) | `auto` |
| `output-file` | File to write affected tests | `affected-tests.txt` |
| `output-format` | Output format: `text`, `json`, or `github` | `text` |
| `verbose` | Enable verbose output | `false` |

### Supported Coverage Formats

| Format | Description | File Pattern |
|--------|-------------|--------------|
| `auto` | Auto-detect format | - |
| `cobertura` | Cobertura XML | `*.cobertura.xml`, `*coverage*.xml` |
| `lcov` | LCOV/gcov | `*.info`, `lcov.info` |
| `jacoco` | JaCoCo (Java) | `jacoco*.xml` |
| `istanbul` | Istanbul/nyc (JS/TS) | `coverage-final.json` |
| `coveragepy` | coverage.py (Python) | `coverage.json` |
| `dotcover` | dotCover (.NET) | `dotcover*.xml` |
| `opencppcoverage` | OpenCppCoverage (C++) | `CoverageReport*.xml` |
| `luacov` | LuaCov (Lua/LuaUnit) | `luacov*.out` |

## Language-Specific Examples

### JavaScript/TypeScript (Jest)

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - run: npm ci

      # On main branch: run all tests with coverage
      - name: Run all tests (main)
        if: github.ref == 'refs/heads/main'
        run: npm test -- --coverage

      # Build TiaCC mapping from coverage
      - uses: tiacc/action@v1
        if: github.ref == 'refs/heads/main'
        with:
          mode: build
          format: istanbul

      # On PR: run only affected tests
      - uses: tiacc/action@v1
        if: github.event_name == 'pull_request'
        id: tiacc
        with:
          mode: recommend

      - name: Run affected tests (PR)
        if: github.event_name == 'pull_request'
        run: |
          if [ -n "${{ steps.tiacc.outputs.affected-tests }}" ]; then
            npx jest --testPathPattern="${{ steps.tiacc.outputs.affected-tests }}"
          else
            npm test
          fi
```

### Python (pytest)

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - run: pip install -r requirements.txt

      # Main branch: run with coverage
      - name: Run all tests (main)
        if: github.ref == 'refs/heads/main'
        run: pytest --cov --cov-report=json

      - uses: tiacc/action@v1
        if: github.ref == 'refs/heads/main'
        with:
          mode: build
          format: coveragepy

      # PR: run affected tests
      - uses: tiacc/action@v1
        if: github.event_name == 'pull_request'
        id: tiacc
        with:
          mode: recommend

      - name: Run affected tests (PR)
        if: github.event_name == 'pull_request'
        run: |
          if [ -f "affected-tests.txt" ] && [ -s "affected-tests.txt" ]; then
            pytest $(cat affected-tests.txt | tr '\n' ' ')
          else
            pytest
          fi
```

### Java (JUnit + JaCoCo)

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'

      # Main branch: run with coverage
      - name: Run all tests (main)
        if: github.ref == 'refs/heads/main'
        run: ./gradlew test jacocoTestReport

      - uses: tiacc/action@v1
        if: github.ref == 'refs/heads/main'
        with:
          mode: build
          format: jacoco
          coverage-dir: build/reports/jacoco

      # PR: run affected tests
      - uses: tiacc/action@v1
        if: github.event_name == 'pull_request'
        id: tiacc
        with:
          mode: recommend

      - name: Run affected tests (PR)
        if: github.event_name == 'pull_request'
        run: |
          TESTS="${{ steps.tiacc.outputs.affected-tests }}"
          if [ -n "$TESTS" ]; then
            ./gradlew test --tests "$TESTS"
          else
            ./gradlew test
          fi
```

### C/C++ (gcov/lcov)

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      # Main branch: run with coverage
      - name: Build and test (main)
        if: github.ref == 'refs/heads/main'
        run: |
          cmake -B build -DCMAKE_BUILD_TYPE=Debug -DENABLE_COVERAGE=ON
          cmake --build build
          ctest --test-dir build --output-on-failure
          lcov --capture --directory build --output-file coverage.info

      - uses: tiacc/action@v1
        if: github.ref == 'refs/heads/main'
        with:
          mode: build
          format: lcov
          coverage-dir: .

      # PR: run affected tests
      - uses: tiacc/action@v1
        if: github.event_name == 'pull_request'
        id: tiacc
        with:
          mode: recommend

      - name: Run affected tests (PR)
        if: github.event_name == 'pull_request'
        run: |
          cmake -B build
          cmake --build build

          if [ -f "affected-tests.txt" ] && [ -s "affected-tests.txt" ]; then
            ctest --test-dir build -R "$(cat affected-tests.txt | tr '\n' '|' | sed 's/|$//')"
          else
            ctest --test-dir build
          fi
```

### Lua (LuaUnit + LuaCov)

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Install Lua and LuaCov
        run: |
          sudo apt-get update
          sudo apt-get install -y lua5.3 luarocks
          luarocks install luaunit
          luarocks install luacov

      # Main branch: run with coverage
      - name: Run all tests (main)
        if: github.ref == 'refs/heads/main'
        run: |
          lua -lluacov tests/run_all.lua
          luacov

      - uses: tiacc/action@v1
        if: github.ref == 'refs/heads/main'
        with:
          mode: build
          format: luacov
          coverage-dir: .

      # PR: run affected tests
      - uses: tiacc/action@v1
        if: github.event_name == 'pull_request'
        id: tiacc
        with:
          mode: recommend

      - name: Run affected tests (PR)
        if: github.event_name == 'pull_request'
        run: |
          if [ -f "affected-tests.txt" ] && [ -s "affected-tests.txt" ]; then
            # Run specific test files
            for test in $(cat affected-tests.txt); do
              lua "$test"
            done
          else
            lua tests/run_all.lua
          fi
```

## Database Caching Strategies

### GitHub Actions Cache

```yaml
- uses: actions/cache@v4
  with:
    path: impact_map.db
    key: tiacc-${{ runner.os }}-${{ github.sha }}
    restore-keys: |
      tiacc-${{ runner.os }}-
```

### GitLab CI Cache

```yaml
cache:
  key: tiacc-database
  paths:
    - impact_map.db
```

### Azure Pipelines Cache

```yaml
- task: Cache@2
  inputs:
    key: 'tiacc | $(Agent.OS)'
    path: 'impact_map.db'
```

### Jenkins Artifact Cache

```groovy
// Save database after build
archiveArtifacts artifacts: 'impact_map.db', fingerprint: true

// Restore in subsequent builds
copyArtifacts(
    projectName: env.JOB_NAME,
    filter: 'impact_map.db',
    selector: lastSuccessful(),
    optional: true
)
```

### Azure DevOps Server Cache

```yaml
# Using build artifacts (more reliable for on-premises)
- task: PublishBuildArtifacts@1
  inputs:
    PathtoPublish: 'impact_map.db'
    ArtifactName: 'tiacc-database'

# Download in PR builds
- task: DownloadBuildArtifacts@1
  inputs:
    buildType: 'specific'
    project: '$(System.TeamProjectId)'
    pipeline: '$(System.DefinitionId)'
    buildVersionToDownload: 'latestFromBranch'
    branchName: 'refs/heads/main'
    artifactName: 'tiacc-database'
```

## Incremental Updates

TiaCC supports incremental updates to avoid rebuilding the entire mapping database when only some tests have changed.

### How It Works

1. TiaCC tracks which coverage files have been processed and their modification times
2. On subsequent runs, only new or modified coverage files are processed
3. Old mappings for updated tests are automatically replaced

### Usage

```bash
# Incremental update - only process changed coverage files
tia-mapper update -c ./coverage -d impact_map.db

# With specific format
tia-mapper update -c ./coverage --istanbul

# Clean up deleted coverage files
tia-mapper update -c ./coverage --purge

# Verbose output to see what's being processed
tia-mapper update -c ./coverage -v
```

### CI/CD Integration

```yaml
# GitHub Actions - use update instead of build for faster runs
- name: Update TiaCC mapping
  run: tia-mapper update -c ./coverage -d impact_map.db --istanbul

# Only run full build weekly, use update for daily
- name: TiaCC mapping
  run: |
    if [ "${{ github.event.schedule }}" = "0 0 * * 0" ]; then
      tia-mapper build -c ./coverage -d impact_map.db --istanbul
    else
      tia-mapper update -c ./coverage -d impact_map.db --istanbul
    fi
```

### Benefits

- **Faster CI**: Only process changed coverage files instead of all files
- **Less I/O**: Reduced disk and database operations
- **Accurate tracking**: Modified tests automatically update their mappings
- **Cleanup**: `--purge` option removes mappings for deleted tests

## Smart Recommendations (Phase 4)

TiaCC can prioritize tests based on historical data, predicting which tests are most likely to fail and estimating test durations.

### How It Works

1. **Test History Tracking**: Record test execution results (pass/fail, duration)
2. **Failure Correlation**: Track which source file changes correlate with test failures
3. **Priority Scoring**: Combine multiple factors to prioritize tests:
   - Failure probability based on historical correlation (40%)
   - Recent failure rate using exponential moving average (25%)
   - Coverage score of changed files (25%)
   - Duration factor (shorter tests get higher priority) (10%)

### Recording Test Results

Record test results after each CI run to build up historical data:

```bash
# Record a single test result
tia-recommend record -t "TestClass::test_method" --passed --duration 1500

# Record from JUnit XML file
tia-recommend record --from-junit ./test-results.xml --commit abc123

# Record from JSON file
tia-recommend record --from-file ./results.json --changed-files src/main.cpp
```

#### JSON Format

```json
{
  "commitHash": "abc123",
  "changedFiles": ["src/main.cpp", "src/utils.cpp"],
  "results": [
    { "testPath": "TestClass::test_method", "passed": true, "durationMs": 1500 },
    { "testPath": "TestClass::test_other", "passed": false, "durationMs": 2000 }
  ]
}
```

### Using Smart Recommendations

```bash
# Get smart recommendations (sorted by priority)
tia-recommend --smart

# Show failure probability and duration
tia-recommend --smart --show-probability --show-duration

# Get top 10 most important tests
tia-recommend --smart --top 10

# Only show tests with high failure probability
tia-recommend --smart --min-probability 0.5

# Show flaky tests (regardless of current changes)
tia-recommend --flaky --top 20

# View smart statistics
tia-recommend stats
```

### CI/CD Integration

```yaml
# GitHub Actions - with smart recommendations
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Download TiaCC database
        uses: actions/cache@v4
        with:
          path: impact_map.db
          key: tiacc-${{ runner.os }}-${{ github.sha }}
          restore-keys: tiacc-${{ runner.os }}-

      # Get smart recommendations
      - name: Get recommended tests
        run: |
          tia-recommend --smart --top 50 -o affected-tests.txt
          cat affected-tests.txt

      - name: Run prioritized tests
        run: |
          if [ -s affected-tests.txt ]; then
            npm test -- --grep "$(cat affected-tests.txt | tr '\n' '|' | sed 's/|$//')"
          else
            npm test
          fi

      # Record test results for future predictions
      - name: Record test results
        if: always()
        run: |
          tia-recommend record --from-junit ./test-results.xml \
            --commit ${{ github.sha }} \
            --changed-files $(git diff --name-only ${{ github.event.before }}..${{ github.sha }})
```

### Priority Badges

Smart recommendations display priority badges:
- 🔴 **HIGH** (score >= 70): Tests with high failure probability or recent failures
- 🟡 **MEDIUM** (score >= 40): Tests with moderate risk
- 🟢 **LOW** (score < 40): Tests with lower failure probability

### Example Output

```
Smart Test Recommendations (sorted by priority):

  ├─ DatabaseTest::test_connection 🔴 HIGH
  │     Priority Score: 85.2/100
  │     Failure Probability: 72.5%
  │     Estimated Duration: 2.5s
  │     Reasons: High failure correlation (73%), Recent failures (45% rate)

  ├─ UserService::test_create 🟡 MEDIUM
  │     Priority Score: 52.1/100
  │     Reasons: High coverage of changes (80%)

  └─ Utils::test_format 🟢 LOW
        Priority Score: 25.0/100
        Reasons: Covers changed files

============================================================
Summary: 3 tests recommended
Estimated total duration: 5.2s
Priority breakdown: 1 high, 1 medium, 1 low
```

## Best Practices

1. **Nightly Builds**: Run full test suites with coverage collection nightly to keep the mapping database up to date.

2. **Incremental Updates**: Use `tia-mapper update` for faster daily updates instead of full rebuilds.

3. **Fallback Strategy**: Always have a fallback to run all tests if TiaCC cannot determine affected tests.

4. **Coverage Thresholds**: Combine TiaCC with coverage thresholds to ensure PR tests still maintain coverage.

5. **Monorepo Support**: For monorepos, use path-based filtering to only analyze relevant projects.

6. **Record Test Results**: Always record test results (especially failures) to improve smart recommendation accuracy over time.

7. **Use Smart Mode**: Once you have historical data, use `--smart` mode to prioritize tests that are more likely to fail.

8. **Monitor Flaky Tests**: Regularly check `tia-recommend --flaky` to identify and fix unstable tests.

## Troubleshooting

### No Tests Recommended

If TiaCC recommends zero tests but files were changed:
- Verify the database was built with recent coverage data
- Check that file paths in coverage match your source structure
- Use `--verbose` to see mapping details

### Database Not Found

Ensure the database artifact is properly cached/downloaded between runs:
- Check cache key matches across jobs
- Verify artifact upload/download permissions

### Performance Issues

For large codebases:
- Use path filtering to limit analysis scope
- Consider function-level mapping instead of file-level
- Run TiaCC build in a separate job with longer timeout
