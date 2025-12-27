#Requires -Version 5.1
<#
.SYNOPSIS
    TiaCC Quick Initialization Script for Windows

.DESCRIPTION
    Sets up TiaCC in your project with configuration files, directories,
    and CI workflows.

.EXAMPLE
    irm https://raw.githubusercontent.com/your-org/TiaCC/main/scripts/init.ps1 | iex

.NOTES
    Requires Node.js 18+
#>

$ErrorActionPreference = "Stop"

# Colors
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

function Write-Banner {
    Write-Host @"

    ████████╗██╗ █████╗  ██████╗ ██████╗
       ██║   ██║██╔══██╗██╔════╝██╔════╝
       ██║   ██║███████║██║     ██║
       ██║   ██║██╔══██║██║     ██║
       ██║   ██║██║  ██║╚██████╗╚██████╗
       ╚═╝   ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═════╝

         Test Impact Analysis System

"@ -ForegroundColor Cyan
}

function Write-Info($message) {
    Write-Host "[INFO] " -ForegroundColor Green -NoNewline
    Write-Host $message
}

function Write-Warn($message) {
    Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline
    Write-Host $message
}

function Write-Err($message) {
    Write-Host "[ERROR] " -ForegroundColor Red -NoNewline
    Write-Host $message
}

function Test-Prerequisites {
    Write-Info "Checking prerequisites..."

    # Check Node.js
    try {
        $nodeVersion = (node -v) -replace 'v', ''
        $majorVersion = [int]($nodeVersion.Split('.')[0])

        if ($majorVersion -lt 18) {
            Write-Err "Node.js version 18+ is required. Current: v$nodeVersion"
            exit 1
        }
        Write-Info "Node.js version: v$nodeVersion ✓"
    }
    catch {
        Write-Err "Node.js is not installed. Please install Node.js 18+ first."
        exit 1
    }

    # Check npm
    try {
        $npmVersion = npm -v
        Write-Info "npm version: $npmVersion ✓"
    }
    catch {
        Write-Err "npm is not installed."
        exit 1
    }

    # Check git
    try {
        $gitVersion = (git --version) -replace 'git version ', ''
        Write-Info "git version: $gitVersion ✓"
    }
    catch {
        Write-Err "git is not installed."
        exit 1
    }
}

function Get-ProjectType {
    Write-Info "Detecting project type..."

    if (Test-Path "CMakeLists.txt") {
        $script:ProjectType = "cpp"
        Write-Info "Detected: C++ project (CMake)"
    }
    elseif ((Test-Path "*.csproj") -or (Test-Path "*.sln")) {
        $script:ProjectType = "csharp"
        Write-Info "Detected: C# project (.NET)"
    }
    elseif (Test-Path "package.json") {
        $script:ProjectType = "nodejs"
        Write-Info "Detected: Node.js project"
    }
    else {
        $script:ProjectType = "unknown"
        Write-Warn "Could not detect project type"
    }
}

function Install-TiaCC {
    Write-Info "Installing TiaCC tools..."

    # Try global install
    try {
        $result = npm list -g @tiacc/tools 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Info "TiaCC tools already installed globally"
            return
        }
    }
    catch { }

    try {
        npm install -g @tiacc/tools 2>&1 | Out-Null
        Write-Info "TiaCC tools installed globally ✓"
    }
    catch {
        Write-Warn "Global install failed, installing locally..."
        npm install @tiacc/tools --save-dev
        Write-Info "TiaCC tools installed locally ✓"
    }
}

