# favicon.svg 와 같은 심볼을 PNG로 그린다 (홈 화면 아이콘용)
#   powershell -ExecutionPolicy Bypass -File scripts/make_icons.ps1
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot '..\public'

function Draw-Icon([int]$size, [string]$name, [bool]$rounded) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.Clear([System.Drawing.Color]::Transparent)
  $k = $size / 64.0
  $brand = [System.Drawing.ColorTranslator]::FromHtml('#4B3BF5')
  $brush = New-Object System.Drawing.SolidBrush $brand
  if ($rounded) {
    $r = 16 * $k * 2
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, $r, $r, 180, 90)
    $path.AddArc($size - $r, 0, $r, $r, 270, 90)
    $path.AddArc($size - $r, $size - $r, $r, $r, 0, 90)
    $path.AddArc(0, $size - $r, $r, $r, 90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)
  } else {
    $g.FillRectangle($brush, 0, 0, $size, $size)   # iOS가 직접 둥글게 자름
  }
  $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::White), (5 * $k)
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'; $pen.LineJoin = 'Round'
  $pulse = @(@(12,36),@(21,36),@(26,24),@(34,46),@(40,32),@(44,32)) | ForEach-Object { New-Object System.Drawing.PointF ($_[0]*$k), ($_[1]*$k) }
  $g.DrawLines($pen, [System.Drawing.PointF[]]$pulse)
  $arrow = @(@(44,32),@(52,24)) | ForEach-Object { New-Object System.Drawing.PointF ($_[0]*$k), ($_[1]*$k) }
  $g.DrawLines($pen, [System.Drawing.PointF[]]$arrow)
  $head = @(@(45,24),@(52,24),@(52,31)) | ForEach-Object { New-Object System.Drawing.PointF ($_[0]*$k), ($_[1]*$k) }
  $g.DrawLines($pen, [System.Drawing.PointF[]]$head)
  $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

Draw-Icon 180 'apple-touch-icon.png' $false
Draw-Icon 192 'icon-192.png' $true
Draw-Icon 512 'icon-512.png' $true
Draw-Icon 32 'favicon-32.png' $true
Write-Output 'icons written'
