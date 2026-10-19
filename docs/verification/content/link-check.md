# 公開前のリンク・画像検証（Issue #434）

> 対象 obligation: 公開コンテンツ（`public/**` の HTML と Portfolio の Markdown）。
> 判定する場所: `scripts/check-content-links.mjs` + `scripts/_content-links.mjs`。
> CI fixture: `scripts/check-content-links.test.mjs`。
> 検証成果物: [`link-check-report.webp`](./link-check-report.webp)。

このゲートは「公開してよいか」を決めない。**参照が解決できるか**だけを判定し、
公開判断と文章の意味は content owner に残す。Issue の完了条件にある
「元の意味・数値・否定・権限を守り、未確定な推敲を勝手に公開しない」は、
ここでは「検査器が本文を 1 文字も書き換えない」こととして実装している。

## 0. 3 つの主張を混ぜない

| 主張 | このゲート | 保証しないこと |
| --- | --- | --- |
| **参照の安全性**（危険な scheme を公開しない） | 禁止 scheme・資格情報・private host を error にする | 第三者の URL の中身が安全であること |
| **参照の解決**（内部 URL が存在する） | 公開ファイル / route / fragment / 画像 src を照合する | リンク先の文章が正しいこと |
| **文章品質 / タイポグラフィ** | **判定しない。** 本文を読まず、書き換えない | 誤字・数値・否定・権限の正しさ |

文章品質は原稿を書いた人と review の責務であり、リンク検査はそれを代替しない。
[`markdown-format.md`](../../portfolio/markdown-format.md) と同じく、
locale はここでは推論も適用もしない: smart quote、禁則処理、翻訳、`lang` の
補完は行わず、locale が必要な機能は消費側が別 Issue で明示的に opt-in する。
パスの比較にも `normalize()` を使わない（表示本文と URL の分離は Issue #433）。

## 1. 何を走査するか

| 種別 | 対象 | 根拠 |
| --- | --- | --- |
| HTML | `public/**/*.html` | Static Assets がそのまま配信する公開文書 |
| Markdown | `src/portfolio/seed.ts` の `*Md` フィールド | `/portfolio/<slug>` の本文 |
| リンク | `src/portfolio/seed.ts` の `links[].url` | `/portfolio/<slug>` の外部リンク |
| 画像 | HTML の `<img>` と Markdown の `![alt](url)` | 公開される画像参照 |
| 画像 alt | `src/portfolio/seed.ts` の `media[].alt` | R2 key は URL ではないため alt のみ検証 |

`docs/**` と `skills/**` は repository の内部文書であり、公開 surface ではないため
対象外。Tool submodule の checkout も対象外（それぞれの repository が自身の
content を所有し、境界は `publication-surface.mjs` が監査する）。

## 2. severity の境界

| 判定 | 例 | release |
| --- | --- | --- |
| **error** | 内部リンク / 画像 src の 404、`javascript:` などの禁止 scheme、TAB / LF / CR などの制御文字で難読化された scheme（`java&#9;script:`）、資格情報入り URL、private / loopback host、alt 属性の欠落 | **fail** |
| **warning** | 外部ホストの timeout / 到達不能 / 5xx、`http:` の外部リンク、`href="#"`、空 alt、空の画像 src、runtime が src を供給する画像 | 止めない |
| **info** | 外部リンク・非 HTTP target の記録 | 影響なし |

外部リンクは CI（`validate:fast`）では **dereference しない**。
`validate:fast` は offline・read-only であり、第三者の障害でこの repository の
release を止めてはいけない。明示的に `--external` を渡したときだけ live 検査を行い、
その結果はすべて warning になる。これは Issue の「外部サービスが落ちた場合は
warning に区分する」「内部 404 と外部 timeout を区別する」をそのまま満たす。

`--external` でも、private / loopback host（cloud metadata の `169.254.169.254` を含む）と
資格情報入り URL は dereference しない。これらは既に error であり、検査器自身を
SSRF の踏み台にしないための防御でもある。redirect は自動追従せず（`redirect: 'manual'`）、
3xx は `W105 external-http-status` の warning として reviewer に返す。

host の判定はブラウザが同じ宛先として扱う綴りを正規化してから行う。末尾のドット
（`localhost.` / `127.0.0.1.`）を除き、IPv6 の bracket / zone / port を外し、
IPv4-mapped IPv6（`::ffff:0:0/96`、例 `[::ffff:a9fe:a9fe]` = `169.254.169.254`）は
埋め込み IPv4 として判定する。これにより metadata endpoint を別表記で書いた
リンクも error / 非 dereference になる。

```
pnpm run content:links:check
pnpm run content:links:check -- --external --external-timeout 5000
```

## 3. 内部リンクの解決

- 解決には WHATWG `URL` を使う。`..` / `.` / query / percent-encoding は
  browser と同じ挙動で扱う。
