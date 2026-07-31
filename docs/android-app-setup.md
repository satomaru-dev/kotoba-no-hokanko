# Androidで「ことばの保管庫」を使い始める手順

コードは完成しています。ここから先は、本人の無料アカウントへ保管場所を作る作業です。秘密鍵やログインメールをCodexへ貼り付ける必要はありません。

## 全体の順番

1. Supabaseの無料プロジェクトを作る
2. データベースと暗号化APIを配置する
3. 自分のメールで一度ログインする
4. 既存の過去記録をクラウドへ移す
5. GitHub Pagesへ画面を公開する
6. Androidのホーム画面へ追加する

一度に全部進めず、一つ終わるたびにCodexへ「できた」と伝えて進めて構いません。

## 1. Supabaseプロジェクト

1. [Supabase](https://supabase.com/dashboard)を開き、無料アカウントでログインします。
2. `New project`を押します。
3. Project nameを `kotoba-no-hokanko` にします。
4. Database passwordはパスワード管理アプリへ保存します。
5. Regionは日本から近い場所を選びます。
6. Free planのまま作成します。

作成後、`Project Settings` → `API`にある次の2つを自分の手元へ控えます。

- Project URL
- anon / publishable key

`service_role key`は絶対にアプリやGitHubへ入れません。

## 2. SupabaseへDBとAPIを配置

PowerShellをプロジェクトフォルダで開きます。

```powershell
pnpm dlx supabase login
pnpm dlx supabase link --project-ref あなたのProject ID
pnpm dlx supabase db push
```

次のSecretをSupabase Dashboardの `Edge Functions` → `Secrets` へ登録します。

- `MEMORY_ENCRYPTION_KEY`: 32バイトのランダム値をBase64にしたもの
- `MEMORY_SERVICE_TOKEN`: 32バイト以上のランダムな文字列
- `MEMORY_ALLOWED_EMAILS`: 自分のログイン用メールアドレス

暗号鍵は一度決めたら変更しません。失うと保存済みの本文を読めなくなります。

続けてAPIを配置します。

```powershell
pnpm dlx supabase functions deploy memory-api --no-verify-jwt
```

## 3. PCでクラウド版を確認

`web/.env.local`を作り、次の2行だけを入れます。

```text
VITE_SUPABASE_URL=控えたProject URL
VITE_SUPABASE_ANON_KEY=控えたanon / publishable key
```

次を実行します。

```powershell
pnpm dev
```

`http://127.0.0.1:5173`を開き、自分のメールアドレスを入力します。届いたマジックリンクを開き、言葉を1件残します。

Supabase Dashboardの `Authentication` → `Users` に自分が現れたら、そのUser IDをEdge FunctionのSecret `MEMORY_OWNER_ID`として追加し、関数をもう一度配置します。

## 4. 既存の記憶を初回転送

プロジェクト直下の`.env`へ次を追加します。

```text
CLOUD_MEMORY_API_URL=https://Project ID.supabase.co/functions/v1/memory-api
CLOUD_MEMORY_SERVICE_TOKEN=登録したMEMORY_SERVICE_TOKEN
```

先に通常のローカル同期を実行してから転送します。

```powershell
pnpm sync
pnpm cloud:import
```

顧客情報・契約情報・金融情報・認証情報・`.env`は既存の除外規則で送られません。転送される本文断片、タイトル、出典はEdge Function内で暗号化されてからDBへ入ります。

## 5. GitHub Pagesで公開

1. GitHubで公開リポジトリを1つ作ります。
2. このプロジェクトをそのリポジトリへpushします。
3. リポジトリの `Settings` → `Secrets and variables` → `Actions` → `Variables` に次を登録します。
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. `Settings` → `Pages` → Sourceで `GitHub Actions`を選びます。
5. `Actions`の `Deploy PWA to GitHub Pages`を実行します。

`.github/workflows/pages.yml`がビルドと公開を自動で行います。

公開URLが決まったら、Supabase Dashboardの `Authentication` → `URL Configuration`へ移動します。

- Site URL: GitHub Pagesの公開URL
- Redirect URLs: 公開URLの末尾に`/**`を付けたもの

## 6. Androidへ置く

1. AndroidのChromeでGitHub Pagesの公開URLを開きます。
2. 自分のメールでログインします。
3. Chrome右上のメニューを開きます。
4. `アプリをインストール`または`ホーム画面に追加`を押します。
5. ホーム画面の「ことば」アイコンを開きます。

以後は、思いついた時にこのアイコンを押し、文章を書いて「残す」だけです。圏外では端末内に預かり、通信が戻ると自動送信します。

## 動作確認

- 一度だけ押して1件だけ保存される
- 改行、句読点、言葉遣いが変わっていない
- 機内モードで残し、通信復旧後に「最近」へ現れる
- 「斬新すぎるアイデア」などで過去記録を検索できる
- 手直し後も「最初に残した原文」が読める
- ゴミ箱から元へ戻せる
- Codexで同じ話をした時、スマホの記録が候補に現れる
