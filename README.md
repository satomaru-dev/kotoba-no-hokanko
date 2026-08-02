# ことばの保管庫 / Contextual Memory

> 思いついた言葉を投げるだけで、自分の言葉と温度を保ったまま蓄積され、必要な時に過去のアイデアと再会できる場所

Androidのホーム画面から使える個人用PWAと、ChatGPT/Codexから同じ記憶を検索するMCPサービスです。

## できること

- 大きな入力欄へ書き、「残す」を押すだけで原文を保存
- 関連しそうな過去の記録を近い順に最大10件提示
- 通信がない時はIndexedDBへ預かり、復旧後に自動送信
- 最近の記録、自然文検索、編集履歴、30日間のゴミ箱
- スマホで残した記録をMCPの`recall_related`から検索
- 顧客情報、契約情報、金融情報、認証情報、`.env`を索引対象外にする

初版では有料AI APIを使いません。日本語n-gramを秘密鍵付きでハッシュ化し、意味の近さと語句の重なりを検索します。

## ローカルで確認する

```powershell
pnpm install
pnpm build
pnpm start
```

ブラウザで `http://127.0.0.1:8787` を開きます。ローカル版ではクラウド認証を省略し、`.data/captures.json`へ保存します。保存した内容は同時に既存のローカル記憶索引へ入り、Codexから検索できます。

開発時は次を実行します。

```powershell
pnpm dev
```

画面は `http://127.0.0.1:5173`、APIは `http://127.0.0.1:8787` です。

## クラウド構成

- フロントエンド: React + TypeScript + Vite PWA
- 認証・DB・API: Supabase Auth / Postgres + pgvector / Edge Functions
- 静的配信: GitHub Pages
- 暗号化: AES-256-GCM
- 検索索引: HMAC-SHA-256によるブラインドトークンと1536次元ハッシュベクトル

本人向けの具体的な公開手順は [Androidアプリ公開手順](docs/android-app-setup.md) にあります。

## 主なコマンド

```powershell
pnpm test          # 保存・検索・MCP・オフラインキューのテスト
pnpm build         # サーバーとPWAのビルド
pnpm sync          # 許可済みローカル資料の差分索引
pnpm cloud:import  # ローカル索引を暗号化クラウドへ初回転送
```

クラウド接続後は`.env`へ`CLOUD_MEMORY_API_URL`と`CLOUD_MEMORY_SERVICE_TOKEN`を設定すると、既存のCodex MCPもスマホと同じ検索APIを使います。

## プライバシー

- クラウドDBには本文、タイトル、出典を平文で置きません。
- 暗号鍵とサービス間トークンはSupabase Edge FunctionのSecretにだけ置きます。
- 原文は不変です。手直しは別履歴として保存します。
- APIは本文をログ出力しません。
- `src/security.ts`の拒否規則と各同期元のallowlistを通過した資料だけを取り込みます。
