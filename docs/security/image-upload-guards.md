# Admin 画像アップロード検査（Issue #458）

`/admin/images` のリアクション画像アップロードが「宣言された content-type」
だけを検査していた状態を置き換え、次の契約を守る。

- 検査本体: `assertImageUploadPolicy`（`src/http/reactions/images.ts`）
- admin 側の呼び出し: `uploadReactionImageImpl`（`src/admin/images/load.ts`）
- 失敗表示: `src/admin/images/upload-errors.ts`
- 検証スイート: `test/integration/upload-guards.test.ts`
- 検証レポート: `docs/verification/security/image-upload-guards.png`
  （`pnpm run verification:image-upload-guards` で再生成）

## なぜ宣言だけでは足りないか

`contentType` は wire 上の文字列であり、利用者が自由に決められる。宣言だけを
検査すると、本文がテキスト / HTML / ZIP / SVG のまま `image/png` を名乗る物体が
保存され、`GET /api/v1/reaction-images/:id` がその宣言どおりの `Content-Type` で
返す。ブラウザはそれを「壊れた画像」または（中身の SVG / HTML の場合は）能動的
コンテンツとして扱いうる。宣言と実体の**一致**を要求することが、この境界の
本質的な防御である。

## 検査順序（安い順）

`assertImageUploadPolicy` は次の順で検査し、最初の違反で `ImagePolicyError`
（`code` 付き）を投げる。どの検査も D1 / R2 を触る前に終わる。

| # | 検査 | 失敗コード | 理由 |
| --- | --- | --- | --- |
| 0 | ファイル名 | `invalid_filename` | 文字列のみ。`/`・`\`・`..`・`.`・前後空白・制御文字（C0 / DEL）・UTF-8 で 255 byte 超を拒否 |
| 1 | 宣言 MIME | `unsupported_content_type` | `image/png` / `image/jpeg` / `image/webp` / `image/gif` のみ。`image/svg+xml` はここで拒否 |
| 2 | サイズ | `oversize` | 256 KiB（`MAX_IMAGE_BYTES`）上限。境界値は許可 |
| 2' | 空 | `empty_payload` | 0 byte |
| 3 | 署名 | `svg_not_allowed` / `unrecognized_signature` / `content_type_mismatch` | 先頭バイトを実体として判定し、宣言と一致することを要求 |

署名判定は `sniffImageContentType` が行う（デコードはしない）。

| 署名 | 判定 |
| --- | --- |
| `89 50 4E 47 0D 0A 1A 0A` | `image/png` |
| `FF D8 FF` | `image/jpeg` |
| `GIF87a` / `GIF89a` | `image/gif` |
| `RIFF` かつ offset 8 が `WEBP` | `image/webp` |
| 先頭 1 KiB に `<svg`（BOM / 空白 / XML prolog を許容） | `image/svg+xml`（常時拒否） |
| それ以外 | なし → `unrecognized_signature` |

`image/svg+xml` を宣言した場合は検査 1 で、SVG 本体を `image/png` と宣言した場合は
検査 3 の `svg_not_allowed` で拒否する。宣言側と実体側で二重に拒否するのは意図的で、
片方だけ通る経路を残さないためである。

## ファイル名は「検査するが、使わない」

ファイル名はクライアントが自由に作れる文字列であり、次の理由から R2 key にも
D1 行にも使われない。

- R2 key は `reactions/<sha256-hex>.<ext>` として、内容ハッシュと固定の拡張子表
  （`EXT_BY_CONTENT_TYPE`）だけで生成される（`buildR2Key`）。
- 保存される列は `content_hash` / `content_type` / `size` / `r2_key` /
  `uploaded_by` / `uploaded_at` のみで、元ファイル名は残る場所がない。

それでも不正な名前（トラバーサル試行、制御文字注入）を**黙って無視しない**。
`invalid_filename` を返すことで意図が観測できる状態にする。正当な日本語名・
空白を含む名前は許可する（許可と拒否の境界はトラバーサルと制御文字であり、
スクリプト種別ではない）。

## admin サーバ関数側の追加検査

`uploadReactionImageImpl` は wrapper（`createServerFn`）の外に切り出されている。
TanStack Start の AsyncLocalStorage が無いため workerd テストから直接呼べない
wrapper を避けつつ、**保存可否を決める処理だけをテスト可能にする**ための分割
（`src/admin/keys/load.ts` と同じ形）。

- base64 の**エンコード済み長**を decode 前に検査する。256 KiB を超える本体は、
  デコード済みバッファを作らずに `oversize` で拒否される。
- `ImagePolicyError` はサーバログにコードと理由を残し、クライアントへは
  `image_policy:<code>` という固定文字列だけを返す。
- 上限値と許可 MIME は `src/http/reactions/schema.ts` から import する。
  admin 側のローカル定数は持たず、UI・server function・upload policy が同じ
  1 か所を参照する。

## 安全な失敗表示

`describeUploadFailure`（`src/admin/images/upload-errors.ts`）だけが UI に
表示される文を返す。既知のコードは日本語の固定文、未知の失敗は汎用の 1 文に
落ちる。生のサーバーメッセージを DOM に出さないのは、拒否理由が bucket 名・SQL・
スタック断片を含む可能性があるためである。生の値はブラウザコンソールにのみ出る
（運用者向けの調査用）。

アップロードと削除の両方が `role="alert"` で表示する。削除側は以前 unhandled
rejection として throw しており、`image_referenced` が UI に届かなかった。

## 検証方法

```bash
pnpm exec vitest run test/integration/upload-guards.test.ts   # 判定表
pnpm run verification:image-upload-guards                     # レポート再生成
```

スイートは 30 ケースを実測し、判定表をマーカー区切りで標準出力に印字する。
`scripts/capture-image-upload-guards-report.mjs` がその出力を HTML に
レンダリングして Chromium で撮影するため、コミットされる PNG は手書きの主張
ではなく、このスイートの再生成である。撮影前に credential らしき行があれば
描画を中断する。

スイートが証明すること:

- 実 PNG / JPEG / WebP / GIF（GIF87a・GIF89a）が登録され、key が
  `reactions/<sha256>.<ext>` になる。
- テキスト / HTML / ZIP / SVG を png と申告した「偽画像」が拒否される。
- GIF を png と申告するなどの署名と宣言の不一致が拒否される。
- 256 KiB 超と 0 byte が拒否され、境界値は登録される。
- traversal・制御文字・長すぎる名前が拒否され、妥当な日本語名でも key に
  影響しない。
- 拒否された要求は D1 行も R2 オブジェクトも**増やさない**（副作用がない）。
- スイートは Miniflare のローカル D1 / R2 と手書きバイト fixture だけで動き、
  外部サービス・認証済みブラウザ・本番リソースを必要としない。ガード実装と
  テストが同時に land するため、無防備な状態で公開される区間が無い。

## 既知の制約

- 署名検査は先頭バイトの比較であり、画像のデコードや構造検証（壊れた PNG、
  中間領域の実行可能データ等）は行わない。ポリシーの目的は「宣言と実体の
  不一致を拒否する」ことであり、デコード検証は範囲外とする。
- 本番 D1 / R2 に対する確認は行っていない。ローカル workerd の Miniflare
  binding で契約を確認している（`docs/security.md`
  「Test scope: local workerd vs real Cloudflare」参照）。
- 1 ファイル 256 KiB という上限自体は 0.1.0 Foundation からの継続値であり、
  本 Issue では変更していない。上限を変える場合は `MAX_IMAGE_BYTES` と
  この文書を同時に更新する。