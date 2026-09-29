$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\src-tauri\installer-assets"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outPath = Join-Path $outDir "header.bmp"

# NSIS Modern UI header bitmap: 150 x 57.
# Render at 4x and downsample to keep the small installer artwork crisp.
$targetW = 150
$targetH = 57
$scale = 4
$workW = $targetW * $scale
$workH = $targetH * $scale

$workBitmap = New-Object System.Drawing.Bitmap $workW, $workH, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($workBitmap)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.Clear([System.Drawing.Color]::White)

$black = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::Black)
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)

function SX([double]$value) { return [int][Math]::Round($value * $scale) }

# Artwork area: 40 x 40 at the far right, matching the reference placement.
# Down arrow.
$g.FillRectangle($black, (SX 120), (SX 8), (SX 6), (SX 14))
$arrow = [System.Drawing.Point[]]@(
  ([System.Drawing.Point]::new((SX 111), (SX 21))),
  ([System.Drawing.Point]::new((SX 135), (SX 21))),
  ([System.Drawing.Point]::new((SX 123), (SX 32)))
)
$g.FillPolygon($black, $arrow)

# Download tray, recreated from the high-resolution reference.
$tray = [System.Drawing.Point[]]@(
  ([System.Drawing.Point]::new((SX 107), (SX 28))),
  ([System.Drawing.Point]::new((SX 114), (SX 28))),
  ([System.Drawing.Point]::new((SX 111), (SX 36))),
  ([System.Drawing.Point]::new((SX 136), (SX 36))),
  ([System.Drawing.Point]::new((SX 133), (SX 28))),
  ([System.Drawing.Point]::new((SX 140), (SX 28))),
  ([System.Drawing.Point]::new((SX 144), (SX 40))),
  ([System.Drawing.Point]::new((SX 144), (SX 45))),
  ([System.Drawing.Point]::new((SX 141), (SX 48))),
  ([System.Drawing.Point]::new((SX 105), (SX 48))),
  ([System.Drawing.Point]::new((SX 102), (SX 45))),
  ([System.Drawing.Point]::new((SX 102), (SX 40)))
)
$g.FillPolygon($black, $tray)

# Circular detail.
$g.FillEllipse($white, (SX 134), (SX 39), (SX 7), (SX 7))

$g.Dispose()
$black.Dispose()
$white.Dispose()

# High-quality downsample to the exact NSIS header size.
$finalBitmap = New-Object System.Drawing.Bitmap $targetW, $targetH, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$g2 = [System.Drawing.Graphics]::FromImage($finalBitmap)
$g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g2.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
$g2.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g2.Clear([System.Drawing.Color]::White)
$g2.DrawImage($workBitmap, 0, 0, $targetW, $targetH)

$g2.Dispose()
$workBitmap.Dispose()

$finalBitmap.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$finalBitmap.Dispose()

Write-Host "Generated high-quality NSIS header image: $outPath"
