# Personal-data review — 移行データの個人情報検出と掲載承認

> Authority: Issue #494 (`privacy(data): 公開データの個人情報検出と掲載承認チェック`)
> Gate: `pnpm run publication:redaction:check` (`validate:fast`)
> Library: `scripts/personal-data-review.mjs`
> Corpus: `docs/migration/personal-data-review/corpus.json`
> Evidence: [`docs/verification/privacy/publication-redaction-review.md`](../verification/privacy/publication-redaction-review.md)
> Grounded: 2026-10-19

## 何をゲートが決めるのか

Miro ボード / my-web-2025 / Notion から文章と画像を移行すると、
owner が公開と決めていない**住所・連絡先・第三者の人物名**が
一緒に移動してくる。ボードを移動したことは公開の判断ではない。

`docs/personal/knowledge-model.md` はこの 2 つを別の軸に置いている。

| 軸 | 誰が | 何を |
| --- | --- | --- |
| truth | 世界の事実 / 移行元の内容 | 「この記述は正しい」 |
| publication | **owner のみ** | 「これを公開してよい」 |

同じ Event でも public / private / 限定公開があり得る。
したがって本ゲートは、**検出（機械）と判定（owner）を混ぜない**。
検出できた事実は「公開してよい」ことを意味しない。

## 2 軸の順序

### 1. 検出 — 機械、fail-closed

`scripts/personal-data-review.mjs` が以下から候補を抽出する。

- レコードの `title` / `text`
- 画像の `alt` / `caption`（公開面に出る文言）
- 画像の `path`（個人撮影を前提としたファイル名）
- 画像 descriptor の EXIF キー（migrator が抽出した分のみ）

規則表は `RULES`（コード `D001`–`D011`）。各行は
「**意図的に一致させないもの**」を必ず持つ。検出器が
「仕様」を人名として読むと、レビュー担当は報告を無視しはじめるため、
precision を明示的に over recall より優先する。

| Code | クラス | 検出対象 |
| --- | --- | --- |
| D001 | contact | メールアドレス |
| D002 | contact | 電話番号（JP 携帯 / PHS / 固定電話 / +81） |
| D003 | address | 郵便番号 `〒NNN-NNNN` |
| D004 | address | 住所（都道府県 + 市区町村 + 丁目 / 番地 / 号） |
| D005 | address | 居住の主張（〇〇県△△市在住 / 出身 / お住まい） |
| D006 | person | 敬称つき日本語名（`〇〇さん`） |
| D007 | person | 敬称つきラテン名（`Dr. Foo Bar`） |
| D008 | person | 生年月日 |
| D009 | identifier | 12 桁識別番号（マイナンバー等） |
| D010 | image | EXIF の身元 / 位置情報キー |
| D011 | image | 個人撮影を前提としたファイル名 |

`Make` / `Model`（端末）と `DateTimeOriginal`（撮影時刻）は
D010 の対象**ではない**。これらは人物の識別子ではないためで、
「一致しないこと」を規則表に明記したものである。

### 2. 判定 — owner のみ

corpus の各レコードは `publication` を持つ。

```json
"publication": {
  "decision": "approved",
  "decided_by": "owner",
  "basis": "依拠した許可・ライセンス・出典"
}
```

- `decision` は `approved` / `review_required` / `rejected` の 3 値。
  **未記載の値は無判断**なので `review_required` として扱い、警告 `W001`
  で報告する（誰かがまだ決めていない、という状態）。
  **宣言されているのに未知の値**（`"published"` など）は壊れた decision
  なので `E004` で fail する。
- `approved` は `decided_by: "owner"` と空でない `basis` を要求する。
  `decided_by: "agent"` は `E002`、basis 無しは `E003`。
  これらは「根拠が無い承認」であり、**無いより悪い**。
- `review_required` は実際の移行では普通の状態であり、警告 `W001`。
  ここが Issue の言う「review required が出电图ない」状態。
- gate が検査するのは**表明の構造**であって、その真正性ではない。
  `decided_by: "owner"` は追跡された JSON の中の文字列であり、
  「owner が実際に決定した」ことの保証は owner の attestation 手順
  （`docs/personal/owner.md`）と corpus diff のレビューが担う。
  gate はその保証を証明するとは主張しない。

