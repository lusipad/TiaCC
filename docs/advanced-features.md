# TiaCC Advanced Features

[English](advanced-features.md) | [简体中文](advanced-features.zh.md)

This document summarizes advanced ideas supported by (or planned for) TiaCC. The Chinese version contains extended discussion and examples: `docs/advanced-features.zh.md`.

## Smart recommendation

Beyond “which tests are affected”, TiaCC can help prioritize execution order by combining:

- Coverage impact
- Historical failures (if available)
- Estimated duration (if available)

## Flaky test analysis (optional)

If you collect historical test results, you can surface:

- Unstable tests (flaky)
- High-risk tests (frequent failures)
- Trends over time

## Function-level mapping (where available)

When coverage data includes symbol/function info, you can do more precise mapping than file-level.

## Notes

Exact behavior depends on coverage format and the data you provide.
