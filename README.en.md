# TiaCC - Test Impact Analysis for Code Coverage

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)

### 🎯 Run Only Affected Tests, Make CI Lightning Fast

**Reduce 30-minute full test runs to 5 minutes**

[🚀 Quick Start](#-quick-start) •
[📖 How It Works](#-how-it-works) •
[📊 Dashboard](#-interactive-dashboard) •
[📚 Docs](docs/architecture.md)

[🇨🇳 中文版](README.md)

</div>

---

## 😫 Sound Familiar?

| Pain Point | Description |
|------------|-------------|
| ⏰ **Slow CI** | Every commit waits 30+ minutes for full test suite |
| 💸 **Wasted Resources** | Changed one line, runs thousands of unrelated tests |
| 😴 **Slow Feedback** | Submit PR, grab coffee, still waiting... |
| 🔄 **Redundant Work** | Passed locally, CI runs everything again |

## ✨ How TiaCC Solves This

<div align="center">

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│     Traditional Way                     TiaCC Way                       │
│     ───────────────                     ──────────                       │
│                                                                         │
│     Changed calculator.cpp             Changed calculator.cpp           │
│            ↓                                  ↓                         │
│     Run 1000+ tests                    Smart analysis: Which tests      │
│            ↓                           cover this file?                 │
│     Wait 30 minutes                           ↓                         │
│            ↓                           Recommend only 2 relevant tests  │
│     😴                                        ↓                         │
│                                        ✅ Done in 3 minutes!            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

</div>

### 🔍 Core Principle

TiaCC builds source-to-test mappings through **code coverage analysis**:

```
1️⃣ Nightly Build: Run full test suite, record which tests cover which files
                   ↓
2️⃣ Generate Mapping DB: calculator.cpp ← test_calc_basic, test_calc_advanced
                         statistics.cpp  ← test_statistics
                   ↓
3️⃣ PR Submission: Detect which files you changed
                   ↓
4️⃣ Smart Recommendation: Run only affected tests!
```

## 📊 Interactive Dashboard

TiaCC provides a beautiful Web Dashboard to **visualize** code-test relationships:

### 🌐 Dependency Graph

Intuitive view of source files (blue) and tests (green) relationships:

<div align="center">
<img src="docs/images/dashboard_main.png" alt="Dashboard Main View" width="800">
</div>

### 📁 Smart File Management

Folder grouping with aggregate coverage, clear at a glance:

<div align="center">
<img src="docs/images/dashboard_folders.png" alt="Folder View" width="800">
</div>

### 🔬 Function-Level Analysis

Click any source file to see function-level coverage details:

<div align="center">
<img src="docs/images/dashboard_detail.png" alt="Detail Panel" width="800">
</div>

## 🚀 Quick Start

### 30-Second Dashboard Demo

```bash
# 1. Clone the repo
git clone https://github.com/your-org/TiaCC.git
cd TiaCC

# 2. Start Dashboard (with sample data)
cd dashboard
python -m http.server 8080

# 3. Open browser
# http://localhost:8080/dashboard/
```

### Using in Your Project

#### Step 1: Nightly - Build Mapping Database

```bash
# 1. Build with Clang (enable coverage)
clang++ -fprofile-instr-generate -fcoverage-mapping -o app src/*.cpp

# 2. Run full test suite (each test generates .profraw file)
./run_all_tests.sh

# 3. Build mapping database
cd tools-node && npm install
npx tsx src/cli/mapper.ts build \
  --coverage-dir ../coverage_data \
  --db ../impact_map.db
```

#### Step 2: PR Time - Get Recommended Tests

```bash
# Get affected tests
npx tsx src/cli/recommend.ts \
  --db impact_map.db \
  --branch origin/main

# Example output:
# Detected changes: calculator.cpp
# Recommended tests:
#   ✓ test_calculator_basic
#   ✓ test_calculator_advanced
# 
# Saved 998 tests!
```

## 📈 Results Comparison

| Metric | Traditional | With TiaCC |
|--------|-------------|------------|
| CI Time | 30 minutes | **3-5 minutes** |
| Tests Run | 1000+ | **2-10** |
| Developer Feedback | 30 min after commit | **3 min after commit** |
| Compute Resources | 100% | **5-10%** |

## 🎯 Typical Use Cases

### Use Case 1: Daily Development

```bash
# Modified calculator.cpp
git diff --name-only
# → src/calculator.cpp

# Query affected tests
npx tsx src/cli/mapper.ts query calculator.cpp --db impact_map.db
# → test_calculator_basic, test_calculator_advanced

# Run only these 2 tests
./run_test test_calculator_basic test_calculator_advanced
```

### Use Case 2: CI/CD Integration

```yaml
# .github/workflows/pr.yml
- name: Get affected tests
  run: |
    npx tsx tools-node/src/cli/recommend.ts \
      --db impact_map.db \
      --output affected_tests.txt
    
- name: Run affected tests
  run: cat affected_tests.txt | xargs ./run_test
```

### Use Case 3: Dashboard Analysis

1. **Visual Exploration** - Understand code-test dependencies
2. **Function-Level Targeting** - Find low-coverage functions
3. **Impact Analysis** - See which tests a file change affects

## 🏗️ Supported Tech Stack

| Type | Support |
|------|---------|
| **Languages** | C++ (LLVM), C# (Coverlet) |
| **Test Frameworks** | Lua, Python, C#, TypeScript, Go |
| **Platforms** | Windows, Linux, macOS |
| **Analysis Level** | File-level, Function-level |

## 📁 Project Structure

```
TiaCC/
├── dashboard/           # 📊 Web visualization Dashboard
├── tools-node/          # 🛠️ CLI tools (mapper, recommend)
├── clients/             # 🔌 Multi-language test framework clients
├── src/
│   ├── cpp/             # C++ coverage collection
│   └── dotnet/          # C# coverage collection
├── tests/e2e/           # ✅ End-to-end verification tests
└── docs/                # 📚 Detailed documentation
```

## 📚 Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | System architecture, data flow, Dashboard features |
| [Integration Guide](docs/integration-guide.md) | How to integrate into your project |
| [E2E Tests](tests/e2e/README.md) | End-to-end verification tests |

## 🤝 Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) to learn how.

## 📄 License

MIT License - See [LICENSE](LICENSE)

---

<div align="center">

**⭐ If TiaCC helped you, please give it a Star!**

Made with ❤️ by the TiaCC Team

</div>
