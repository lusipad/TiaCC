# TiaCC Azure DevOps Server Integration

[English](README.md) | [简体中文](README.zh.md)

This directory contains templates and scripts for integrating TiaCC with Azure DevOps Server (formerly TFS).

## Files

| File | Description |
|------|-------------|
| `tiacc-pipeline.yml` | YAML pipeline template for Azure DevOps Server 2019+ |
| `tiacc-build.ps1` | PowerShell script for building impact mapping |
| `tiacc-recommend.ps1` | PowerShell script for recommending affected tests |

## Prerequisites

- Azure DevOps Server 2019 or later
- Git installed on build agents
- `tia-mapper` available on build agents (recommended: download a self-contained release binary or install the .NET global tool `TiaCC.Cli`)

## Quick Start (YAML Pipeline)

1. Copy `tiacc-pipeline.yml` to your repository
2. Create a new pipeline pointing to this file
3. Customize the test commands in the pipeline

```yaml
# azure-pipelines.yml
trigger:
  - main

pr:
  - main

# Include the TiaCC template
resources:
  repositories:
    - repository: tiacc
      type: git
      name: YourProject/TiaCC

extends:
  template: ci-templates/azure-devops-server/tiacc-pipeline.yml@tiacc
```

## Quick Start (Classic Build)

### Step 1: Install TiaCC

Add a **Command Line** task:
```bash
dotnet tool install --global TiaCC.Cli
```

### Step 2: Build Mapping (Main Branch)

Add a **PowerShell** task pointing to `tiacc-build.ps1`:
```powershell
.\tiacc-build.ps1 -CoverageDir "./coverage" -Format "auto"
```

### Step 3: Recommend Tests (Pull Requests)

Add a **PowerShell** task pointing to `tiacc-recommend.ps1`:
```powershell
.\tiacc-recommend.ps1 -Database "impact_map.db"
```

### Step 4: Run Tests

Add a **PowerShell** or **Command Line** task:

Use your test framework’s filtering mechanism to run only the recommended tests (from `TIACC_AFFECTED_TESTS`).

## Variables

### Input Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TIACC_DATABASE` | Path to impact map database | `impact_map.db` |
| `TIACC_COVERAGE_DIR` | Directory containing coverage files | `./coverage` |
| `TIACC_FORMAT` | Coverage format | `auto` |
| `TIACC_VERBOSE` | Enable verbose output | `false` |

### Output Variables

| Variable | Description |
|----------|-------------|
| `TIACC_AFFECTED_TESTS` | Comma-separated list of affected tests |
| `TIACC_RUN_ALL` | `true` if all tests should run |
| `TIACC_AFFECTED_COUNT` | Number of affected tests |

## Database Caching

### Using Build Artifacts

The YAML template automatically publishes the database as a build artifact and downloads it in PR builds.

### Using Pipeline Caching

For faster builds, use the Cache@2 task:

```yaml
- task: Cache@2
  inputs:
    key: 'tiacc-db | $(Agent.OS)'
    path: 'impact_map.db'
```

## On-Premises Considerations

### Self-hosted agents

Ensure your agents have:

- Git with credential access (`git --version`)
- Permissions to write to the working directory
- `tia-mapper` available (either from a mirrored release binary, or via `dotnet tool install`)

### Network restrictions

If agents have limited internet access, mirror the release artifacts (or `.nupkg`) in your internal artifact store and fetch from there.

## Troubleshooting

### Database Not Found

- Ensure the build that creates the database completed successfully
- Check artifact retention policies
- Verify artifact names match between publish and download tasks

### Test Filter Not Working

- Verify `TIACC_AFFECTED_TESTS` variable is set correctly
- Check your test framework's filter syntax
- Enable verbose mode for debugging

### Agent Issues

```powershell
# Check Git
git --version

# Check TiaCC installation
tia-mapper --version
```
