# TiaCC .NET Tools

.NET 10 implementation of TiaCC (Test Impact Analysis for C/C++) including CLI tool and web dashboard.

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
├── TiaCC.Cli/             # CLI application
│   └── Program.cs         # Command definitions
└── TiaCC.Dashboard/       # Blazor WebAssembly dashboard
    ├── Pages/             # Razor pages
    ├── Components/        # Reusable components
    ├── Services/          # Data services
    └── wwwroot/           # Static assets
```

## Dashboard

The dashboard is a Blazor WebAssembly application that provides interactive coverage visualization.

### Features

- **Overview**: Module-level coverage statistics with expandable file details
- **Treemap**: Hierarchical coverage visualization with drill-down navigation
- **File Explorer**: Browse files in a tree structure with coverage indicators
- **Search**: Find files by name or path with coverage details

### Run Dashboard

```bash
cd TiaCC.Dashboard
dotnet run
```

Then open http://localhost:5000 in your browser.

### Deploy as Static Site

```bash
dotnet publish TiaCC.Dashboard -c Release -o ./publish
# Copy publish/wwwroot/* to any static hosting (GitHub Pages, Netlify, etc.)
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
- Coverage formats:
  - LLVM (profraw, profdata, JSON export)
  - Coverlet JSON
  - Cobertura XML
  - LCOV
  - JaCoCo XML
  - Istanbul/NYC JSON
  - coverage.py JSON
  - dotCover JSON
  - LuaCov
