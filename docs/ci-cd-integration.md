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

## Best Practices

1. **Nightly Builds**: Run full test suites with coverage collection nightly to keep the mapping database up to date.

2. **Incremental Updates**: Consider updating the database on each main branch push for more accurate mappings.

3. **Fallback Strategy**: Always have a fallback to run all tests if TiaCC cannot determine affected tests.

4. **Coverage Thresholds**: Combine TiaCC with coverage thresholds to ensure PR tests still maintain coverage.

5. **Monorepo Support**: For monorepos, use path-based filtering to only analyze relevant projects.

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
