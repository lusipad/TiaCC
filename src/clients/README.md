# TiaCC Test Framework Hooks

[English](README.md) | [简体中文](README.zh.md)

This directory contains test framework hook implementations for multiple programming languages. These hooks enable TiaCC to collect coverage data during test execution.

## Overview

Hooks are code snippets that you integrate into your test framework (pytest, go test, etc.) to capture which code is executed during each test. This data is used by TiaCC to build the test-to-code impact mapping.

## Available Hooks

| Language | File | Test Frameworks |
|----------|------|-----------------|
| **C#/.NET** | `TiaHooks.cs` | xUnit, NUnit, MSTest |
| **Python** | `tia_hooks.py` | pytest, unittest |
| **Go** | `tia_hooks.go` | go test |
| **Lua** | `tia_hooks.lua` | busted, luaunit |

## How to Use

### 1. Choose Your Hook File

Select the hook file that matches your programming language.

### 2. Integrate with Your Test Framework

Each hook file contains detailed integration instructions in the comments at the top of the file.

**Example for C#/xUnit:**

```csharp
// In your test project
using TiaCC.Hooks;

public class MyTests : IDisposable
{
    private readonly TiaHooks _hooks;

    public MyTests()
    {
        _hooks = new TiaHooks();
        _hooks.BeforeTest(nameof(MyTests));
    }

    public void Dispose()
    {
        _hooks.AfterTest(nameof(MyTests));
    }

    [Fact]
    public void MyTest()
    {
        // Your test code
    }
}
```

### 3. Configure Coverage Output

The hooks will generate coverage data files that TiaCC uses to build the impact mapping. Make sure to configure the output directory in your TiaCC configuration file (`tia_config.json`).

## How Hooks Work

1. **Before Each Test**: Hook records the test name and starts coverage collection
2. **During Test Execution**: Framework's native coverage collector tracks executed code
3. **After Each Test**: Hook saves coverage data with test name mapping
4. **TiaCC Processing**: TiaCC reads coverage files to build test-to-code relationships

## Customization

Each hook file can be customized for your specific needs:

- **Coverage output path**: Change where coverage files are saved
- **Coverage format**: Adjust to match your coverage tool (lcov, cobertura, etc.)
- **Test name formatting**: Modify how test names are captured and stored
- **Filtering**: Add logic to exclude certain files or paths

## Documentation

For detailed integration guides and examples:

- [Integration Guide](../docs/integration-guide.md)
- [Language-Specific Examples](../docs/language-specific-examples.md)
- [CI/CD Integration](../docs/ci-cd-integration.md)

## Tips

- **Copy, don't symlink**: Copy the hook file into your project for easier customization
- **Version control**: Commit the hook file with your project
- **Test the hooks**: Run a few tests manually to verify coverage is being captured
- **Check output**: Ensure coverage files are created in the expected location

## Troubleshooting

**Coverage files not being created?**
- Verify the output directory exists and is writable
- Check that the hook functions are actually being called
- Ensure your test framework's coverage tool is enabled

**TiaCC can't find test mappings?**
- Confirm the coverage file format matches what TiaCC expects
- Check that test names in coverage files match your test file structure
- Verify the path mappings in `tia_config.json`

## Contributing

Found a bug or want to add support for a new test framework? See [CONTRIBUTING.md](../CONTRIBUTING.md).
