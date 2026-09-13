# Regenerate resources/icon.ico from resources/icon.png with clean, standard frames.
# Root cause being fixed: old ico had corrupt 24x24 frame (near-zero alpha) and
# non-standard AND-mask row sizes in 24/48 frames -> taskbar (AUMID -> shortcut ->
# exe embedded icon, small frame) rendered blank; NSIS installer icon also broken.
# New ico: BMP frames 16/20/24/32/48/64 (32bpp straight alpha, bottom-up, standard
# 4-byte-padded AND mask) + PNG frames 128/256. Bicubic resampling from 256px source.
Add-Type -AssemblyName System.Drawing

$srcPath = Join-Path $PSScriptRoot "..\resources\icon.png"
$outPath = Join-Path $PSScriptRoot "..\resources\icon.ico"
$src = [System.Drawing.Image]::FromFile($srcPath)
Write-Output "source: $srcPath $($src.Width)x$($src.Height)"

function New-ResizedBitmap([System.Drawing.Image]$image, [int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.DrawImage($image, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)), 0, 0, $image.Width, $image.Height, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  return $bmp
}

function Get-XorData([System.Drawing.Bitmap]$bmp) {
  $s = $bmp.Width
  $rect = New-Object System.Drawing.Rectangle(0, 0, $s, $s)
  $bd = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $xor = New-Object byte[] ($s * $s * 4)
  $rowBytes = $s * 4
  for ($y = 0; $y -lt $s; $y++) {
    $ptr = [IntPtr]::Add($bd.Scan0, $y * $bd.Stride)
    $row = New-Object byte[] $rowBytes
    [System.Runtime.InteropServices.Marshal]::Copy($ptr, $row, 0, $rowBytes)
    # ICO BMP frames are bottom-up; memory layout is BGRA which matches ICO XOR format
    [Array]::Copy($row, 0, $xor, ($s - 1 - $y) * $rowBytes, $rowBytes)
  }
  $bmp.UnlockBits($bd)
  return $xor
}

$frames = @()  # each: @{ width; data }

foreach ($size in @(16, 20, 24, 32, 48, 64)) {
  $bmp = New-ResizedBitmap $src $size
  $xor = Get-XorData $bmp
  $bmp.Dispose()
  $andRowBytes = (($size + 31) -shr 5) -shl 2   # 1bpp rows padded to 4 bytes
  $and = New-Object byte[] ($andRowBytes * $size) # all zero = alpha channel decides
  $hdr = New-Object byte[] 40
  [BitConverter]::GetBytes([uint32]40).CopyTo($hdr, 0)
  [BitConverter]::GetBytes([int32]$size).CopyTo($hdr, 4)
  [BitConverter]::GetBytes([int32]($size * 2)).CopyTo($hdr, 8)  # bottom-up, height doubled (XOR+AND)
  [BitConverter]::GetBytes([uint16]1).CopyTo($hdr, 12)
  [BitConverter]::GetBytes([uint16]32).CopyTo($hdr, 14)
  [BitConverter]::GetBytes([uint32]($xor.Length + $and.Length)).CopyTo($hdr, 20)
  $data = New-Object byte[] (40 + $xor.Length + $and.Length)
  [Array]::Copy($hdr, 0, $data, 0, 40)
  [Array]::Copy($xor, 0, $data, 40, $xor.Length)
  [Array]::Copy($and, 0, $data, 40 + $xor.Length, $and.Length)
  $frames += @{ width = $size; data = $data }
  Write-Output ("BMP frame {0}x{0}: {1} bytes" -f $size, $data.Length)
}

foreach ($size in @(128, 256)) {
  $bmp = New-ResizedBitmap $src $size
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  $frames += @{ width = $size; data = $ms.ToArray() }
  $ms.Dispose()
  Write-Output ("PNG frame {0}x{0}: {1} bytes" -f $size, $frames[-1].data.Length)
}
$src.Dispose()

# assemble ico
$count = $frames.Count
$msOut = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter($msOut)
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$count)
$offset = 6 + 16 * $count
foreach ($f in $frames) {
  $b = $f.width -band 0xFF
  $w.Write([byte]$b)            # width (0 means 256)
  $w.Write([byte]$b)            # height
  $w.Write([byte]0)             # palette
  $w.Write([byte]0)             # reserved
  $w.Write([uint16]1)           # planes
  $w.Write([uint16]32)          # bpp
  $w.Write([uint32]$f.data.Length)
  $w.Write([uint32]$offset)
  $offset += $f.data.Length
}
foreach ($f in $frames) { $w.Write($f.data) }
$w.Flush()
[System.IO.File]::WriteAllBytes($outPath, $msOut.ToArray())
$w.Dispose()
Write-Output "written: $outPath ($($msOut.Length) bytes, $count frames)"
