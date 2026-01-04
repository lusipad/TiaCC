#!/bin/bash
# TiaCC .NET Dogfooding Script
# Builds test impact map for TiaCC's own test suite

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$PROJECT_DIR/tiacc-data"
COVERAGE_DIR="$DATA_DIR/coverage"
DB_PATH="$DATA_DIR/impact_map.db"
TEST_PROJECT="$PROJECT_DIR/TiaCC.Core.Tests/TiaCC.Core.Tests.csproj"

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
dotnet run --project "$PROJECT_DIR/TiaCC.Cli/TiaCC.Cli.csproj" --no-build -c Release -- init --db "$DB_PATH"

# Discover test classes (Namespace.Class) from dotnet test --list-tests output.
echo ""
echo "Discovering test classes..."
TEST_CLASSES=$(dotnet test "$TEST_PROJECT" --no-build -c Release --list-tests 2>/dev/null \
  | sed -E 's/^[[:space:]]+//; s/\r$//' \
  | grep -E '^[A-Za-z0-9_.]+$' \
  | sed -E 's/\.[^.]+$//' \
  | sort -u || true)

if [ -z "$TEST_CLASSES" ]; then
  echo "No tests found via --list-tests. Running all tests to generate coverage..."

  rm -rf "$COVERAGE_DIR/all"
  mkdir -p "$COVERAGE_DIR/all"

  dotnet test "$TEST_PROJECT" \
    --no-build -c Release \
    --collect:"XPlat Code Coverage" \
    --results-directory "$COVERAGE_DIR/all" \
    -- DataCollectionRunSettings.DataCollectors.DataCollector.Configuration.Format=cobertura

  COVERAGE_FILE=$(find "$COVERAGE_DIR/all" -name "coverage.cobertura.xml" -type f | head -1)
  if [ -z "$COVERAGE_FILE" ]; then
    echo "Coverage file not found"
    exit 1
  fi

  echo "Mapping coverage from: $COVERAGE_FILE"
  dotnet run --project "$PROJECT_DIR/TiaCC.Cli/TiaCC.Cli.csproj" --no-build -c Release -- map \
    --db "$DB_PATH" \
    --coverage "$COVERAGE_FILE" \
    --test "TiaCC.Core.Tests" \
    --base-dir "$PROJECT_DIR"
else
  echo "Found $(echo "$TEST_CLASSES" | wc -l | tr -d ' ') test classes, running individually..."

  rm -rf "$COVERAGE_DIR/by-class"
  mkdir -p "$COVERAGE_DIR/by-class"

  while IFS= read -r TEST_CLASS; do
    [ -z "$TEST_CLASS" ] && continue

    echo ""
    echo "Running: $TEST_CLASS"

    CLASS_DIR="$COVERAGE_DIR/by-class/$TEST_CLASS"
    rm -rf "$CLASS_DIR"
    mkdir -p "$CLASS_DIR"

    dotnet test "$TEST_PROJECT" \
      --no-build -c Release \
      --filter "FullyQualifiedName~$TEST_CLASS" \
      --collect:"XPlat Code Coverage" \
      --results-directory "$CLASS_DIR" \
      -- DataCollectionRunSettings.DataCollectors.DataCollector.Configuration.Format=cobertura

    COVERAGE_FILE=$(find "$CLASS_DIR" -name "coverage.cobertura.xml" -type f | head -1)
    if [ -z "$COVERAGE_FILE" ]; then
      echo "Coverage file not found for $TEST_CLASS"
      exit 1
    fi

    cp "$COVERAGE_FILE" "$COVERAGE_DIR/test_${TEST_CLASS}.cobertura.xml"

    echo "Mapping coverage for $TEST_CLASS..."
    dotnet run --project "$PROJECT_DIR/TiaCC.Cli/TiaCC.Cli.csproj" --no-build -c Release -- map \
      --db "$DB_PATH" \
      --coverage "$COVERAGE_FILE" \
      --test "$TEST_CLASS" \
      --base-dir "$PROJECT_DIR"
  done <<< "$TEST_CLASSES"
fi

# Show statistics
echo ""
echo "=== Impact Map Statistics ==="
dotnet run --project "$PROJECT_DIR/TiaCC.Cli/TiaCC.Cli.csproj" --no-build -c Release -- stats --db "$DB_PATH"

# Export for dashboard
echo ""
echo "Exporting for dashboard..."
dotnet run --project "$PROJECT_DIR/TiaCC.Cli/TiaCC.Cli.csproj" --no-build -c Release -- export \
  --db "$DB_PATH" \
  --output "$PROJECT_DIR/TiaCC.Dashboard/wwwroot/data"

echo ""
echo "=== Done ==="
echo "Impact map: $DB_PATH"
echo "Dashboard data: $PROJECT_DIR/TiaCC.Dashboard/wwwroot/data/dashboard.json"
