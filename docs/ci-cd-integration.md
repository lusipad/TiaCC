# TiaCC CI/CD Integration Guide

> This guide focuses on integrating TiaCC into various CI/CD platforms.
>
> 📖 For general TiaCC integration (coverage collection, mapping setup), see: [Integration Guide](integration-guide.md)

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

      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      - name: Build TiaCC
        run: dotnet build src/TiaCC.DotNet.sln -c Release

      - name: Download impact map
        uses: dawidd6/action-download-artifact@v3
        continue-on-error: true
        with:
          workflow: nightly.yml
          name: impact-map

      - name: Get affected tests
        id: tiacc
        run: |
          if [ -f impact_map.db ]; then
            CHANGED=$(git diff --name-only origin/main)
            AFFECTED=$(dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- query \
              --db impact_map.db --files $CHANGED 2>/dev/null || echo "")
            echo "affected=$AFFECTED" >> $GITHUB_OUTPUT
          fi

      - name: Run tests
        run: |
          if [ -n "${{ steps.tiacc.outputs.affected }}" ]; then
            # Run only affected tests
            dotnet test --filter "FullyQualifiedName~${{ steps.tiacc.outputs.affected }}"
          else
            dotnet test
          fi
```

### GitLab CI

```yaml
stages:
  - build
  - analyze
  - test

variables:
  TIACC_DATABASE: impact_map.db

