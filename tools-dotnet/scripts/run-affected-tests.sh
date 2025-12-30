#!/bin/bash
# TiaCC .NET - Run Affected Tests
# Uses impact map to determine which tests to run based on changed files

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="$PROJECT_DIR/tiacc-data"
DB_PATH="$DATA_DIR/impact_map.db"

echo "=== TiaCC Smart Test Selection ==="

# Check if database exists
if [ ! -f "$DB_PATH" ]; then
    echo "Impact map not found at $DB_PATH"
    echo "Run 'scripts/build-self-test-map.sh' first to build the map."
    echo "Falling back to running all tests..."
    dotnet test "$PROJECT_DIR/TiaCC.Core.Tests/TiaCC.Core.Tests.csproj"
    exit 0
fi

# Get changed files (from git or command line)
if [ $# -gt 0 ]; then
    CHANGED_FILES="$*"
else
    # Get files changed since last commit or in working directory
    CHANGED_FILES=$(git diff --name-only HEAD 2>/dev/null || git diff --name-only 2>/dev/null || echo "")
    if [ -z "$CHANGED_FILES" ]; then
        CHANGED_FILES=$(git diff --name-only --cached 2>/dev/null || echo "")
    fi
fi

if [ -z "$CHANGED_FILES" ]; then
    echo "No changed files detected."
    echo "Running all tests..."
    dotnet test "$PROJECT_DIR/TiaCC.Core.Tests/TiaCC.Core.Tests.csproj"
    exit 0
fi

echo "Changed files:"
echo "$CHANGED_FILES" | sed 's/^/  /'
echo ""

# Query affected tests
echo "Querying impact map..."
AFFECTED_TESTS=$(dotnet run --project "$PROJECT_DIR/TiaCC.Cli/TiaCC.Cli.csproj" -- query \
    --db "$DB_PATH" \
    --files $CHANGED_FILES 2>/dev/null || echo "")

if [ -z "$AFFECTED_TESTS" ] || [ "$AFFECTED_TESTS" = "No affected tests found." ]; then
    echo "No tests affected by changes. Skipping test run."
    exit 0
fi

echo "Affected tests:"
echo "$AFFECTED_TESTS" | sed 's/^/  /'
echo ""

# Build filter expression for dotnet test
FILTER=""
for TEST in $AFFECTED_TESTS; do
    if [ -n "$FILTER" ]; then
        FILTER="$FILTER|"
    fi
    FILTER="${FILTER}FullyQualifiedName~${TEST}"
done

if [ -n "$FILTER" ]; then
    echo "Running affected tests..."
    dotnet test "$PROJECT_DIR/TiaCC.Core.Tests/TiaCC.Core.Tests.csproj" --filter "$FILTER"
else
    echo "No matching test filter. Running all tests..."
    dotnet test "$PROJECT_DIR/TiaCC.Core.Tests/TiaCC.Core.Tests.csproj"
fi
