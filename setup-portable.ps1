$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js is required. Install Node.js, reopen PowerShell, and run this script again."
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "npm is required. Install Node.js with npm, reopen PowerShell, and run this script again."
}

Write-Host "Installing locked dependencies..."
npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

$draftData = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot "data\draft") -Filter "g*-six-team.json" -File
if ($draftData.Count -ne 6) { throw "Portable dynasty data is incomplete: expected six generation files" }

Write-Host "Compiling and installing G1 sandbox data..."
npm run sandbox -- --input data/sandbox/g1.json --out output/g1/recompiled-current --install --no-save
if ($LASTEXITCODE -ne 0) { throw "G1 sandbox installation failed" }

Write-Host "Compiling and merging G2 sandbox data..."
npm run sandbox -- --input data/sandbox/g2.json --out output/g2/recompiled-current --install --no-save
if ($LASTEXITCODE -ne 0) { throw "G2 sandbox installation failed" }

Write-Host "Running the complete test suite..."
npm test
if ($LASTEXITCODE -ne 0) { throw "Test suite failed" }

Write-Host "Running the portable sandbox smoke battle..."
npm run simulate -- --teamA output/g1/recompiled-current/team.export.txt --teamB output/g2/recompiled-current/team.export.txt --format gen9mythicmonssandbox --no-validate --ai search --games 1 --maxTurns 200 --out output/portable-smoke
if ($LASTEXITCODE -ne 0) { throw "Portable smoke battle failed" }

Write-Host "Portable setup completed successfully."
