# TiaCC .NET CLI Tool

.NET 10 implementation of the TiaCC (Test Impact Analysis for C/C++) command-line tool.

## Requirements

- .NET 10 SDK (Preview)
- SQLite (bundled via EF Core)

## Build

```bash
cd tools-dotnet
dotnet build
```

## Install as Global Tool

```bash
dotnet pack TiaCC.Cli/TiaCC.Cli.csproj
dotnet tool install --global --add-source ./TiaCC.Cli/nupkg TiaCC.Cli
```

## Commands

### Initialize Database

```bash
tia-mapper init --db impact_map.db
```

### Scan Source Files

```bash
tia-mapper scan --db impact_map.db --dir ./src --pattern "*.cpp" "*.h"
```

### Map Coverage Data

```bash
# LLVM JSON format
tia-mapper map --db impact_map.db --coverage coverage.json --test test_unit --base-dir .

# Cobertura XML format
tia-mapper map --db impact_map.db --coverage coverage.xml --test test_integration

# LCOV format
tia-mapper map --db impact_map.db --coverage coverage.info --test test_e2e
```

### Export for Dashboard

```bash
tia-mapper export --db impact_map.db --output ./dashboard/data
```

### Query Affected Tests

```bash
tia-mapper query --db impact_map.db --files src/calculator.cpp src/utils.cpp
```

### Show Statistics

```bash
tia-mapper stats --db impact_map.db
```

## Project Structure

```
tools-dotnet/
├── TiaCC.sln              # Solution file
├── global.json            # .NET SDK version
├── TiaCC.Core/            # Core library
│   ├── Data/              # EF Core DbContext
│   ├── Models/            # Entity models
│   └── Services/          # Business logic
└── TiaCC.Cli/             # CLI application
    └── Program.cs         # Command definitions
```

## Database Schema

The tool uses SQLite with the following tables:

- `source_files` - Tracked source files
- `test_scripts` - Test executables/scripts
- `coverage_map` - Source file ↔ Test mappings with coverage %
- `symbols` - Functions/methods extracted from source
- `symbol_coverage` - Symbol ↔ Test mappings with coverage %

## Compatibility

This .NET implementation is compatible with:

- Existing `impact_map.db` databases created by the Node.js version
- Dashboard JSON export format (same structure)
- Coverage formats: LLVM JSON, Cobertura XML, LCOV
