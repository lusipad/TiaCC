# TiaCC TypeScript Integration Example

This example demonstrates how to integrate TiaCC programmatically into a TypeScript/Node.js project.

## Setup

```bash
npm install
```

## Usage Examples

### 1. Build Mapping Database

Build the impact mapping from coverage data (run in nightly CI):

```bash
npm run tia:build
# or
npx tsx src/build-mapping.ts
```

### 2. Get Recommended Tests

Get tests affected by code changes (run in PR check):

```bash
npm run tia:recommend
# or
npx tsx src/recommend-tests.ts --branch=origin/main --level=function
```

### 3. Complete CI Integration

Use the all-in-one CI integration script:

```bash
# Build mode (nightly)
npx tsx src/ci-integration.ts build --coverage-dir=./coverage

# Recommend mode (PR)
npx tsx src/ci-integration.ts recommend --branch=origin/main

# Run mode (execute tests)
npx tsx src/ci-integration.ts run --branch=origin/main --runner="npm test --"

# Stats mode
npx tsx src/ci-integration.ts stats
```

## Integration in Your Project

### Basic Integration

```typescript
import { TiaCC } from '@tiacc/tools';

async function example() {
  // Initialize
  const tia = await TiaCC.init('./impact_map.db');

  // Build mapping
  await tia.buildMapping('./coverage');

  // Get affected tests
  const result = await tia.getAffectedTests({
    baseBranch: 'origin/main',
  });

  console.log('Affected tests:', result.tests);
  console.log('Savings:', result.savingsPercent + '%');

  // Clean up
  tia.close();
}
```

### With Custom Logging

```typescript
const tia = await TiaCC.init({
  dbPath: './impact_map.db',
  verbose: true,
  onLog: (message, level) => {
    // Send to your logging system
    myLogger[level](message);
  },
});
```

### GitHub Actions Integration

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Get affected tests
        run: npx tsx src/ci-integration.ts recommend --branch=origin/main --output=tests.txt

      - name: Run affected tests
        run: |
          if [ -s tests.txt ]; then
            cat tests.txt | xargs npm test --
          fi
```

## Files

- `src/build-mapping.ts` - Build the impact mapping database
- `src/recommend-tests.ts` - Get recommended tests
- `src/ci-integration.ts` - Complete CI integration script

## API Reference

See the main [TiaCC documentation](../../docs/architecture.md) for complete API reference.