- リンク先の候補は「公開ファイル」と「route 宣言から生成した URL」の 2 つ。
  route は `publication-surface.mjs#SURFACE_DECLARATIONS` を共有し、dynamic route は
  実在する slug（Portfolio seed / Tools manifest）だけを展開する。
  `/portfolio/<任意の文字列>` は通らない。
- static HTML 間の `#fragment` は target 文書の `id` / `name` と照合する。
  比較の前に `decodeURIComponent` で percent-encoding を戻す（失敗時は authored の
  文字列のまま）ため、`#セクション` と `id="セクション"`、`#my%20section` と
  `id="my section"` は一致する。表示文字列の正規化は行わない。
  React route の fragment は照合しない（id の所有は React 側にあり、ここで推測すると
  false positive になる）。
- percent-encoded な `/`（`%2F`）は path separator として扱わない。static hosting も
  そうしないため、`/share%2Fexample` を `/share/example` に読み替えると 404 を隠す。
- `<template>` の中身は DOM に clone されるまで参照ではないため走査せず、`<base href>` も
  解釈しない。現行の `public/**` はどちらも使っていない。
- 表示文字列・パスに対して `normalize()` を呼ばない。Issue #433 の Unicode 方針
  （表示本文は authored のまま）を検査器が巻き戻さないため。

## 4. 画像

- HTML は `alt` 属性の**欠落**を error、`alt=""` を warning とする。
  `role="presentation"` / `aria-hidden="true"` を明示した空 alt は装飾として通す。
- `src` / `srcset` は内部なら実在を確認し、外部なら info として記録する。
  外部画像にもリンクと同じ安全性の規則を適用する: 資格情報入り URL は `E104`、
  private / loopback host は `E110` の error であり、`--external` でも dereference しない。
- `src` を持たない `<img>` は「script が後から設定する」ものとして warning。
  `src=""` は存在するが空の参照であり、browser が文書自身を指す壊れた画像として
  扱うため `W109 image-src-empty` の warning にする。
- Markdown の `![alt](url)` は現行 lexer では link に degrade する
  （[`docs/portfolio/markdown-format.md`](../../portfolio/markdown-format.md)）。
  それでも alt と URL を検証する: authored reference は将来の renderer が
  そのまま公開するため、壊れた参照を残さない。
- `data:` を含む http(s) 以外の画像 src は error とする（`E109 image-scheme`）。
  inline SVG data URI を許可するかは content owner の未決事項であり、このゲートは
  黙って許可しない側に倒している。
- alt の**内容の質**（説明的か、重複していないか）は自動判定しない。
- Markdown のリンク抽出は lexer と同じく最初の `)` を閉じ括弧とする
  （`src/portfolio/markdown.lexer.ts#findLinkCloseParen`）。CommonMark の
   balanced parentheses（`[x](/a_(b).pdf)`）には対応しない。lexer が公開する href と
  検査対象を一致させ、renderer が切り詰める URL を検査器だけが通す状態を避ける。

## 5. 検証と再現

CI は 36 tests / 6 report fixtures で構成される。36 tests は内部 404 / 外部 timeout /
画像 alt / 画像 404 / 禁止 scheme / 制御文字で難読化された scheme / private host /
IPv4-mapped IPv6 の正規化 / fragment の percent-decoding / Markdown code fence /
report escaping / credential redaction を固定し、6 report fixtures は report の
counterfactual 表示を固定する。
real repository の走査も同じ test file の中で error 0 を assertion している。

```bash
node --experimental-strip-types --test scripts/check-content-links.test.mjs
pnpm run content:links:check
```

検証画像の再生成:

```bash
node --experimental-strip-types scripts/content-link-report.mjs --capture
```

Issue は `docs/verification/content/link-check-report.png` を指定しているが、
repository には WebP（幅 1440、quality 80）を置く。Playwright は PNG しか
書けないため、撮影後に既存の `sharp`（devDependency）でメモリ上で再エンコードし、
中間 PNG は残さない。内容は同一である。

## 6. 未対応範囲（このゲートが証明しないこと）

- 外部リンクの恒久的な生存。`--external` はその時点の応答を記録するだけで、
  将来の削除や仕様変更は保証しない。
- 文章の正しさ・タイポグラフィ・翻訳。検査は構造（参照解決）だけを行う。
- JS が実行時に生成する URL / DOM id。静的な authored content のみを見る。
- R2 media の実在。`media[].r2Key` は公開 URL ではなく、media base URL は
  environment 値なので、offline では alt だけを検証する。
- Tool submodule 内のリンク。所有はそれぞれの repository にある。
- `<template>` 内の参照と `<base href>` の解決。script が clone する参照は静的には
  確定できず、`<base href>` を持つ文書は現行の公開 surface に無い。
- 外部 URL の redirect 先。`--external` は 3xx を warning として記録し、追従しない。
- Python は追加しない。検査は Node だけで完結する。
