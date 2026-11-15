# Third-Party Notices

MiniMapPrint 本体のライセンスは MIT License（`LICENSE`）です。
ここには、利用している第三者のデータ・ソフトウェア・サービスの権利表示をまとめます。

## 地図データ: OpenStreetMap

- 地図データ: © OpenStreetMap contributors
  - ライセンス: **Open Data Commons Open Database License (ODbL) 1.0**
  - https://www.openstreetmap.org/copyright
  - 生成した地図画像には「© OpenStreetMap contributors / ODbL」を画像内にも表示します（アプリの仕様として常時表示）
- 利用しているサービス（いずれも各利用ポリシーの範囲内で、要求された範囲だけを取得します。一括取得・プリフェッチはしません）:
  - 標準タイルレイヤー（tile.openstreetmap.org）— Tile Usage Policy
  - Nominatim（地名解決）— Nominatim Usage Policy
  - Overpass API（道路等のベクタ取得）

## pic2gray4px（変換コアの原典）

- pic2gray4px（github.com/tanep3/pic2gray4px）: MIT License, Copyright (c) 2026 Tane Channel Technology
- MiniMapPrint の変換コアは、この自作ツールのライブラリ部分（lib.rs / autotune.rs / optimizer.rs）を WASM 化したものです。同梱物ではなく同一著作権者のコードのため、本体の MIT に含まれます。

## Rust クレート（WASM コアの依存）

- 変換コアはファイル入出力と画像デコーダを持たない形に削るため、依存は最小化します
- 残る依存クレート（image 等、いずれも MIT / Apache-2.0 のデュアルライセンス系）は、リリース時に `cargo about` 等で生成した完全な一覧をこのファイルに確定版として収録します（設計段階の本書ではドラフト）

## フォント

- フォントは同梱しません。端末のシステムフォントで描画します（ライセンス上の同梱物を増やさないための設計判断。描画結果が端末により多少変わることは requirements / design に明記）
