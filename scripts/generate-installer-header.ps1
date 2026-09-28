$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$outDir = Join-Path $PSScriptRoot "..\src-tauri\installer-assets"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outPath = Join-Path $outDir "header.bmp"
$bitmap = New-Object System.Drawing.Bitmap 150, 57, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.Clear([System.Drawing.Color]::White)
$black = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::Black)
$white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$graphics.FillRectangle($black, 120, 5, 7, 19)
$arrow = [System.Drawing.Point[]]@((New-Object System.Drawing.Point 108, 22),(New-Object System.Drawing.Point 139, 22),(New-Object System.Drawing.Point 123, 37))
$graphics.FillPolygon($black, $arrow)
$tray = [System.Drawing.Point[]]@((New-Object System.Drawing.Point 101, 33),(New-Object System.Drawing.Point 111, 33),(New-Object System.Drawing.Point 107, 44),(New-Object System.Drawing.Point 140, 44),(New-Object System.Drawing.Point 136, 33),(New-Object System.Drawing.Point 145, 33),(New-Object System.Drawing.Point 149, 47),(New-Object System.Drawing.Point 149, 53),(New-Object System.Drawing.Point 146, 56),(New-Object System.Drawing.Point 100, 56),(New-Object System.Drawing.Point 96, 53),(New-Object System.Drawing.Point 96, 47))
$graphics.FillPolygon($black, $tray)
$graphics.FillEllipse($white, 136, 46, 8, 8)
$graphics.Dispose(); $black.Dispose(); $white.Dispose()
$bitmap.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
$bitmap.Dispose()
Write-Host "Generated NSIS header image: $outPath"
