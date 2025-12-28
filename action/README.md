# TiaCC GitHub Action

Official GitHub Action for integrating TiaCC (Test Impact Analysis for Code Coverage) into your CI/CD pipeline.

## 🎯 What It Does

This action automatically identifies which tests are affected by your code changes, allowing you to:

- ⚡ **Reduce CI time** by running only affected tests
- 🎯 **Improve feedback speed** with faster test cycles
- 💰 **Save CI costs** by minimizing unnecessary test execution
- ✅ **Maintain confidence** with intelligent test selection

## 🚀 Quick Start

### Basic Usage

```yaml
name: CI

on: [pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Required for git comparison

      - name: Run tests with coverage
        run: npm test -- --coverage

      - name: Analyze test impact
        uses: ./action  # or your-org/tiacc-action@v1
        id: tiacc
        with:
          mode: auto
          coverage-dir: ./coverage

      - name: Run affected tests
        if: steps.tiacc.outputs.has-affected-tests == 'true'
        run: |
          npm test ${{ steps.tiacc.outputs.affected-tests }}
```

## 📋 Modes

### `auto` (Default)
Automatically builds mapping database and recommends affected tests.

```yaml
- uses: ./action
  with:
    mode: auto
```

### `build`
Only builds the test-to-code impact mapping database.

```yaml
- uses: ./action
  with:
    mode: build
    coverage-dir: ./coverage
    database: ./impact_map.db
```

### `recommend`
Recommends affected tests based on existing database.

```yaml
- uses: ./action
  with:
    mode: recommend
    database: ./impact_map.db
    base-branch: origin/main
```

## ⚙️ Configuration

### Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `mode` | Operation mode: `build`, `recommend`, or `auto` | `auto` |
| `coverage-dir` | Directory containing coverage files | `./coverage` |
| `database` | Path to the impact map database | `./impact_map.db` |
| `base-branch` | Base branch to compare against | `origin/main` |
| `base-commit` | Base commit (overrides base-branch) | `''` |
| `format` | Coverage format (auto-detected if not specified) | `auto` |
| `output-file` | File to write affected tests | `affected-tests.txt` |
| `output-format` | Output format: `text`, `json`, or `github` | `text` |
| `base-path` | Base path to strip from file paths | `''` |
| `test-id-from-filename` | Parse test ID from filename | `false` |
| `verbose` | Enable verbose logging | `false` |
| `fail-on-no-tests` | Fail if no affected tests found | `false` |
| `upload-artifact` | Upload database as artifact | `true` |
| `download-artifact` | Download database from previous runs | `true` |
| `artifact-name` | Artifact name for database caching | `tiacc-database` |

### Outputs

| Output | Description |
|--------|-------------|
| `affected-tests` | Newline-separated list of affected tests |
| `affected-count` | Number of affected tests |
| `changed-files` | List of changed files |
| `changed-count` | Number of changed files |
| `coverage-rate` | Percentage of changed files with test coverage |
| `has-affected-tests` | `true` if there are affected tests |

## 📖 Usage Examples

### Example 1: Pull Request Comments

Automatically post affected tests as PR comments:

```yaml
- name: Analyze test impact
  uses: ./action
  id: tiacc
  with:
    mode: auto
    output-format: github

- name: Comment PR
  uses: actions/github-script@v7
  if: github.event_name == 'pull_request'
  with:
    script: |
      const output = `
      ## 🎯 Test Impact Analysis

      **Changed Files:** ${{ steps.tiacc.outputs.changed-count }}
      **Affected Tests:** ${{ steps.tiacc.outputs.affected-count }}
      **Coverage Rate:** ${{ steps.tiacc.outputs.coverage-rate }}%

      ### Tests to Run:
      \`\`\`
      ${{ steps.tiacc.outputs.affected-tests }}
      \`\`\`
      `;

      github.rest.issues.createComment({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: output
      });
```

### Example 2: Matrix Testing

Run only affected tests across multiple environments:

```yaml
jobs:
  analyze:
    runs-on: ubuntu-latest
    outputs:
      affected-tests: ${{ steps.tiacc.outputs.affected-tests }}
      has-tests: ${{ steps.tiacc.outputs.has-affected-tests }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Analyze
        id: tiacc
        uses: ./action
        with:
          mode: recommend

  test:
    needs: analyze
    if: needs.analyze.outputs.has-tests == 'true'
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node: [16, 18, 20]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node }}

      - name: Run affected tests
        run: npm test ${{ needs.analyze.outputs.affected-tests }}
```

### Example 3: Database Caching

Cache the impact database across workflow runs:

```yaml
- name: Build mapping
  uses: ./action
  with:
    mode: build
    coverage-dir: ./coverage
    upload-artifact: true
    artifact-name: my-impact-db

- name: Recommend tests (later job)
  uses: ./action
  with:
    mode: recommend
    download-artifact: true
    artifact-name: my-impact-db
```

### Example 4: Multiple Coverage Formats

Handle different coverage formats:

```yaml
- name: Analyze C++ Coverage
  uses: ./action
  with:
    coverage-dir: ./build/coverage
    format: opencppcoverage

- name: Analyze Python Coverage
  uses: ./action
  with:
    coverage-dir: ./htmlcov
    format: coveragepy
```

## 🔧 Supported Coverage Formats

- **JavaScript/TypeScript**: Istanbul, LCOV
- **Python**: Coverage.py
- **Java**: JaCoCo, Cobertura
- **.NET**: dotCover, OpenCover
- **C++**: OpenCppCoverage, LCOV

## 📚 Documentation

- [Main Documentation](../docs/)
- [CI/CD Integration Guide](../docs/ci-cd-integration.md)
- [Integration Guide](../docs/integration-guide.md)
- [Quick Start](../QUICK_START.md)

## 💡 Tips

1. **Use `fetch-depth: 0`** in `actions/checkout` for accurate git comparisons
2. **Enable artifact caching** to speed up subsequent runs
3. **Set `fail-on-no-tests: true`** to catch mapping issues early
4. **Use `verbose: true`** for debugging configuration issues

## 🐛 Troubleshooting

**No affected tests found?**
- Ensure coverage files are being generated
- Check that the `coverage-dir` path is correct
- Verify the coverage format is supported
- Use `verbose: true` to see detailed logs

**Database not persisting?**
- Confirm `upload-artifact: true` is set
- Check artifact permissions in workflow settings
- Ensure the `database` path is consistent across jobs

**Wrong tests recommended?**
- Rebuild the mapping database with latest coverage
- Verify test hooks are correctly integrated
- Check that file paths in coverage match your project structure

## 🤝 Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for development guidelines.
