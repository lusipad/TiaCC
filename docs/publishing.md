# TiaCC Publishing Guide

[English](publishing.md) | [简体中文](publishing.zh.md)

This document describes how to publish TiaCC using GitHub Actions.

## Release methods

TiaCC supports two release methods:

### 1) Tag-based publish (recommended)

Pushing a version tag triggers the publish workflow automatically:

```bash
# 1) Ensure code is committed
git add .
git commit -m "Release v1.0.1"

# 2) Create a tag
git tag v1.0.1

# 3) Push the tag
git push origin v1.0.1
```

### 2) Manual publish

In your GitHub repository:

1. Go to **Actions**
2. Select **Publish TiaCC**
3. Click **Run workflow**
4. Enter a version (e.g. `1.0.1`)
5. Click **Run workflow**

## What the workflow does

The publish workflow runs:

1. **Test and Pack NuGet**: build, test, pack `.nupkg`
2. **Build executables**: self-contained single-file binaries for multiple runtimes
3. **Publish**: push packages to NuGet and create a GitHub Release

## NuGet.org (optional)

To publish to NuGet.org, add a repository secret:

- Name: `NUGET_API_KEY`
- Value: your NuGet.org API key

If it is not configured, the workflow will skip NuGet.org publishing, but still publishes to GitHub Packages and creates a GitHub Release.

## GitHub Packages

GitHub Packages publish uses `GITHUB_TOKEN` automatically; no extra configuration is required.

## Install published artifacts

### Option 1: Self-contained executables (recommended)

Download from: `https://github.com/lusipad/TiaCC/releases`

### Option 2: .NET global tool

From NuGet.org:

```bash
dotnet tool install --global TiaCC.Cli
```

From GitHub Packages:

```bash
dotnet tool install --global TiaCC.Cli \
  --add-source https://nuget.pkg.github.com/lusipad/index.json
```

## Notes

Published executables are:

- Self-contained (no .NET runtime required)
- Single-file
- `PublishTrimmed` is disabled by default to avoid trimming-related runtime issues
