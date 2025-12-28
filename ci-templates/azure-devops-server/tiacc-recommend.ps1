# TiaCC Recommend Script for Azure DevOps Server (Windows)
# This script can be used in classic build definitions or YAML pipelines
#
# Usage in Classic Build:
#   Add a PowerShell task and reference this script
#
# Usage in YAML:
#   - powershell: ./ci-templates/azure-devops-server/tiacc-recommend.ps1
#     displayName: 'TiaCC Recommend'
#
# Outputs:
#   - TIACC_AFFECTED_TESTS: Comma-separated list of affected tests
#   - TIACC_RUN_ALL: 'true' if all tests should run
#   - affected-tests.txt: File with affected test names

param(
    [string]$Database = "impact_map.db",
    [string]$BaseBranch = "",
    [string]$OutputFile = "affected-tests.txt",
    [switch]$Verbose
)

$ErrorActionPreference = "Stop"

# Determine base branch
if ([string]::IsNullOrEmpty($BaseBranch)) {
    if ($env:SYSTEM_PULLREQUEST_TARGETBRANCH) {
        $targetBranch = $env:SYSTEM_PULLREQUEST_TARGETBRANCH -replace '^refs/heads/', ''
        $BaseBranch = "origin/$targetBranch"
    } else {
        $BaseBranch = "origin/main"
    }
}

Write-Host "=== TiaCC Test Impact Analysis ===" -ForegroundColor Cyan
Write-Host "Database: $Database"
Write-Host "Base Branch: $BaseBranch"

# Check if database exists
if (-not (Test-Path $Database)) {
    Write-Host "No TiaCC database found. Will run all tests." -ForegroundColor Yellow
    "" | Out-File -FilePath $OutputFile -Encoding UTF8
    Write-Host "##vso[task.setvariable variable=TIACC_AFFECTED_TESTS]"
    Write-Host "##vso[task.setvariable variable=TIACC_RUN_ALL]true"
    exit 0
}

# Build command arguments
$tiaccArgs = @(
    "--db", $Database,
    "--base", $BaseBranch
)

if ($Verbose) {
    $tiaccArgs += "-v"
}

try {
    # Run tia-recommend
    $affectedTests = & tia-recommend @tiaccArgs 2>$null
    $affectedTestsList = $affectedTests -split "`n" | Where-Object { $_ -ne "" }

    if ($affectedTestsList.Count -gt 0) {
        Write-Host "`nAffected tests ($($affectedTestsList.Count)):" -ForegroundColor Green
        $affectedTestsList | ForEach-Object { Write-Host "  - $_" }

        # Write to output file
        $affectedTests | Out-File -FilePath $OutputFile -Encoding UTF8

        # Set Azure DevOps variables
        $affectedCsv = $affectedTestsList -join ","
        Write-Host "##vso[task.setvariable variable=TIACC_AFFECTED_TESTS]$affectedCsv"
        Write-Host "##vso[task.setvariable variable=TIACC_RUN_ALL]false"
        Write-Host "##vso[task.setvariable variable=TIACC_AFFECTED_COUNT]$($affectedTestsList.Count)"
    } else {
        Write-Host "`nNo specific tests affected. Will run all tests." -ForegroundColor Yellow
        "" | Out-File -FilePath $OutputFile -Encoding UTF8
        Write-Host "##vso[task.setvariable variable=TIACC_AFFECTED_TESTS]"
        Write-Host "##vso[task.setvariable variable=TIACC_RUN_ALL]true"
        Write-Host "##vso[task.setvariable variable=TIACC_AFFECTED_COUNT]0"
    }
} catch {
    Write-Host "Error running TiaCC: $_" -ForegroundColor Red
    Write-Host "Will run all tests as fallback." -ForegroundColor Yellow
    "" | Out-File -FilePath $OutputFile -Encoding UTF8
    Write-Host "##vso[task.setvariable variable=TIACC_AFFECTED_TESTS]"
    Write-Host "##vso[task.setvariable variable=TIACC_RUN_ALL]true"
}

Write-Host "`n==================================" -ForegroundColor Cyan
