#!/bin/bash
#
# TiaCC Quick Initialization Script
# Usage: curl -sSL https://raw.githubusercontent.com/lusipad/TiaCC/main/scripts/init.sh | bash
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_banner() {
    echo -e "${BLUE}"
    echo "╔════════════════════════════════════════════════╗"
    echo "║                                                ║"
    echo "║   ████████╗██╗ █████╗  ██████╗ ██████╗        ║"
    echo "║      ██║   ██║██╔══██╗██╔════╝██╔════╝        ║"
    echo "║      ██║   ██║███████║██║     ██║             ║"
    echo "║      ██║   ██║██╔══██║██║     ██║             ║"
    echo "║      ██║   ██║██║  ██║╚██████╗╚██████╗        ║"
    echo "║      ╚═╝   ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝        ║"
    echo "║                                                ║"
    echo "║       Test Impact Analysis System              ║"
    echo "║                                                ║"
    echo "╚════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed. Please install Node.js 18+ first."
        exit 1
    fi

    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        log_error "Node.js version 18+ is required. Current: $(node -v)"
        exit 1
    fi
    log_info "Node.js version: $(node -v) ✓"

    # Check npm
    if ! command -v npm &> /dev/null; then
        log_error "npm is not installed."
        exit 1
    fi
    log_info "npm version: $(npm -v) ✓"

    # Check git
    if ! command -v git &> /dev/null; then
        log_error "git is not installed."
        exit 1
    fi
    log_info "git version: $(git --version | cut -d' ' -f3) ✓"
}

# Detect project type
detect_project_type() {
    log_info "Detecting project type..."

    if [ -f "CMakeLists.txt" ]; then
        PROJECT_TYPE="cpp"
        log_info "Detected: C++ project (CMake)"
    elif [ -f "*.csproj" ] || [ -f "*.sln" ]; then
        PROJECT_TYPE="csharp"
        log_info "Detected: C# project (.NET)"
    elif [ -f "package.json" ]; then
        PROJECT_TYPE="nodejs"
        log_info "Detected: Node.js project"
    else
        PROJECT_TYPE="unknown"
        log_warn "Could not detect project type"
    fi
}

# Install TiaCC tools
install_tiacc() {
    log_info "Installing TiaCC tools..."

    # Check if already installed globally
    if npm list -g @tiacc/tools &> /dev/null; then
        log_info "TiaCC tools already installed globally"
    else
        # Try global install first
        if npm install -g @tiacc/tools 2>/dev/null; then
            log_info "TiaCC tools installed globally ✓"
        else
            # Fall back to local install
            log_warn "Global install failed, installing locally..."
            npm install @tiacc/tools --save-dev
            log_info "TiaCC tools installed locally ✓"
        fi
    fi
}

# Create configuration file
create_config() {
    log_info "Creating configuration file..."

    if [ -f "tia_config.json" ]; then
        log_warn "tia_config.json already exists, skipping..."
        return
    fi

    cat > tia_config.json << 'EOF'
{
  "$schema": "https://raw.githubusercontent.com/lusipad/TiaCC/main/schemas/tia_config.schema.json",
  "version": "1.0",
  "recording_mode": "precise",
  "bucket_size": 50,
  "output_dir": "./coverage_data",
  "database": {
    "path": "./impact_map.db"
  },
  "cpp_service": {
    "host": "127.0.0.1",
    "port": 19840,
    "enabled": true
  },
  "csharp_service": {
    "host": "127.0.0.1",
    "port": 19841,
    "enabled": true
  },
  "source_extensions": [".cpp", ".cc", ".cxx", ".c", ".h", ".hpp", ".cs"],
  "test_extensions": [".lua", ".py", ".ts", ".js"],
  "llvm_tools": {
    "profdata": "llvm-profdata",
    "cov": "llvm-cov"
  }
}
EOF

    log_info "Created tia_config.json ✓"
}

# Create directory structure
create_directories() {
    log_info "Creating directory structure..."

    mkdir -p coverage_data
    mkdir -p .tiacc

    log_info "Created directories ✓"
}

