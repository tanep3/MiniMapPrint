# MiniMapPrint 設計書

要件は `docs/requirements.md`。本書はその実装設計。
移植元は pocket-map スキル（`make_map.py` / `raster_map.py`）と pic2gray4px（Rust）。現スキルの実績ある数値・規則は、変える理由があるもの以外そのまま引き継ぐ。

## 0. 全体像

```
[入力画面] 地名×1〜2 / 縮尺スライダー / プリンタ切替（表記は「200dpi (T02等)」「300dpi (M02S等)」）
    ↓
geocode (Nominatim) → viewport 決定（メートル基準の正方形、2点は自動拡張＋通知）
    ↓ 並行
├─ 線画: Overpass でベクタ取得 → Canvas 2D で描画
└─ グレー: OSM タイルをモザイク → WASM (pic2gray4px) で 1 ビット変換
    ↓ 両スタイル共通
compose: タイトル / ピン / 凡例 / スケールバー / 北矢印 / 帰属 を変換後に重ねる
    ↓
[結果画面] 2枚を縦に並べて表示 → 選んだ方を 共有 / 保存 / 印刷
```

リポジトリ構成（Voice2QR と同じ骨格）:

```
MiniMapPrint/
├─ core/            Rust: pic2gray4px のライブラリ部を WASM 化（wasm-pack）
├─ web/             TypeScript アプリ本体（Vite なし、素の TS + esbuild 相当の簡素ビルド ※Voice2QR 方式）
│  ├─ src/          モジュール群（下記 §3）
│  ├─ public/       manifest / sw.js / version.json の雛形、アイコン
│  └─ package.json  appVersion を保持（タグと一致させる）
├─ docs/            requirements.md / design.md / maintenance.md（リリース手順）
├─ .github/workflows/pages.yml   v* タグで起動し、タグのコミットからビルドして Pages 掲載
├─ LICENSE / THIRD_PARTY_NOTICES.md / README.md
```

## 1. 動作例（エンドツーエンド）

入力: 場所1「新宿駅」、場所2「東京都庁」、縮尺 1km、プリンタ 200dpi（T02等、384×512）

1. Nominatim で2件を解決（候補が割れたら候補リストを出してユーザーが選ぶ）
2. 2点の距離から必要範囲を計算 → 2点間は約0.85km で、マージンを含めると 1km の段には収まらないため、2km の段に広げて「2点が収まる 2km に広げました」と表示する。5km でも収まらない場合は実寸で広げ、実寸（例 7.2km）を通知する
3. 線画: bbox を Overpass に投げ（highway / railway / waterway / natural=water / leisure=park の way、`out geom;`）、道路種別ごとの線幅で描く
4. グレー: ズームは「ネイティブズーム最近傍」規則で決める（この例では z15、タイル約9枚 ≤ 上限16）。モザイクを出力サイズにリサンプルし、WASM で auto 調整つき変換
5. 両方にタイトル「新宿駅 → 東京都庁」、番号ピン、凡例、スケールバー（0.5km）、北矢印、帰属を重ねて表示
6. ユーザーが線画をタップ → クローズアップ → 共有シートから Phomemo アプリへ

## 2. コア（Rust → WASM）の公開関数

pic2gray4px の `convert_with_options` が土台。ファイル入出力（`load_image` / `write_png`）と画像デコーダは捨て、ピクセルバッファを直接受ける形にする。

### `convert_rgba(rgba, width, height, options) -> result`

| 項目 | 内容 |
|---|---|
| 引数 | `rgba: Uint8Array`（width×height×4）、`width, height: number` |
| options | `contrast: number \| null`（null = auto 探索）、`unsharp: number \| null`（null = auto）、`passes: number`（既定10）、`diffusion: boolean`（既定 true） |
| 戻り値 | `{ bits: Uint8Array（1ビット詰め、行優先）, width, height, contrastUsed: number, unsharpUsed: number }` |
| エラー | 範囲外は例外で理由を返す: contrast は 0..3、unsharp は 0..2、passes は 0..10、空画像は不可（Rust 側の検証をそのまま使う） |
| 注意 | 2×2 セルの都合で出力寸法は偶数に切り上がる。呼び出し側が元の寸法に切り戻す（現スキルのアダプタと同じ扱い） |

auto の探索（完成画像を採点して contrast / unsharp を選ぶ）は autotune.rs / optimizer.rs がそのまま担う。アプリ側は「auto で呼ぶ」だけ。

## 3. Web アプリのモジュール

### `geocode.ts` — 地名解決
- `searchPlace(query: string): Promise<Place[]>` — Nominatim `search?format=jsonv2&limit=8`、国コードは端末ロケール既定（日本利用が主なら jp を初期値にし、設定で外せる）
- `Place = { lat, lon, label, displayName }`
- 現スキルの規則を引き継ぐ: 上位候補の重要度が拮抗したら曖昧として候補を返す。「駅」を含む検索で駅そのものが取れなければ、その旨と近傍候補を返す
- エラー: 0件 → `NotFound`、曖昧 → `Ambiguous(candidates)`。UI は候補リストで選ばせる

