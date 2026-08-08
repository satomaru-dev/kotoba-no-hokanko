param(
  [Parameter(Mandatory = $true)] [ValidateSet('health', 'choose-folder', 'choose-files')] [string]$Operation
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Result([string]$Status, $Data = $null) {
  $result = [ordered]@{ status = $Status }
  if ($null -ne $Data) { $result.data = $Data }
  $result | ConvertTo-Json -Compress
}

try {
  if ($Operation -eq 'health') {
    Write-Result 'success'
    exit 0
  }

  if ($Operation -eq 'choose-folder') {
    $shell = New-Object -ComObject Shell.Application
    $folder = $shell.BrowseForFolder(0, '作業フォルダを選択してください', 0, 0)
    if ($null -eq $folder) { Write-Result 'cancelled'; exit 0 }
    Write-Result 'success' @{ path = $folder.Self.Path }
    exit 0
  }

  Add-Type -AssemblyName System.Windows.Forms
  $dialog = New-Object System.Windows.Forms.OpenFileDialog
  $dialog.Title = '作業フォルダへ追加するファイルを選択してください'
  $dialog.Multiselect = $true
  $dialog.CheckFileExists = $true
  $dialog.Filter = 'すべてのファイル (*.*)|*.*'
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Result 'cancelled'
    exit 0
  }
  Write-Result 'success' @{ paths = @($dialog.FileNames) }
} catch {
  Write-Result 'picker_error'
  exit 1
}
