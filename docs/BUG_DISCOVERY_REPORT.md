# TiaCC Bug Discovery Report

[English](BUG_DISCOVERY_REPORT.md) | [简体中文](BUG_DISCOVERY_REPORT.zh.md)

## Summary

Through systematic boundary testing, we identified multiple potential issues in the TiaCC project. These tests focus on finding real bugs rather than just increasing coverage numbers.

## Bugs found

### 1. DatabaseService: NaN values cause database exception (High)

- **Location**: `DatabaseService.UpsertCoverageMapAsync`
- **Issue**: when passing `double.NaN` as coverage, SQLite throws `DbUpdateException`
- **Error**: `Cannot store 'NaN' values`
- **Suggested fix**: validate inputs in the service layer

```csharp
if (double.IsNaN(coverage) || double.IsInfinity(coverage))
{
    throw new ArgumentException("Coverage must be a valid number", nameof(coverage));
}
```
