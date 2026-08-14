<#
.SYNOPSIS
README 双语结构对等检查(12 §1.2)。三仓共用,从本模板复制。

- 双文件模式(SCVB/Bridge,默认):比对 -A 与 -B 两个文件的标题骨架(层级 + 顺序),剔除代码围栏。
  标题文本不比(本来就是两种语言),只比 (层级, 序号) 序列。
- -SingleFile 模式(CLI,09 §1.4 单文件双语例外):断言同一文件里存在 ## 简体中文 锚点,
  且锚点两侧(英文侧/中文侧)的章节标题序列(层级 + 顺序)相同。

用法:
  .\check-readme-parity.ps1 -A README.md -B README.zh-CN.md
  .\check-readme-parity.ps1 -SingleFile README.md
#>
param(
  [Parameter(Mandatory = $true, ParameterSetName = 'TwoFiles')][string]$A,
  [Parameter(Mandatory = $true, ParameterSetName = 'TwoFiles')][string]$B,
  [Parameter(Mandatory = $true, ParameterSetName = 'SingleFile')][string]$SingleFile
)

function Get-HeadingSeq {
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    Write-Error "文件不存在:$Path"
    exit 1
  }
  $inFence = $false; $seq = @(); $ln = 0
  foreach ($line in (Get-Content -LiteralPath $Path)) {
    $ln++
    if ($line.TrimStart().StartsWith('```')) { $inFence = -not $inFence; continue }   # 剔围栏
    if ($inFence) { continue }
    if ($line -match '^(#{1,3})\s+(\S.*)$') {
      $seq += [pscustomobject]@{ Level = $Matches[1].Length; Text = $Matches[2]; Line = $ln }
    }
  }
  return $seq
}

if ($PSCmdlet.ParameterSetName -eq 'SingleFile') {
  # ── 单文件模式(CLI)──
  $all = Get-HeadingSeq -Path $SingleFile
  $anchorIdx = -1
  for ($i = 0; $i -lt $all.Count; $i++) {
    if ($all[$i].Level -eq 2 -and $all[$i].Text -eq '简体中文') { $anchorIdx = $i; break }
  }
  if ($anchorIdx -lt 0) {
    Write-Error "单文件模式:未找到 ## 简体中文 锚点($SingleFile)"
    exit 1
  }
  $before = @(); $after = @()
  for ($i = 0; $i -lt $all.Count; $i++) {
    if ($i -lt $anchorIdx) { $before += $all[$i] }
    elseif ($i -gt $anchorIdx) { $after += $all[$i] }
  }
  $n = [Math]::Max($before.Count, $after.Count)
  for ($i = 0; $i -lt $n; $i++) {
    $lb = if ($i -lt $before.Count) { $before[$i].Level } else { '(缺)' }
    $la = if ($i -lt $after.Count) { $after[$i].Level } else { '(缺)' }
    if ($lb -ne $la) {
      Write-Error "单文件双语两侧标题不对等 @第 $($i + 1) 个标题:英文侧层级=$lb / 中文侧层级=$la"
      exit 1
    }
  }
  Write-Output "单文件双语结构对等($SingleFile)"
  exit 0
}

# ── 双文件模式(SCVB/Bridge)──
$sa = Get-HeadingSeq -Path $A
$sb = Get-HeadingSeq -Path $B
$n = [Math]::Max($sa.Count, $sb.Count)
for ($i = 0; $i -lt $n; $i++) {
  $la = if ($i -lt $sa.Count) { $sa[$i].Level } else { '(缺)' }
  $lb = if ($i -lt $sb.Count) { $sb[$i].Level } else { '(缺)' }
  if ($la -ne $lb) {
    Write-Error "结构不对等 @第 $($i + 1) 个标题:$A 行 $(if ($i -lt $sa.Count) { $sa[$i].Line } else { '-' }) 层级=$la / $B 行 $(if ($i -lt $sb.Count) { $sb[$i].Line } else { '-' }) 层级=$lb"
    exit 1
  }
}
Write-Output "结构对等($A <-> $B)"
exit 0
