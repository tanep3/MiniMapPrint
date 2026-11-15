# MiniMapPrint 保守・リリース手順

Voice2QR で確立した方式に揃える。

## バージョン規則

- **タグが正本**。`web/package.json` の `appVersion` は、タグから `v` を除いたものと必ず一致させる。
- **実機確認用は v0.1.0 番代、正式リリースは v1.0.0 番代**。
- 順序が大事: **appVersion を上げる → ビルドして確認 → push → そのコミットにタグを打つ**。
  タグを先に打つと、古いバージョンを名乗るビルドが公開され、アプリの更新検知が壊れる。

## リリース手順

1. `web/package.json` の `appVersion` を新しいバージョンに上げる（`version` フィールドも揃える）。
2. ローカルでビルドし、`web/site/version.json` の値と、`web/site/sw.js` に `__APP_VERSION__` の残りが無いことを確認する。
3. 変更を push する。
4. GitHub Releases から、そのコミットにタグ（例 `v0.1.0`）を打って公開する。
   タグ push で Pages ワークフロー（`.github/workflows/pages.yml`）が起動し、タグのコミットからビルドして GitHub Pages に掲載される。
5. 公開されたサイトを開き、フッターのバージョン表示が新しいことを確認する。

## 初回だけの設定（GitHub 側）

- Settings → Pages → Source を **GitHub Actions** にする。
- Settings → Environments → github-pages → Deployment branches and tags で、タグ `v*` のデプロイを許可する（Voice2QR で必要だった設定。未設定だと deploy ジョブが "not allowed to deploy" で落ちる）。

## キャッシュと更新検知の仕組み（Voice2QR の教訓）

- Service Worker のキャッシュ名は `minimapprint-<appVersion>`。
- アプリは起動時に `version.json` を `no-store` で取得し、動いているコードのバージョンと違えば一度だけ強制リロードする。
- **Cache Storage はサービスワーカーのスコープではなくオリジン単位で共有される**。キャッシュ削除は `minimapprint-` 接頭辞のものだけに限定すること（同オリジンの他アプリのキャッシュを消してはいけない。Voice2QR v1.0.4 のバグの教訓）。

## ビルド構成

- `core/`: Rust（pic2gray4px 移植）→ wasm-pack で `core/pkg/` を生成。
- `web/`: Vite + TypeScript。`npm run build` が Vite ビルドの後に `assemble-site.mjs` を実行し、WASM のコピー、`sw.js` へのバージョン刻印、`version.json` の生成まで行う。成果物は `web/site/`。
