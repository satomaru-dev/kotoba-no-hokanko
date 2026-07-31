# ChatGPT・クラウド接続手順

## 必要な値

- pgvector対応PostgreSQLの`DATABASE_URL`
- OpenAI APIの`OPENAI_API_KEY`
- 32文字以上のランダムな`MEMORY_API_TOKEN`
- HTTPSで公開できるコンテナホスト
- Notion Integration tokenと、許可するルートページID
- Google OAuth client/refresh tokenと、許可するフォルダID

これらはリポジトリへ保存せず、ホストとPCのSecret Managerへ設定します。

## デプロイ

1. PostgreSQLで`migrations/001_init.sql`を実行する。
2. `Dockerfile`からコンテナをデプロイする。
3. `NODE_ENV=production`、`DATABASE_URL`、`OPENAI_API_KEY`、`MEMORY_API_TOKEN`を設定する。
4. `GET /health`が`ok: true`を返すことを確認する。
5. 認証なしの`POST /mcp`が401、Bearer token付きのMCP initializeが成功することを確認する。

## ChatGPT

ChatGPTのカスタムアプリでStreamable HTTP MCP URLを`https://<host>/mcp`に設定し、Bearer tokenを認証ヘッダーへ登録します。アプリ指示にはPlugin Skillと同じ発火条件・表示形式を設定します。

## Codex

ローカル検証中はPluginの`.mcp.json`がstdio版を起動します。本番公開後は同じエントリをリモートMCP URLとBearer token参照へ変更します。Pluginの再読み込みには新しいCodexタスクを開始します。

## 2週間の評価

- 役に立った記録
- 不要だった記録
- 出てこなかったが必要だった記録

だけを別途記録し、検索重みと閾値を調整します。会話自動保存と重要度更新はこの評価後まで追加しません。