### `viewport.ts` — 表示範囲の決定（純粋関数、テスト対象）
- `computeViewport(places: Place[], scaleKm: number, outW: number, outH: number): Viewport`
- `Viewport = { south, west, north, east, actualKm, expandedToKm: number | null }`
- 規則: 地図領域は正方形（出力の地図ボックスが正方形のため）。範囲はメートル基準で actualKm × actualKm
  - 1点: その点を中心に scaleKm 四方
  - 2点: 両点を含む最小の正方形 ＋ 各辺 12.5% マージン（現スキル）。それが scaleKm を超えたら、スナップ段（0.5/1/2/3/4/5km）のうち収まる最小の段まで広げ、`expandedToKm` にその段を入れる。5km でも不足なら実寸を使い `expandedToKm` に実寸を入れる
- 緯度で経度幅を補正する（1km の経度換算は cos(lat) で変わる）。投影は Web Mercator

### `overpass.ts` — ベクタ取得
- `fetchWays(vp: Viewport): Promise<Way[]>` — `Way = { tags: Record<string,string>, geometry: {lat, lon}[] }`
- クエリは現スキルと同一: `[out:json][timeout:40];(way["highway"](bbox);way["railway"](bbox);way["waterway"](bbox);way["natural"="water"](bbox);way["leisure"="park"](bbox););out geom;`
- POST は `application/x-www-form-urlencoded`（プリフライト回避）
- エンドポイントは現スキルと同じ順でフォールバック: `overpass.private.coffee` → `overpass-api.de`。429 / タイムアウトは次へ、全滅ならエラー表示

### `tiles.ts` — タイル取得とモザイク
- `planTiles(vp, outW, outH): { zoom, tiles: {x, y}[] }`
  - ズーム規則は現スキル踏襲: 出力ピクセルとタイルピクセルの対応が最も近い「ネイティブズーム」を選ぶ（`round(log2(...))`、上限 z19）
  - タイル数は最大16。超える場合はズームを下げて収める（現スキルはエラーにしていたが、Web では体験優先で自動調整し、その旨を内部ログに残す）
- `fetchMosaic(plan, vp, outW, outH): Promise<ImageData>` — タイルを並べ、範囲に合わせて切り出し・リサンプル（Canvas の drawImage、スムージング有効。現スキルは BICUBIC で実質等価）
- 取得は `crossOrigin="anonymous"`。失敗タイルは白で埋めて警告を出す（全滅ならエラー）

### `render_line.ts` — 線画描画
- `renderLine(ways: Way[], vp: Viewport, ctx, box): void`
- 描画規則は現スキルの移植:
  - 道路線幅テーブル（highway 値 → ドット数、384幅基準）: motorway 7 / trunk 7 / primary 6 / motorway_link・trunk_link 5 / secondary 5 / primary_link・secondary_link 4 / tertiary 4 / tertiary_link 3 / unclassified・residential 3 / service・living_street・track 2。歩行系（footway, path, pedestrian, steps, cycleway 等）は破線 1
  - 細い道の間引き: actualKm ≥ 3 では線幅1以下の道は描かない（現スキルの閾値規則）
  - 水系（waterway / natural=water）は線幅 2（2km 以下）または 1、公園（leisure=park）は 1
  - 鉄道（rail, subway, light_rail, tram, narrow_gauge）は線幅 4（3km 未満）または 2、白の破線を重ねて枕木表現
  - 線幅は出力幅に比例させる（M02S では ×1.5）

### `render_gray.ts` — グレー版
- `renderGray(mosaic: ImageData): Promise<{ bits, width, height, contrastUsed, unsharpUsed }>`
- WASM の `convert_rgba` を auto（contrast/unsharp とも null）で呼ぶだけ。使われた実効値を返すのは、将来の手動調整 UI とデバッグのため

### `compose.ts` — 仕上げ合成（両スタイル共通、変換の後に描く）
- `compose(base: CanvasImageSource, places, vp, outW, outH, title: string): HTMLCanvasElement`
- レイアウトは 384×512 基準の定数を `s = outW / 384` で比例拡大する:
  - 地図ボックス: (6, 49)〜(378, 421) ×s、枠線 1×s
  - タイトル: 左上 (9, 6)、「A → B」形式、フォントは太字・開始 22×s から幅 364×s に収まるまで縮小（最小 12×s、入りきらなければ末尾を … で切る）
  - ピン: 白丸 r12 / 黒丸 r8 / 白丸 r3（×s）。2点目は四角版。2点が 30×s px 以内なら合体ピン＋「1+2」
  - 凡例（2点時）: 地図下部に「1  ラベル」「2  ラベル」
  - スケールバー: 実距離の 0.1km（actualKm ≤ 1）/ 0.5km（≤ 5）/ 1km（≤ 10）/ 2km（それ以上）
  - 北矢印: 右下に三角形＋「N」
  - 帰属: 左下に「© OpenStreetMap contributors / ODbL」（常時・削除不可）
