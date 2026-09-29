$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\src-tauri\installer-assets"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outPath = Join-Path $outDir "header.bmp"

# NSIS Modern UI header bitmap: 150 x 57.
# The artwork is intentionally compact and right-aligned to match the
# original green installer icon position/scale, but with a white background.
$bitmap = New-Object System.Drawing.Bitmap 150, 57, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::White)

$black = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::Black)
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)

# 40 x 40 visual area positioned at the far right, matching the reference.
# Download arrow.
$graphics.FillRectangle($black, 120, 9, 6, 14)
$arrow = [System.Drawing.Point[]]@(
  (New-Object System.Drawing.Point 112, 21),
  (New-Object System.Drawing.Point 134, 21),
  (New-Object System.Drawing.Point 123, 31)
)
$graphics.FillPolygon($black, $arrow)

# Download tray.
$tray = [System.Drawing.Point[]]@(
  (New-Object System.Drawing.Point 108, 28),
  (New-Object System.Drawing.Point 114, 28),
  (New-Object System.Drawing.Point 111, 36),
  (New-Object System.Drawing.Point 136, 36),
  (New-Object System.Drawing.Point 133, 28),
  (New-Object System.Drawing.Point 139, 28),
  (New-Object System.Drawing.Point 143, 40),
  (New-Object System.Drawing.Point 143, 45),
  (New-Object System.Drawing.Point 140, 48),
  (New-Object System.Drawing.Point 106, 48),
  (New-Object System.Drawing.Point 103, 45),
  (New-Object System.Drawing.Point 103, 40)
)
$graphics.FillPolygon($black, $tray)

# Small circular detail from the supplied icon.
$graphics.FillEllipse($white, 134, 39, 6, 6)

$graphics.Dispose()
$black.Dispose()
$white.Dispose()

$bitmap.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$bitmap.Dispose()

Write-Host "Generated NSIS header image: $outPath"