## public bundle の定義

公開 bundle は `buildPublicBundle()` の導出値であり、corpus から計算される。

- 承認済みレコードだけが、その `title` / `text` / `images` を**まるごと**提供する
- `review_required` / `rejected` は何も提供しない
- **字段単位の redact は提供しない。** 移行レコードの部分書き換えは、
  削った部分への参照だけが残ってレコード全体が壊れるため、
  owner が決定する単位はレコード全体である

さらに gate は公開 content root（宣言製）を逆向きにも走査する。

- 保留レコードの内容（title / text / image の alt・caption・path、
  および path の裸のファイル名）が公開 file に現れたら `E001`
- 承認済み record がカバーしない候補が公開 file にあれば `E005`
  （file **名**も同じ規則表で走査する。移行した写真が `public/` に
  落ちたとき、个人撮影を前提としたファイル名 `D011` が発火する）

走査対象は宣言製で、**走査しない面も理由つきで宣言する**
（`scripts/check-publication-redaction.mjs#PUBLISHED_CONTENT_NOT_SCANNED`）。

| 走査する root | 理由 |
| --- | --- |
| `copy/**` | platform copy の資源契約 |
| `public/**` | visitor が取得できる静的アセット |
| `src/about/**` | 本人の identity データ面 |
| `src/contact/**` | 公開 contact channel の registry（`channels.json`）— 移行した連絡先が到達しうる唯一の位置 |
| `src/portfolio/**` | 掲載される portfolio のデータ面 |

| 走査しない面 | 理由 |
| --- | --- |
| `public/share/**` | 別 delivery obligation（既に別の判断のもと公開されている） |
| `src/home/**` `src/editorial/**` `src/routes/**` `src/admin/**` `src/i18n/**` | component / route コード。文言はこの repository で著者され、その pull request でレビューされたもので、移行データではない |

component の文言まで逆向き走査へ広げるには、placeholder な連絡先値
（フォームの `user@example.com` のような personal address と形の
同じ値）の扱いを宣言する必要がある。その方針は owner の決定事項で
あり、この gate が勝手に作るものではない。

これで両方向が閉じる。corpus を経由しない経路と、corpus を経由して公開面に持ち込む経路の両方を検出する。

## fail-closed の規則 (E001–E008)

| Code | 状態 | 意味 |
| --- | --- | --- |
| `E001` | error | 保留レコードの内容（title / text / image descriptor / ファイル名）が公開 file に現れた |
| `E002` | error | `approved` なのに `decided_by` が owner でない |
| `E003` | error | `approved` なのに `basis` が空 |
| `E004` | error | **宣言された** decision 値が 3 値以外（未記載は error ではなく pending） |
| `E005` | error | 公開 file（内容またはファイル名）に、owner 承認済み record がカバーしない候補がある |
| `E006` | error | record id の重複 |
| `E007` | error | corpus の schema が違う / record に string の `id` がない |
| `E008` | error | 候補が 1 つも検出されない corpus — **record が 1 件も無い corpus も同じ failure**（検出器が一度も鳴らない corpus は「何もない」のではなく「private sample を失った」状態） |
| `W001` | warn | `review_required` の record が owner 決定待ちである |
| `W002` | warn | `rejected` の record が owner 判断で保留されている |

`E008` が「record が 0 件」を含むのは、private sample を消した corpus が
**警告もなく pass してよい**ことになるからである。検出器が一度も鳴らない
ことは「何もない」ことの証明にならない。

## private data を repository に置かない

`docs/personal/knowledge-model.md` は
「my-web-2026 の public repository には private data 自体を置かない」
と明記している。したがって **追跡する corpus は synthetic fixture だけ**である。

- 名前・住所・電話番号・識別番号はすべて架空値
- ドメインは予約ドメイン `.example` / `.test`
- 電話番号は未割当ブロック `0000`
- owner decision も「公開可と判断した」場合の模擬であり、
  実データの公開許可ではない

privacy の契約テストが実データを含むと、それは
テスト目的では「公開面に乗る個人データ」になる。
fixture であることを各行の `basis` に書いて、判断の根拠をレビューで追えるようにする。

## レポートの秘匿契約