- ピンや文字を変換後に描くのは、ディザで崩さずクッキリ読ませるため（現スキルの設計判断を踏襲）

### `export.ts` — 出力
- `toPngBlob(canvas): Promise<Blob>` — Canvas の PNG。そのまま保存・共有・印刷に使う
- `shareImage(blob, filename)` — `navigator.share({ files })`。非対応環境では保存にフォールバック
- `printImage(canvas)` — 印刷専用ビューに画像だけを置き、`@page { size: 48mm auto; margin: 0 }`、画像幅 48mm で `window.print()`

### `i18n.ts` / `pwa.ts` / `main.ts`
- i18n: ja / en の辞書、既定は `navigator.language`、切替は設定に保持（Voice2QR と同じ方式）
- PWA: manifest + Service Worker。キャッシュ名は `minimapprint-<appVersion>`。起動時に version.json を照合し、不一致なら一度だけ強制リロード（Voice2QR の仕組みを移植）。**キャッシュ削除は `minimapprint-` 接頭辞のみ**（Cache Storage はオリジン共有のため）
- main: 画面遷移（入力 → 生成中 → 結果 → クローズアップ）と状態保持。生成は線画とグレーを並行に走らせ、先に終わった方から表示する

## 4. エラー方針

| 場面 | 振る舞い |
|---|---|
| 地名が見つからない | エラー文＋入力を保持して再入力可能に |
| 地名が曖昧 | 候補リストを提示し、選ばせる（勝手に決めない） |
| Overpass 全滅 / 429 | 線画だけ失敗としてグレーは表示し、線画欄に再試行ボタンを出す |
| タイル全滅 | グレーだけ失敗として線画を表示 |
| WASM 読み込み失敗 | グレーは失敗扱い、線画は使える |
| オフライン | アプリ外枠は開くが、生成はオンライン必須である旨を表示 |

片方のスタイルが落ちてももう片方は出す。両方揃うのが通常形だが、片方でも地図は成立つため。

## 5. ライセンス構成

- 本体: MIT License（Copyright (c) 2026 Tane Channel Technology）— `LICENSE`
- 第三者表示: `THIRD_PARTY_NOTICES.md`（OSM / ODbL、pic2gray4px、Rust クレート）
- ODbL 対応は二重にする: 生成画像の中に帰属を焼き込む（compose の責務）＋ アプリ内「このアプリについて」にも表示
- フォントは同梱しない（システムフォント）。代償として端末ごとに字形が多少変わることを受け入れる

## 6. 実装順序

1. **M1 骨格**: リポジトリ構成、Pages ワークフロー（タグ駆動）、PWA 外枠、バージョン照合、i18n の器
2. **M2 線画**: geocode → viewport → Overpass → render_line → compose → 保存まで一本通す
3. **M3 グレー**: core の WASM 化（pic2gray4px 移植＋テスト）、tiles → render_gray、両スタイル表示
4. **M4 出力導線**: 共有シート、クローズアップ、PC 印刷レイアウト
5. **M5 仕上げ**: エモいデザイン適用、エラー文言、実機確認（バージョンは v0.1.0 番代で回し、正式リリースで v1.0.0 を切る）

## 7. 受け入れ条件

- 現スキルと同じ場所・同じ縮尺で、線画の道路構成とピン位置が目視で一致する
- グレー版が pic2gray4px CLI の出力（auto）と実質同じ見た目になる（同一コアなので当然だが、WASM 移植の検証として CLI と並べて確認する）
- 2点・拡張通知・凡例が要件どおりに出る
- iPhone Safari と Android Chrome で生成→共有→保存ができる
- 帰属表示が全ての出力に含まれる

## 8. 設計判断と理由（後置）

- **pic2gray4px は TS に書き直さず WASM 移植**: CLI とバイト単位で同じ変換結果が保証でき、auto 調整も一緒についてくる。書き直しは二重管理と結果の乖離を生む
- **サーバを持たない**: Nominatim / Overpass / タイルはいずれも CORS 許可を実測済み（requirements 参照）。静的ホスティングだけで完結する
- **合成は変換後**: ピン・タイトル・スケールバーは情報の本体なので、ディザ変換の対象にしない。現スキルで実証済みの判断
- **ズームはネイティブ最近傍**: 拡大縮小の劣化を最小にし、タイル数も抑える。現スキルの規則をそのまま採用
- **受け入れたトレードオフ**: ①フォント非同梱ゆえ端末で字形が変わる（ライセンスと容量を優先）②タイル16枚超はズームを下げてでも成立させる（現スキルの「エラーで止める」より体験優先に倒した）③PNG は Canvas 標準出力（真の1ビット PNG ではないが、画素値は2値のみ。Phomemo アプリ／CUPS の取り込みに問題はない見込みで、実機到着時に確認する）
