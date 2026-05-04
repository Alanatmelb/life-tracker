# Generates placeholder PNG icons for the Life Tracker PWA.
# Re-run this script to regenerate after editing sizes/colors.
# Output: icon-192.png, icon-512.png, apple-touch-icon.png (180x180)

Add-Type -AssemblyName System.Drawing

function New-IconPng {
    param(
        [int]$Size,
        [string]$OutPath,
        [string]$Letter = "L",
        [string]$Hex = "#0A84FF"
    )

    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

    $r = [byte][Convert]::ToInt32($Hex.Substring(1,2), 16)
    $gC = [byte][Convert]::ToInt32($Hex.Substring(3,2), 16)
    $b = [byte][Convert]::ToInt32($Hex.Substring(5,2), 16)
    $bg = [System.Drawing.Color]::FromArgb($r, $gC, $b)
    $bgBrush = New-Object System.Drawing.SolidBrush($bg)
    $g.FillRectangle($bgBrush, 0, 0, $Size, $Size)

    $fontSize = [int]($Size * 0.55)
    $font = New-Object System.Drawing.Font("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = New-Object System.Drawing.RectangleF(0, 0, $Size, $Size)
    $g.DrawString($Letter, $font, $textBrush, $rect, $sf)

    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $g.Dispose()
    $bmp.Dispose()
    $bgBrush.Dispose()
    $textBrush.Dispose()
    $font.Dispose()
}

$here = Split-Path -Parent $MyInvocation.MyCommand.Path

New-IconPng -Size 192 -OutPath (Join-Path $here "icon-192.png")
New-IconPng -Size 512 -OutPath (Join-Path $here "icon-512.png")
New-IconPng -Size 180 -OutPath (Join-Path $here "apple-touch-icon.png")

Write-Host "Generated 3 icons in $here"