# Create GitHub Actions workflow
create_github_workflow() {
    log_info "Creating GitHub Actions workflows..."

    mkdir -p .github/workflows

    # Nightly workflow
    cat > .github/workflows/tiacc-nightly.yml << 'EOF'
name: TiaCC Nightly Coverage

on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM
  workflow_dispatch:

jobs:
  build-coverage-map:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install TiaCC
        run: npm install -g @tiacc/tools

      # TODO: Add your build and test steps here
      # - name: Build with coverage
      #   run: ...
      # - name: Run all tests
      #   run: ...

      - name: Build impact map
        run: tia-mapper build --coverage-dir ./coverage_data --db impact_map.db

      - name: Upload impact map
        uses: actions/upload-artifact@v4
        with:
          name: impact-map
          path: impact_map.db
          retention-days: 30
EOF

    # PR workflow
    cat > .github/workflows/tiacc-pr.yml << 'EOF'
name: TiaCC Smart Test

on:
  pull_request:
    branches: [main, develop]

jobs:
  smart-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install TiaCC
        run: npm install -g @tiacc/tools

      - name: Download impact map
        uses: dawidd6/action-download-artifact@v3
        with:
          workflow: tiacc-nightly.yml
          name: impact-map
        continue-on-error: true

      - name: Get affected tests
        id: affected
        run: |
          if [ -f impact_map.db ]; then
            tia-recommend --db impact_map.db --branch origin/main --output affected_tests.txt --quiet
            echo "count=$(wc -l < affected_tests.txt)" >> $GITHUB_OUTPUT
          else
            echo "No impact map found, running all tests"
            echo "count=-1" >> $GITHUB_OUTPUT
          fi

      - name: Run affected tests
        if: steps.affected.outputs.count > 0
        run: |
          echo "Running ${{ steps.affected.outputs.count }} affected tests..."
          cat affected_tests.txt
          # TODO: Add your test execution command here
          # while read test; do ./run_test "$test"; done < affected_tests.txt
EOF

    log_info "Created GitHub Actions workflows ✓"
}

# Create .gitignore entries
update_gitignore() {
    log_info "Updating .gitignore..."

    GITIGNORE_ENTRIES="
# TiaCC
coverage_data/
*.profraw
*.profdata
.tiacc/
"

    if [ -f ".gitignore" ]; then
        if ! grep -q "TiaCC" .gitignore; then
            echo "$GITIGNORE_ENTRIES" >> .gitignore
            log_info "Updated .gitignore ✓"
        else
            log_info ".gitignore already has TiaCC entries"
        fi
    else
        echo "$GITIGNORE_ENTRIES" > .gitignore
        log_info "Created .gitignore ✓"
    fi
}

# Print next steps
print_next_steps() {
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  TiaCC initialization complete!${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════${NC}"
    echo ""
    echo "Next steps:"
    echo ""
    echo "1. Configure your build to enable coverage:"
    if [ "$PROJECT_TYPE" = "cpp" ]; then
        echo "   Add to CMakeLists.txt:"
        echo "     target_compile_options(your_target PRIVATE"
        echo "       -fprofile-instr-generate -fcoverage-mapping)"
    elif [ "$PROJECT_TYPE" = "csharp" ]; then
        echo "   Add to your .csproj:"
        echo "     <PackageReference Include=\"coverlet.collector\" Version=\"6.0.0\" />"
    fi
    echo ""
    echo "2. Run your tests with coverage enabled"
    echo ""
    echo "3. Build the mapping database:"
    echo "   tia-mapper build --coverage-dir ./coverage_data --db impact_map.db"
    echo ""
    echo "4. Get affected tests in PR:"
    echo "   tia-recommend --db impact_map.db --branch origin/main"
    echo ""
    echo "Documentation: https://github.com/lusipad/TiaCC"
    echo ""
}

# Main
main() {
    print_banner

    echo "This script will set up TiaCC in your project."
    echo ""

    check_prerequisites
    detect_project_type
    install_tiacc
    create_config
    create_directories
    create_github_workflow
    update_gitignore
    print_next_steps
}

main "$@"