レポート / CI 出力に出るのは

- 規則コード（`D001` …）
- フィールドと文字オフセット
- **masked 形状**（`〒###-####`、`###-####-####`、`・・・・`）

だけである。生の候補値はプロセス外に出ない。
すべての規則は同じ shape-only renderer（`maskValue`）でマスクする
ので、`D011` のように数字以外の文字を含む一致でも
（`自撮り` などの語）その語がレポートに出ない。
保留レコードの title も review object ではマスクする
（公開される text は owner 承認済みレコードの title だけ）。
これは `src/logging/redact.ts` が log record に課しているものと同じ
契約で、検証スクリーンショットを PR 本文に貼っただけで
私密データが公開されないための工夫である。

## レポートの鮮度 (stale) 判定

check モードは追跡済みレポートを byte-compare する。digest は 2 つ:

- **corpus digest** — corpus の全 byte。corpus を変えれば必ず失効する。
- **published candidate digest** — *候補を 1 つでも含む*公開 file だけの
  digest。候補を含まない文言の編集では失効しない。

後者を絞ったのは、privacy verdict が変わらない copy の編集でも privacy
gate が赤くなり、「write コマンドをもう一度走らせろ」とだけ言われる
状況になり、レビュー担当がその指示に従うよう習慣づけられてしまう
ためである。候補がファイルに増減すれば digest は変わるので、
privacy に関係する変更は依然として失効する。
（検出そのもの `E001` / `E005` は毎回やり直している。）

## Owner workflow

1. 移行データを `corpus.json` の record として取り込む（fixture と区別できるよう、実データは local 側で運用し、追跡しない）
2. `pnpm run publication:redaction:check` を実行する
3. `W001` で出た record について、公開可否を決める:
   - 公開するなら `approved` + `decided_by: "owner"` + `basis`
   - 公開しないなら `rejected`（理由は `basis` に書く）
   - 保留するなら `review_required` のまま
4. `pnpm run publication:redaction:write` でレポートを更新する
   （corpus を変えたのにレポートを更新しないと gate が stale で fail する）
5. `pnpm run verify:publication-redaction-screenshot` で検証画像も更新する

## 対象外と残るリスク

- **画像そのものは検査しない（OCR なし）。** 顔、撮影された書類、
  手書きの住所は画像の中に残り、owner の目視判断が必要になる。
  これは「検出できたものは公開してよい」を意味しない。
- **`D006` / `D007` は敬称つきの氏名のみ。** 敬称なしの氏名は検出しない。
- **corpus に無い移行元は対象外。** 別 board、前述でない Notion ページは
  取り込むまで検出されない。
- **`public/share/**` は対象外。** `/share/<slug>/` は Static Assets が
  配信する別 delivery surface で、既に別の判断のもと公開されている。
  移行データの公開判断をこの gate が代決すべきものではないため、
  除外理由をコードと `quality/profile.yaml` に明記している。
- **component コードは対象外（宣言済み）。** `src/home` / `src/editorial` /
  `src/routes` / `src/admin` / `src/i18n` の文言は移行データではない
  ので逆向き走査しない。逆に走査へ広げる場合の placeholder 方針は
  owner 決定事項。
- **corpus が fixture のみである以上、E005 の実データ経路は無い。**
  E005 を解除する唯一の方法は「同じ literal を持つ owner 承認済み
  corpus record」を作ることだが、corpus に private data を置かない
  invariant がそれを禁じている。現在このサイトは e-mail を公開して
  いないので壊れたままではないが、この緊張は owner 決定事項として残る。
- **1 Issue / 1 PR の境界:** 本ゲートは既存ページの構成を変えず、
  新しいページも公開しない。判断を要するものは result の `known_issues` に残す。

## 関連

- `docs/personal/knowledge-model.md` — truth authority / publication authority
- `docs/security/log-redaction.md` — 同じ「値を出さない」契約の runtime 側
- `docs/verification/privacy/README.md` — verification artifact の位置づけ
- `scripts/check-publication-redaction.mjs` — gate 本体
- `quality/profile.yaml#personal_data_review` — gate 声明 / false-pass guard
- [Issue #494](https://github.com/rebuildup/my-web-2026/issues/494)