param(
  [string]$Model = "yolo11n-pose.pt",
  [int]$ImgSize = 416,
  [int]$Fps = 24,
  [int]$PreviewFps = 6,
  [int]$PreviewWidth = 400,
  [int]$Camera = 0,
  [int]$Port = 8765,
  [string]$EnvRoot = "E:\game_sai_yolo_env",
  [switch]$Track,
  [switch]$AnnotatedPreview,
  [switch]$InstallDeps,
  [switch]$Show
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectRoot

# Avoid loading packages from a globally configured pip target/PYTHONPATH.
Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue
Remove-Item Env:PIP_TARGET -ErrorAction SilentlyContinue

$VenvDir = Join-Path $EnvRoot ".venv_yolo"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
if (-not (Test-Path -LiteralPath $VenvPython)) {
  New-Item -ItemType Directory -Force -Path $EnvRoot | Out-Null
  Write-Host "[step] Create YOLO Python env: $VenvDir" -ForegroundColor Cyan
  python -m venv $VenvDir
}

$pyVersion = & $VenvPython -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ([version]$pyVersion -ge [version]"3.14") {
  Write-Host "[warn] Python is $pyVersion. If dependency install fails, use Python 3.11 or 3.12." -ForegroundColor Yellow
}

if ($InstallDeps) {
  Write-Host "[step] Install/check YOLO dependencies..." -ForegroundColor Cyan
  & $VenvPython -m pip install --upgrade pip -i https://pypi.org/simple

  try {
    & $VenvPython -m pip install -r yolo_pose_bridge\requirements.txt -i https://pypi.org/simple
  } catch {
    Write-Host "[error] Dependency install failed. Try:" -ForegroundColor Red
    Write-Host "$VenvPython -m pip install ultralytics opencv-python websockets numpy -i https://pypi.org/simple" -ForegroundColor Yellow
    Write-Host "Or install Python 3.11/3.12 and retry." -ForegroundColor Yellow
    throw
  }
} else {
  & $VenvPython -c "import ultralytics, cv2, websockets, numpy" 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[step] Dependencies missing, installing once..." -ForegroundColor Cyan
    & $VenvPython -m pip install -r yolo_pose_bridge\requirements.txt -i https://pypi.org/simple
  }
}

$modelPath = Join-Path $ProjectRoot $Model
if (-not (Test-Path -LiteralPath $modelPath)) {
  Write-Host "[step] Ultralytics will download model on first run: $Model" -ForegroundColor Cyan
}

$args = @(
  "yolo_pose_bridge\yolo_pose_ws.py",
  "--model", $Model,
  "--imgsz", "$ImgSize",
  "--fps", "$Fps",
  "--preview-fps", "$PreviewFps",
  "--preview-width", "$PreviewWidth",
  "--camera", "$Camera",
  "--port", "$Port"
)

if ($Show) {
  $args += "--show"
}
if ($Track) {
  $args += "--track"
}
if ($AnnotatedPreview) {
  $args += "--annotated-preview"
}

Write-Host "[ready] Start YOLO pose service ws://127.0.0.1:$Port" -ForegroundColor Green
& $VenvPython @args
