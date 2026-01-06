#!/bin/bash
# TiaCC .NET Dogfooding Script
# Builds test impact map for TiaCC's own test suite

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOLUTION_PATH="$REPO_ROOT/src/TiaCC.DotNet.sln"
CLI_PROJECT="$REPO_ROOT/src/cli/dotnet/TiaCC.Cli/TiaCC.Cli.csproj"
TEST_PROJECT="$REPO_ROOT/src/core/dotnet/TiaCC.Core.Tests/TiaCC.Core.Tests.csproj"
DASHBOARD_DATA_DIR="$REPO_ROOT/src/dashboard/dotnet/TiaCC.Dashboard/wwwroot/data"

DATA_DIR="$REPO_ROOT/artifacts/tiacc-data"
COVERAGE_DIR="$DATA_DIR/coverage"
DB_PATH="$DATA_DIR/impact_map.db"

echo "=== TiaCC .NET Self-Testing (Dogfooding) ==="
echo "Repo:    $REPO_ROOT"
echo "Data: $DATA_DIR"
echo ""

# Create directories
mkdir -p "$COVERAGE_DIR"

# Build the solution
echo "Building solution..."
dotnet build "$SOLUTION_PATH" -c Release

# Initialize the database
echo ""
echo "Initializing database..."
dotnet run --project "$CLI_PROJECT" --no-build -c Release -- init --db "$DB_PATH"

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
  dotnet run --project "$CLI_PROJECT" --no-build -c Release -- map \
    --db "$DB_PATH" \
    --coverage "$COVERAGE_FILE" \
    --test "TiaCC.Core.Tests" \
    --base-dir "$REPO_ROOT"
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
    dotnet run --project "$CLI_PROJECT" --no-build -c Release -- map \
      --db "$DB_PATH" \
      --coverage "$COVERAGE_FILE" \
      --test "$TEST_CLASS" \
      --base-dir "$REPO_ROOT"
  done <<< "$TEST_CLASSES"
fi

# Show statistics
echo ""
echo "=== Impact Map Statistics ==="
dotnet run --project "$CLI_PROJECT" --no-build -c Release -- stats --db "$DB_PATH"

# Validate database integrity (must have some mappings)
echo ""
echo "Validating impact map database..."
python3 - <<PY
import sqlite3
import sys

db_path = r"""$DB_PATH"""

con = sqlite3.connect(db_path)
cur = con.cursor()

def count(table: str) -> int:
    return int(cur.execute(f"select count(*) from {table}").fetchone()[0])

tables = {
    "source_files": 1,
    "test_scripts": 1,
    "coverage_map": 1,
}

ok = True
for table, minimum in tables.items():
    c = count(table)
    print(f"{table}: {c}")
    if c < minimum:
        print(f"ERROR: expected at least {minimum} rows in {table}, got {c}")
        ok = False

if not ok:
    sys.exit(1)
PY

# Export for dashboard
echo ""
echo "Exporting for dashboard..."
dotnet run --project "$CLI_PROJECT" --no-build -c Release -- export \
  --db "$DB_PATH" \
  --output "$DASHBOARD_DATA_DIR"

echo ""
echo "Validating dashboard export..."
python3 - <<PY
import json
import sys
from pathlib import Path

out_dir = Path(r"""$DASHBOARD_DATA_DIR""")
dashboard = out_dir / "dashboard.json"
required_files = [
    "dashboard.json",
    "stats.json",
    "source-files.json",
    "test-scripts.json",
    "mappings.json",
    "directory-coverage.json",
    "graph.json",
    "symbols.json",
]

missing = [f for f in required_files if not (out_dir / f).is_file()]
if missing:
    print("ERROR: missing exported file(s):", ", ".join(missing))
    sys.exit(1)

data = json.loads(dashboard.read_text(encoding="utf-8"))
for key in ("sourceFiles", "testScripts", "coverageMap"):
    if key not in data:
        print(f"ERROR: dashboard.json missing key: {key}")
        sys.exit(1)
    if not isinstance(data[key], list) or len(data[key]) == 0:
        print(f"ERROR: dashboard.json key {key} is empty")
        sys.exit(1)

print("dashboard.json looks valid")
PY

echo ""
echo "=== Done ==="
echo "Impact map: $DB_PATH"
echo "Dashboard data: $DASHBOARD_DATA_DIR/dashboard.json"
