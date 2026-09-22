$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectRoot

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw "Node.js is not installed. Install the current Node.js LTS release, then run setup.cmd again."
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    throw "npm.cmd was not found. Reinstall Node.js, then run setup.cmd again."
}

if (-not (Get-Command py.exe -ErrorAction SilentlyContinue)) {
    throw "Python Launcher was not found. Install 64-bit Python 3.11 for Windows, then run setup.cmd again."
}

Write-Host "Installing Node.js dependencies..."
& npm.cmd install --ignore-scripts
if ($LASTEXITCODE -ne 0) { throw "npm install failed." }

$runtimeRoot = Join-Path $projectRoot ".runtime"
$venvRoot = Join-Path $runtimeRoot "openfisca-venv"
$venvPython = Join-Path $venvRoot "Scripts\python.exe"
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null

if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host "Creating the Python 3.11 environment..."
    & py.exe -3.11 -m venv $venvRoot
    if ($LASTEXITCODE -ne 0) { throw "Python 3.11 environment creation failed." }
}

Write-Host "Installing OpenFisca Japan MCP..."
& $venvPython -m pip install -r (Join-Path $projectRoot "requirements-openfisca.txt")
if ($LASTEXITCODE -ne 0) { throw "OpenFisca Japan MCP installation failed." }

$envPath = Join-Path $projectRoot ".env"
if (-not (Test-Path -LiteralPath $envPath)) {
    Copy-Item -LiteralPath (Join-Path $projectRoot ".env.example") -Destination $envPath
    Write-Host "Created .env from .env.example. Add your OrcaRouter API key before starting."
}

Write-Host ""
Write-Host "Setup completed. OpenFace is optional; see README.md for its installation."
Write-Host "After editing .env, double-click start.cmd."