function New-Config {
    Write-Info "Creating configuration file..."

    if (Test-Path "tia_config.json") {
        Write-Warn "tia_config.json already exists, skipping..."
        return
    }

    $config = @'
{
  "$schema": "https://raw.githubusercontent.com/your-org/TiaCC/main/schemas/tia_config.schema.json",
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
'@

    $config | Out-File -FilePath "tia_config.json" -Encoding UTF8
    Write-Info "Created tia_config.json ✓"
}

function New-Directories {
    Write-Info "Creating directory structure..."

    New-Item -ItemType Directory -Path "coverage_data" -Force | Out-Null
    New-Item -ItemType Directory -Path ".tiacc" -Force | Out-Null

    Write-Info "Created directories ✓"
}

function New-AzurePipelinesWorkflow {
    Write-Info "Creating Azure Pipelines configuration..."

    $pipelinesDir = ".azure-pipelines"
    New-Item -ItemType Directory -Path $pipelinesDir -Force | Out-Null

    # Nightly pipeline
    $nightlyPipeline = @'
trigger: none

schedules:
  - cron: "0 2 * * *"
    displayName: Daily 2 AM
    branches:
      include:
        - main

pool:
  vmImage: 'ubuntu-latest'

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'

  - script: npm install -g @tiacc/tools
    displayName: 'Install TiaCC'

  # TODO: Add your build and test steps here

  - script: tia-mapper build --coverage-dir ./coverage_data --db impact_map.db
    displayName: 'Build impact map'

  - task: PublishPipelineArtifact@1
    inputs:
      targetPath: 'impact_map.db'
      artifact: 'impact-map'
'@

    $nightlyPipeline | Out-File -FilePath "$pipelinesDir/tiacc-nightly.yml" -Encoding UTF8

    # PR pipeline
    $prPipeline = @'
trigger: none

pr:
  - main
  - develop

pool:
  vmImage: 'ubuntu-latest'

steps:
  - checkout: self
    fetchDepth: 0

  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'

  - script: npm install -g @tiacc/tools
    displayName: 'Install TiaCC'

  - task: DownloadPipelineArtifact@2
    inputs:
      buildType: 'specific'
      project: '$(System.TeamProjectId)'
      definition: 'TiaCC Nightly'
      buildVersionToDownload: 'latest'
      artifactName: 'impact-map'
      targetPath: '$(Pipeline.Workspace)'
    continueOnError: true

  - script: |
      if [ -f "$(Pipeline.Workspace)/impact_map.db" ]; then
        cp "$(Pipeline.Workspace)/impact_map.db" ./impact_map.db
        tia-recommend --db impact_map.db --branch origin/main --output affected_tests.txt --quiet
        echo "Affected tests:"
        cat affected_tests.txt
      else
        echo "No impact map found, running all tests"
      fi
    displayName: 'Get affected tests'

  # TODO: Add your test execution step here
'@

    $prPipeline | Out-File -FilePath "$pipelinesDir/tiacc-pr.yml" -Encoding UTF8

    Write-Info "Created Azure Pipelines configurations ✓"
}

function Update-GitIgnore {
    Write-Info "Updating .gitignore..."

    $entries = @"

# TiaCC
coverage_data/
*.profraw
*.profdata
.tiacc/
"@

    if (Test-Path ".gitignore") {
        $content = Get-Content ".gitignore" -Raw
        if ($content -notmatch "TiaCC") {
            Add-Content -Path ".gitignore" -Value $entries
            Write-Info "Updated .gitignore ✓"
        }
        else {
            Write-Info ".gitignore already has TiaCC entries"
        }
    }
    else {
        $entries | Out-File -FilePath ".gitignore" -Encoding UTF8
        Write-Info "Created .gitignore ✓"
    }
}

function Write-NextSteps {
    Write-Host ""
    Write-Host "════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host "  TiaCC initialization complete!" -ForegroundColor Green
    Write-Host "════════════════════════════════════════════════" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host ""
    Write-Host "1. Configure your build to enable coverage:"

    if ($script:ProjectType -eq "cpp") {
        Write-Host "   Add to CMakeLists.txt:"
        Write-Host "     target_compile_options(your_target PRIVATE"
        Write-Host "       -fprofile-instr-generate -fcoverage-mapping)"
    }
    elseif ($script:ProjectType -eq "csharp") {
        Write-Host "   Add to your .csproj:"
        Write-Host '     <PackageReference Include="coverlet.collector" Version="6.0.0" />'
    }

    Write-Host ""
    Write-Host "2. Run your tests with coverage enabled"
    Write-Host ""
    Write-Host "3. Build the mapping database:"
    Write-Host "   tia-mapper build --coverage-dir ./coverage_data --db impact_map.db"
    Write-Host ""
    Write-Host "4. Get affected tests in PR:"
    Write-Host "   tia-recommend --db impact_map.db --branch origin/main"
    Write-Host ""
    Write-Host "Documentation: https://github.com/your-org/TiaCC"
    Write-Host ""
}

# Main
function Main {
    Write-Banner

    Write-Host "This script will set up TiaCC in your project."
    Write-Host ""

    Test-Prerequisites
    Get-ProjectType
    Install-TiaCC
    New-Config
    New-Directories
    New-AzurePipelinesWorkflow
    Update-GitIgnore
    Write-NextSteps
}

Main
