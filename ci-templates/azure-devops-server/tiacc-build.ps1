# TiaCC Build Script for Azure DevOps Server (Windows)
# This script builds the TiaCC impact mapping database from coverage data
#
# Usage in Classic Build:
#   Add a PowerShell task and reference this script
#
# Usage in YAML:
#   - powershell: ./ci-templates/azure-devops-server/tiacc-build.ps1
#     displayName: 'TiaCC Build Mapping'

param(
    [string]$CoverageDir = "./coverage",
    [string]$Database = "impact_map.db",
    [ValidateSet("auto", "cobertura", "lcov", "jacoco", "istanbul", "coveragepy", "dotcover", "opencppcoverage")]
    [string]$Format = "auto",
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"

Write-Host "=== TiaCC Build Mapping ===" -ForegroundColor Cyan
Write-Host "Coverage Directory: $CoverageDir"
Write-Host "Database: $Database"
Write-Host "Format: $Format"

# Verify coverage directory exists
if (-not (Test-Path $CoverageDir)) {
    Write-Host "Coverage directory not found: $CoverageDir" -ForegroundColor Red
    Write-Host "##vso[task.logissue type=error]Coverage directory not found: $CoverageDir"
    exit 1
}

# Build command arguments
$tiaccArgs = @(
    "build",
    "-c", $CoverageDir,
    "-d", $Database
)

# Add format flag
switch ($Format) {
    "lcov" { $tiaccArgs += "--lcov" }
    "jacoco" { $tiaccArgs += "--jacoco" }
    "istanbul" { $tiaccArgs += "--istanbul" }
    "coveragepy" { $tiaccArgs += "--coveragepy" }
    "dotcover" { $tiaccArgs += "--dotcover" }
    "opencppcoverage" { $tiaccArgs += "--opencppcoverage" }
    # "cobertura" and "auto" use default (no flag)
}

if ($Verbose) {
    $tiaccArgs += "-v"
}

Write-Host "`nRunning: tia-mapper $($tiaccArgs -join ' ')" -ForegroundColor Gray

try {
    & tia-mapper @tiaccArgs

    if (Test-Path $Database) {
        $dbSize = (Get-Item $Database).Length
        $dbSizeKB = [math]::Round($dbSize / 1024, 2)
        Write-Host "`nDatabase created successfully!" -ForegroundColor Green
        Write-Host "  Path: $Database"
        Write-Host "  Size: $dbSizeKB KB"

        # Set output variable with database path
        Write-Host "##vso[task.setvariable variable=TIACC_DATABASE]$Database"
        Write-Host "##vso[task.setvariable variable=TIACC_DATABASE_SIZE]$dbSizeKB"
    } else {
        Write-Host "Database file was not created" -ForegroundColor Red
        Write-Host "##vso[task.logissue type=error]TiaCC database was not created"
        exit 1
    }
} catch {
    Write-Host "Error building TiaCC mapping: $_" -ForegroundColor Red
    Write-Host "##vso[task.logissue type=error]$_"
    exit 1
}

Write-Host "`n==================================" -ForegroundColor Cyan
