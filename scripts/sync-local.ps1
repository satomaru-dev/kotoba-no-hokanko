$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$node = "C:\Users\sxxxa\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$vault = "C:\Users\sxxxa\OneDrive\保管庫"

$allowedSources = @(
  "Preferences/profile.md",
  "Preferences/lifestyle-design.md",
  "Preferences/ai-cooperation-rule.md",
  "Knowledge/essentialism.md",
  "Knowledge/imperfectionism.md",
  "Knowledge/morita-therapy.md",
  "Knowledge/mpsp-knowledge-base.md",
  "Knowledge/financial-philosophy.md",
  "Knowledge/Dictionary/ADHD.md",
  "Knowledge/Dictionary/ADHDの仕組み化.md",
  "Knowledge/Dictionary/MPSP.md",
  "Decisions/my-decisions-log.md",
  "Decisions/2026-06-02-mpsp-homepage-approach.md",
  "Decisions/2026-06-02-mpsp-fp-office-structure.md",
  "Decisions/2026-07-30-contextual-memory-concept.md",
  "Archive/Old_Inbox/プログラムの目的を理解する 自己理解プログラム 会員サイト.md",
  "Archive/Old_Inbox/Gemini/2026-02/2026-02-27-週１回の仕分けっていうのが俺の性格上どうしても無理なんだよね。よくあるinbox....md",
  "Archive/Old_Inbox/Gemini/2026-04/2026-04-07-notionのボードビューの中に、タスクをさらに複数個書くことはできるの？テキス....md",
  "Archive/Old_Inbox/Gemini/2026-04/2026-04-07-でもね、リンク集にすると「見ない」んだよ。大事なことのはずなのに、「見ることを忘....md",
  "Archive/Old_Inbox/Gemini/2026-04/2026-04-07-それか、やっぱり手書きなのかな。もはや。でもそれも続かないしな。 誉め言葉とかは....md",
  "Archive/Old_Inbox/Gemini/2026-04/2026-04-07-今の俺の問題点について話したい。生活というか日々の過ごし方の。.md",
  "Archive/Old_Inbox/Gemini/2025-12/2025-12-11-結果はちょっと変えたい # [正攻法が自分に合うやり方じゃない場合、行動が止まる....md",
  "Archive/Old_Inbox/Gemini/2025-12/2025-12-24-第1章：なぜ、繊細な私たちはブログ集客で苦しむのか？ 真面目で繊細で気遣いができ....md",
  "Archive/Old_Inbox/Gemini/2026-01/2026-01-02-この内容、なんか多すぎて重たすぎてまとまってないから困ってる。頭ン中こんがらがっ....md"
)

$env:OBSIDIAN_ROOT = $vault
$env:OBSIDIAN_INCLUDE = $allowedSources -join ","
$env:OBSIDIAN_EXCLUDE = "**/.env,**/*password*,**/*パスワード*,**/顧客/**,**/契約/**,**/金融/**"
$env:MEMORY_FILE_PATH = Join-Path $projectRoot ".data\memories.json"

& $node (Join-Path $projectRoot "dist\src\sync.js")
if ($LASTEXITCODE -ne 0) {
  throw "Contextual-memory sync failed with exit code $LASTEXITCODE"
}



