# TiaCC.Coverlet.Collector

> Per-test coverage collection for .NET Test Impact Analysis

## Overview

This package provides a VSTest Data Collector that works with Coverlet to collect coverage data per test method. This enables TiaCC to build accurate test-to-code mappings.

## Installation

```bash
dotnet add package TiaCC.Coverlet.Collector
```

Or add to your test project's `.csproj`:

```xml
<PackageReference Include="TiaCC.Coverlet.Collector" Version="1.0.0" />
```

## Usage

### Basic Usage

```bash
# Run tests with TiaCC coverage collection
dotnet test --collect:"TiaCC Coverage"

# Coverage files are written to .tiacc/coverage/
```

### With Custom Output Directory

Create a `.runsettings` file:

```xml
<?xml version="1.0" encoding="utf-8"?>
<RunSettings>
  <DataCollectionRunSettings>
    <DataCollectors>
      <DataCollector friendlyName="TiaCC Coverage">
        <Configuration>
          <OutputDirectory>.tiacc/coverage</OutputDirectory>
        </Configuration>
      </DataCollector>
    </DataCollectors>
  </DataCollectionRunSettings>
</RunSettings>
```

Then run:

```bash
dotnet test --settings:test.runsettings
```

## How It Works

1. **Test Start**: When a test method starts, the collector records the test's fully qualified name
2. **Coverage Tracking**: Coverlet collects code coverage during test execution
3. **Test End**: When the test completes, a marker file is created with test metadata
4. **Post-Processing**: Use `tiacc build` to process the coverage data and build mappings

## Output Format

The collector creates files in the output directory:

```
.tiacc/coverage/
├── MyNamespace__MyClass__TestMethod1.marker
├── MyNamespace__MyClass__TestMethod2.marker
├── coverage.json           # Coverlet output (all tests combined)
└── _session_summary.json   # Session metadata
```

## Integration with TiaCC

After running tests:

```bash
# Build the mapping database
tiacc build

# Get affected tests for your changes
tiacc recommend --branch origin/main
```

## Requirements

- .NET 6.0 or later (for test projects)
- .NET Standard 2.0 compatible (the collector itself)
- Coverlet 6.0.0 or later

## Known Limitations

- **Current Version**: This is an initial implementation that creates marker files for each test. Full per-test coverage splitting requires additional post-processing.
- **xUnit/NUnit/MSTest**: Works with all major .NET test frameworks
- **Parallel Tests**: Test markers are thread-safe, but coverage data may need merging

## Future Improvements

- [ ] Direct integration with Coverlet's per-test mode
- [ ] Automatic coverage splitting without markers
- [ ] Real-time coverage streaming to TiaCC service

## License

MIT
