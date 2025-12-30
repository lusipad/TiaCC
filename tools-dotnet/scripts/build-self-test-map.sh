#!/bin/bash
# TiaCC .NET Dogfooding Script
# Builds test impact map for TiaCC's own test suite

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$PROJECT_DIR/tiacc-data"
COVERAGE_DIR="$DATA_DIR/coverage"
DB_PATH="$DATA_DIR/impact_map.db"

echo "=== TiaCC .NET Self-Testing (Dogfooding) ==="
echo "Project: $PROJECT_DIR"
echo "Data: $DATA_DIR"
echo ""

# Create directories
mkdir -p "$COVERAGE_DIR"

# Build the solution
echo "Building solution..."
dotnet build "$PROJECT_DIR/TiaCC.sln" -c Release

# Initialize the database
echo ""
echo "Initializing database..."
dotnet run --project "$PROJECT_DIR/TiaCC.Cli/TiaCC.Cli.csproj" -- init --db "$DB_PATH"

# Find all test classes
echo ""
echo "Discovering tests..."
TEST_PROJECT="$PROJECT_DIR/TiaCC.Core.Tests/TiaCC.Core.Tests.csproj"

# Get list of test methods using dotnet test --list-tests
TEST_LIST=$(dotnet test "$TEST_PROJECT" --list-tests --no-build 2>/dev/null | grep -E "^\s+\w+Tests\.\w+" || true)

if [ -z "$TEST_LIST" ]; then
    echo "No tests found. Running all tests to generate coverage..."

    # Run all tests with coverage
    dotnet test "$TEST_PROJECT" \
        --no-build \
        --collect:"XPlat Code Coverage" \
        --results-directory "$COVERAGE_DIR" \
        -- DataCollectionRunSettings.DataCollectors.DataCollector.Configuration.Format=cobertura

    # Find and process coverage file
    COVERAGE_FILE=$(find "$COVERAGE_DIR" -name "coverage.cobertura.xml" -type f | head -1)
    if [ -n "$COVERAGE_FILE" ]; then
        echo "Mapping coverage from: $COVERAGE_FILE"
        dotnet run --project "$PROJECT_DIR/TiaCC.Cli/TiaCC.Cli.csproj" -- map \
            --db "$DB_PATH" \
            --coverage "$COVERAGE_FILE" \
            --test "TiaCC.Core.Tests" \
            --base-dir "$PROJECT_DIR"
    fi
else
    echo "Found tests, running individually..."

    # Run each test class separately to get independent coverage
    for TEST_CLASS in CoverageParserTests DatabaseServiceTests; do
        echo ""
        echo "Running: $TEST_CLASS"

        # Clean previous coverage
        rm -rf "$COVERAGE_DIR/$TEST_CLASS"
        mkdir -p "$COVERAGE_DIR/$TEST_CLASS"

        # Run test class with coverage
        dotnet test "$TEST_PROJECT" \
            --no-build \
            --filter "FullyQualifiedName~$TEST_CLASS" \
            --collect:"XPlat Code Coverage" \
            --results-directory "$COVERAGE_DIR/$TEST_CLASS" \
            -- DataCollectionRunSettings.DataCollectors.DataCollector.Configuration.Format=cobertura || true

        # Find and process coverage file
        COVERAGE_FILE=$(find "$COVERAGE_DIR/$TEST_CLASS" -name "coverage.cobertura.xml" -type f | head -1)
        if [ -n "$COVERAGE_FILE" ]; then
            echo "Mapping coverage for $TEST_CLASS..."
            dotnet run --project "$PROJECT_DIR/TiaCC.Cli/TiaCC.Cli.csproj" -- map \
                --db "$DB_PATH" \
                --coverage "$COVERAGE_FILE" \
                --test "$TEST_CLASS" \
                --base-dir "$PROJECT_DIR"
        fi
    done
fi

# Show statistics
echo ""
echo "=== Impact Map Statistics ==="
dotnet run --project "$PROJECT_DIR/TiaCC.Cli/TiaCC.Cli.csproj" -- stats --db "$DB_PATH"

# Export for dashboard
echo ""
echo "Exporting for dashboard..."
dotnet run --project "$PROJECT_DIR/TiaCC.Cli/TiaCC.Cli.csproj" -- export \
    --db "$DB_PATH" \
    --output "$PROJECT_DIR/TiaCC.Dashboard/wwwroot/data"

echo ""
echo "=== Done ==="
echo "Impact map: $DB_PATH"
echo "Dashboard data: $PROJECT_DIR/TiaCC.Dashboard/wwwroot/data/dashboard.json"
