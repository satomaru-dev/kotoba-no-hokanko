import type { RawDocument } from "./types.js";

const fixture = (
  title: string,
  date: string,
  content: string,
  sourceType: RawDocument["source_type"] = "obsidian"
): RawDocument => ({
  source_type: sourceType,
  source_uri: `https://memory.example/${encodeURIComponent(title)}`,
  title,
  recorded_at: `${date}T00:00:00.000Z`,
  modified_at: `${date}T00:00:00.000Z`,
  content,
  author_role: "user",
  metadata: { fixture: true }
});

export const representativeMemories: RawDocument[] = [
  fixture(
    "週1回の仕分けはできない",
    "2026-02-27",
    "タスク管理が続かない。メモを週1回まとめて仕分けする運用は自分にはできない。頑張りが足りないのではなく、ADHD特性との相性として捉えたい。"
  ),
  fixture(
    "TODOに疑問や議事録まで混ざっている",
    "2026-04-07",
    "手書き、Goodnotes、Notion、Google Keepを気分で変える。TODOリストには行動だけでなく疑問、議事録、アイデアまで混ざり、タスク管理を何度も作り直した。"
  ),
  fixture(
    "正解ではなく相性を探したい",
    "2025-12-11",
    "一般的な正解を守るより、自分との相性を探したい。一つの方法を続けることを成功条件にすると苦しくなる。",
    "google_drive"
  ),
  fixture(
    "MPSP制作中は没頭できる",
    "2025-08-18",
    "MPSPを作るのは楽しい。教材や仕様を制作している間は深く没頭できる。構造を考えて形にする作業そのものは好きで、フロー状態になる。",
    "notion"
  ),
  fixture(
    "MPSPは集客で止まる",
    "2025-09-02",
    "MPSPの集客、SNS発信、販売を考える段階になると止まる。制作能力の問題ではなく、人に届ける不安と評価への恐れが強い。",
    "google_drive"
  ),
  fixture(
    "仕様を完成させてから動こうとしていた",
    "2026-03-20",
    "以前はMPSPの完全な仕様を決めてから公開しようとしていた。しかし今は不完全な形を出し、反応を見ながら削る方が合うと考えている。",
    "notion"
  ),
  fixture(
    "現在のOS",
    "2026-07-25",
    "今の自分はエッセンシャル思考、不完全主義、森田療法の掛け合わせをOSにする。重要な少数を選び、不完全なまま着手し、不安を消してからではなく抱えたまま目的に沿って動く。"
  ),
  fixture(
    "情報整理より再会",
    "2026-07-28",
    "すべてを整理して見返す仕組みではなく、今の悩みを話した時に以前の関連メモと再会できるAI司書がほしい。忘れてよいものの判断は本人の直感に残す。"
  ),
  fixture(
    "買い物メモ",
    "2026-07-29",
    "牛乳、卵、ティッシュを買う。帰りにドラッグストアへ寄る。"
  )
];
