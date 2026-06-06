# 一鍵發佈新版編輯器。用法(在 art-editor 資料夾):
#   pwsh scripts/release.ps1 0.2.1
# 它會:升版號 → build → 打包 → 壓 zip → 建 GitHub Release(附 zip)→ 更新桌面 zip
# 之後使用者開啟編輯器就會看到「有新版本」橫幅,一鍵更新。
param([Parameter(Mandatory = $true)][string]$Version)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

$gh = "C:\Program Files\GitHub CLI\gh.exe"
& $gh auth switch -u ch4art | Out-Null

# 1. 升版號
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = $Version
($pkg | ConvertTo-Json -Depth 30) | Set-Content package.json -Encoding utf8
Write-Host "版本 -> $Version"

# 2. build + 打包
npm run build
npx @electron/packager . CuteEditor --platform=win32 --arch=x64 --out=release --overwrite --asar `
  --ignore="(^/release|^/src|^/\.vscode|^/build|^/raw|\.map$|^/tsconfig|^/electron\.vite|^/\.git)"

# 3. 壓 zip
$zip = Join-Path $root "release\CuteEditor-win32-x64.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path "release\CuteEditor-win32-x64\*" -DestinationPath $zip -Force
Copy-Item $zip "$env:USERPROFILE\Desktop\CuteEditor.zip" -Force

# 4. commit 版號 + 建 Release
git add package.json
git commit -m "release v$Version" | Out-Null
git push origin main | Out-Null
& $gh release create "v$Version" $zip --repo ch4art/art-editor --title "v$Version" --notes "可愛編輯器 v$Version"

Write-Host "完成!使用者下次開啟編輯器就會看到更新提示。桌面 zip 也更新好了。"
