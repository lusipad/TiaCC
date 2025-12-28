# TiaCC Examples

This directory contains example projects demonstrating how to use TiaCC in different scenarios.

## 📁 Available Examples

### 1. Basic Example (`basic/`)

A simple JavaScript/Node.js project demonstrating TiaCC's core functionality.

**What it shows:**
- Basic test-to-code mapping
- Coverage data collection
- Test impact analysis with Jest

**Run the demo:**
```bash
cd basic
npm install
node demo.js
```

**Key features demonstrated:**
- Automatic test reduction based on code changes
- Coverage mapping visualization
- Integration with Jest test framework

### 2. TypeScript Integration (`typescript-integration/`)

Advanced TypeScript integration example showing how to use TiaCC in a modern Node.js/TypeScript project.

**What it shows:**
- Building impact databases programmatically
- Recommending tests based on git changes
- Complete CI/CD integration workflow

**Run the example:**
```bash
cd typescript-integration
npm install
npm run build:mapping
npm run recommend
```

**Key features demonstrated:**
- TypeScript API usage
- Git integration for change detection
- Production-ready CI/CD patterns

## 🚀 Getting Started

1. Choose the example that matches your needs:
   - **New to TiaCC?** Start with `basic/`
   - **Production integration?** Check out `typescript-integration/`

2. Each example has its own README with detailed instructions

3. For more information, see the [main documentation](../docs/)

## 📚 Additional Resources

- [Quick Start Guide](../QUICK_START.md)
- [Integration Guide](../docs/integration-guide.md)
- [CI/CD Integration](../docs/ci-cd-integration.md)
- [Language-Specific Examples](../docs/language-specific-examples.md)
