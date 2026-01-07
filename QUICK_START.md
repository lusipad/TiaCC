# TiaCC Quick Start

[English](QUICK_START.md) | [简体中文](QUICK_START.zh.md)

> Integrate TiaCC in ~5 minutes (test impact analysis based on coverage).

## Install

```bash
# Make sure .NET 10 SDK is installed (see global.json)
dotnet --version

# Clone repo
git clone https://github.com/lusipad/TiaCC.git
cd TiaCC

# Build
dotnet build src/TiaCC.DotNet.sln -c Release
```

---

## Quick Start: 3 steps

### Step 1: Generate coverage

**.NET / C#**

```bash
dotnet test --collect:"XPlat Code Coverage" --results-directory ./coverage
```

**C++ (Clang + LLVM coverage)**

```bash
# Build with coverage enabled
clang++ -fprofile-instr-generate -fcoverage-mapping -o myapp src/*.cpp

# Run tests; each test writes a .profraw
LLVM_PROFILE_FILE="coverage/%m_%p.profraw" ./myapp --run-tests

# Convert to JSON (.cov.json)
llvm-profdata merge coverage/*.profraw -o coverage/merged.profdata
llvm-cov export ./myapp -instr-profile=coverage/merged.profdata > coverage/data.cov.json
```

### Step 2: Build the mapping database

If you installed the global tool, use `tia-mapper` directly. If you run from source, prefix with `dotnet run --project ... --`.

```bash
# Initialize database
tia-mapper init --db impact_map.db

# Add mappings from coverage
tia-mapper map \
  --db impact_map.db \
  --coverage ./coverage/**/coverage.cobertura.xml \
  --test MyTestClass
```

### Step 3: Query affected tests

```bash
# Query which tests cover these files
tia-mapper query --db impact_map.db --files src/MyService.cs

# View stats
tia-mapper stats --db impact_map.db
```

---

## CI/CD example

### GitHub Actions (PR)

```yaml
name: Smart Test
on: [pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          global-json-file: global.json

      - name: Get affected tests
        run: |
          CHANGED_FILES=$(git diff --name-only origin/main)
          dotnet run --project src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj -- query \
            --db impact_map.db \
            --files $CHANGED_FILES \
            > affected_tests.txt

      - name: Run affected tests
        run: |
          FILTER=$(cat affected_tests.txt | tr '\n' '|' | sed 's/|$//')
          dotnet test --filter "FullyQualifiedName~$FILTER"
```

---

## Command cheat sheet

| Command | Description |
|--------|-------------|
| `tia-mapper init` | Initialize database |
| `tia-mapper map` | Add mappings from coverage |
| `tia-mapper query` | Query tests by files |
| `tia-mapper recommend` | Recommend tests from git changes |
| `tia-mapper export` | Export JSON for the Dashboard |

---

## Next steps

- [Architecture](docs/architecture.md)
- [Integration guide](docs/integration-guide.md)
- [Dashboard](docs/dashboard.md)
- [E2E examples](tests/e2e/README.md)

---

## Help

```bash
tia-mapper --help
```

Questions? Please open an [Issue](https://github.com/lusipad/TiaCC/issues).