build-mapping:
  stage: build
  only:
    - main
  script:
    - dotnet build src/TiaCC.DotNet.sln -c Release
    - dotnet test --collect:"XPlat Code Coverage" --results-directory ./coverage
    - dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- init --db $TIACC_DATABASE
    - dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- map --db $TIACC_DATABASE --coverage ./coverage/*/coverage.cobertura.xml --test AllTests
  artifacts:
    paths:
      - $TIACC_DATABASE
    expire_in: 30 days

smart-test:
  stage: test
  only:
    - merge_requests
  script:
    - dotnet build src/TiaCC.DotNet.sln -c Release
    - CHANGED=$(git diff --name-only origin/main)
    - AFFECTED=$(dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- query --db $TIACC_DATABASE --files $CHANGED || echo "")
    - |
      if [ -n "$AFFECTED" ]; then
        FILTER=$(echo "$AFFECTED" | tr '\n' '|' | sed 's/|$//')
        dotnet test --filter "FullyQualifiedName~$FILTER"
      else
        dotnet test
      fi
```

### Jenkins

```groovy
// Jenkinsfile
pipeline {
    agent any

    environment {
        TIACC_DATABASE = 'impact_map.db'
    }

    stages {
        stage('Setup') {
            steps {
                sh 'dotnet build src/TiaCC.DotNet.sln -c Release'
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
                sh 'dotnet test --collect:"XPlat Code Coverage" --results-directory ./coverage'
                sh '''
                    dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- init --db ${TIACC_DATABASE}
                    dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- map \
                        --db ${TIACC_DATABASE} \
                        --coverage ./coverage/*/coverage.cobertura.xml \
                        --test AllTests
                '''
                archiveArtifacts artifacts: 'impact_map.db'
            }
        }

        stage('Recommend Tests') {
            when { changeRequest() }
            steps {
                script {
                    def changed = sh(script: 'git diff --name-only origin/main', returnStdout: true).trim()
                    env.AFFECTED = sh(
                        script: "dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- query --db ${TIACC_DATABASE} --files ${changed}",
                        returnStdout: true
                    ).trim()
                }
            }
        }

        stage('Run Tests') {
            steps {
                script {
                    if (env.AFFECTED) {
                        def filter = env.AFFECTED.split('\n').join('|')
                        sh "dotnet test --filter 'FullyQualifiedName~${filter}'"
                    } else {
                        sh 'dotnet test'
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
          - task: UseDotNet@2
            inputs:
              version: '8.0.x'
          - script: dotnet build src/TiaCC.DotNet.sln -c Release
          - script: dotnet test --collect:"XPlat Code Coverage" --results-directory ./coverage
          - script: |
              dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- init --db $(TIACC_DATABASE)
              dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- map \
                --db $(TIACC_DATABASE) \
                --coverage ./coverage/*/coverage.cobertura.xml \
                --test AllTests
          - publish: $(TIACC_DATABASE)
            artifact: tiacc-database

  - stage: RecommendTests
    condition: eq(variables['Build.Reason'], 'PullRequest')
    jobs:
      - job: Recommend
        steps:
          - task: UseDotNet@2
            inputs:
              version: '8.0.x'
          - task: DownloadBuildArtifacts@1
            inputs:
              artifactName: tiacc-database
            continueOnError: true
          - script: dotnet build src/TiaCC.DotNet.sln -c Release
          - script: |
              CHANGED=$(git diff --name-only origin/$(System.PullRequest.TargetBranch))
              dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- query \
                --db $(TIACC_DATABASE) \
                --files $CHANGED \
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
    │  Build      │◄─────── Database ───────────►│  Query        │
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

## TiaCC CLI Commands

### init

Initialize a new impact mapping database:

```bash
dotnet run --project TiaCC.Cli -- init --db impact_map.db
```

### map

Map coverage data to tests:

```bash
dotnet run --project TiaCC.Cli -- map \
  --db impact_map.db \
  --coverage ./coverage/*.cobertura.xml \
  --test TestClassName \
  [--base-dir .]
```

### query

Query affected tests for changed files:

```bash
dotnet run --project TiaCC.Cli -- query \
  --db impact_map.db \
  --files src/Calculator.cs src/Utils.cs
```

### stats

Show database statistics:

```bash
dotnet run --project TiaCC.Cli -- stats --db impact_map.db
```

### export

Export data for Dashboard visualization:

```bash
dotnet run --project TiaCC.Cli -- export \
  --db impact_map.db \
  --output src/dashboard/dotnet/TiaCC.Dashboard/wwwroot/data
```

## Supported Coverage Formats

| Format | Description | File Pattern |
|--------|-------------|--------------|
| `cobertura` | Cobertura XML | `*.cobertura.xml`, `*coverage*.xml` |
| `lcov` | LCOV/gcov | `*.info`, `lcov.info` |
| `jacoco` | JaCoCo (Java) | `jacoco*.xml` |
| `coveragepy` | coverage.py (Python) | `coverage.json` |
| `dotcover` | dotCover (.NET) | `dotcover*.xml` |
| `opencppcoverage` | OpenCppCoverage (C++) | `CoverageReport*.xml` |
| `luacov` | LuaCov (Lua/LuaUnit) | `luacov*.out` |

## Language-Specific Examples

### C#/.NET

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

      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      # On main branch: run all tests with coverage
      - name: Run all tests (main)
        if: github.ref == 'refs/heads/main'
        run: dotnet test --collect:"XPlat Code Coverage" --results-directory ./coverage

      # Build TiaCC mapping from coverage
      - name: Build TiaCC mapping
        if: github.ref == 'refs/heads/main'
        run: |
          dotnet build src/TiaCC.DotNet.sln -c Release
          dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- init --db impact_map.db
          dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- map \
            --db impact_map.db \
            --coverage ./coverage/*/coverage.cobertura.xml \
            --test AllTests

      # On PR: run only affected tests
      - name: Get affected tests (PR)
        if: github.event_name == 'pull_request'
        id: tiacc
        run: |
          dotnet build src/TiaCC.DotNet.sln -c Release
          CHANGED=$(git diff --name-only origin/main)
          AFFECTED=$(dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- query \
            --db impact_map.db --files $CHANGED 2>/dev/null || echo "")
          echo "filter=$AFFECTED" >> $GITHUB_OUTPUT

      - name: Run affected tests (PR)
        if: github.event_name == 'pull_request'
        run: |
          if [ -n "${{ steps.tiacc.outputs.filter }}" ]; then
            dotnet test --filter "FullyQualifiedName~${{ steps.tiacc.outputs.filter }}"
          else
            dotnet test
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

      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      # Main branch: run with coverage
      - name: Build and test (main)
        if: github.ref == 'refs/heads/main'
        run: |
          cmake -B build -DCMAKE_BUILD_TYPE=Debug -DENABLE_COVERAGE=ON
          cmake --build build
          ctest --test-dir build --output-on-failure
          lcov --capture --directory build --output-file coverage.info

      - name: Build TiaCC mapping
        if: github.ref == 'refs/heads/main'
        run: |
          dotnet build src/TiaCC.DotNet.sln -c Release
          dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- init --db impact_map.db
          # Note: LCOV support via Cobertura conversion
          lcov_cobertura coverage.info -o coverage.cobertura.xml
          dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- map \
            --db impact_map.db --coverage coverage.cobertura.xml --test AllTests

      # PR: run affected tests
      - name: Run affected tests (PR)
        if: github.event_name == 'pull_request'
        run: |
          cmake -B build
          cmake --build build

          CHANGED=$(git diff --name-only origin/main)
          AFFECTED=$(dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- query \
            --db impact_map.db --files $CHANGED 2>/dev/null || echo "")

          if [ -n "$AFFECTED" ]; then
            ctest --test-dir build -R "$(echo $AFFECTED | tr '\n' '|' | sed 's/|$//')"
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

## Best Practices

1. **Nightly Builds**: Run full test suites with coverage collection nightly to keep the mapping database up to date.

2. **Fallback Strategy**: Always have a fallback to run all tests if TiaCC cannot determine affected tests.

3. **Coverage Thresholds**: Combine TiaCC with coverage thresholds to ensure PR tests still maintain coverage.

4. **Monorepo Support**: For monorepos, use path-based filtering to only analyze relevant projects.

## Troubleshooting

### No Tests Recommended

If TiaCC recommends zero tests but files were changed:
- Verify the database was built with recent coverage data
- Check that file paths in coverage match your source structure
- Use `stats` command to see database contents

### Database Not Found

Ensure the database artifact is properly cached/downloaded between runs:
- Check cache key matches across jobs
- Verify artifact upload/download permissions

### Performance Issues

For large codebases:
- Use path filtering to limit analysis scope
- Consider function-level mapping instead of file-level
- Run TiaCC build in a separate job with longer timeout
