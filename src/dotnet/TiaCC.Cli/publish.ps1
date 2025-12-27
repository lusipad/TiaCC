# TiaCC CLI 构建和发布脚本 (PowerShell)
# 生成各平台的单文件可执行程序

$ErrorActionPreference = "Stop"

$Version = "1.0.0"
$OutputDir = "./publish"
$ProjectDir = $PSScriptRoot

Write-Host "╔════════════════════════════════════════════════════════════╗" -ForegroundColor Blue
Write-Host "║  TiaCC CLI 构建系统                                        ║" -ForegroundColor Blue
Write-Host "╚════════════════════════════════════════════════════════════╝" -ForegroundColor Blue
Write-Host ""

# 清理旧构建
if (Test-Path $OutputDir) {
    Remove-Item -Recurse -Force $OutputDir
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

# 定义目标平台
$Targets = @(
    "win-x64",
    "win-arm64",
    "linux-x64",
    "linux-arm64",
    "osx-x64",
    "osx-arm64"
)

# 构建各平台版本
foreach ($RID in $Targets) {
    Write-Host "构建 $RID ..." -ForegroundColor Green

    dotnet publish "$ProjectDir/TiaCC.Cli.csproj" `
        -c Release `
        -r $RID `
        -o "$OutputDir/$RID" `
        --self-contained true `
        -p:PublishSingleFile=true `
        -p:PublishTrimmed=true `
        -p:EnableCompressionInSingleFile=true

    # 重命名可执行文件
    if ($RID -like "win-*") {
        Move-Item "$OutputDir/$RID/tiacc.exe" "$OutputDir/tiacc-$RID.exe"
    } else {
        Move-Item "$OutputDir/$RID/tiacc" "$OutputDir/tiacc-$RID"
    }

    # 清理临时目录
    Remove-Item -Recurse -Force "$OutputDir/$RID"

    Write-Host "  完成: $OutputDir/tiacc-$RID"
}

Write-Host ""
Write-Host "════════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "构建完成!" -ForegroundColor Green
Write-Host ""
Write-Host "输出文件:"
Get-ChildItem "$OutputDir/tiacc-*" | Format-Table Name, Length
Write-Host ""
Write-Host "使用方法:"
Write-Host "  .\tiacc-win-x64.exe collect --command `"dotnet test`""
Write-Host "  .\tiacc-win-x64.exe --help"
