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
  **未記載・未知の値は無判断**なので `review_required` として扱う
  （`E004` で fail）。
- `approved` は `decided_by: "owner"` と空でない `basis` を要求する。
  `decided_by: "agent"` は `E002`、basis 無しは `E003`。
  これらは「根拠が無い承認」であり、**無いより悪い**。
- `review_required` は実際の移行では普通の状態であり、警告 `W001`。
  ここが Issue の言う「review required が出电图ない」状態。

## public bundle の定義

公開 bundle は `buildPublicBundle()` の導出値であり、corpus から計算される。

- 承認済みレコードだけが、その `title` / `text` / `images` を**まるごと**提供する
- `review_required` / `rejected` は何も提供しない
- **字段単位の redact は提供しない。** 移行レコードの部分書き換えは、
  削った部分への参照だけが残ってレコード全体が壊れるため、
  owner が決定する単位はレコード全体である

さらに gate は公開 content root（宣言製）を逆向きにも走査する。

- 保留レコードの内容が公開 file に現れたら `E001`
- 承認済み record がカバーしない候補が公開 file にあれば `E005`

これで両方向が閉じる。corpus を経由しない経路と、corpus を経由して公開面に持ち込む経路の両方を検出する。

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
これは `src/logging/redact.ts` が log record に課しているものと同じ
契約で、検証スクリーンショットを PR 本文に貼っただけで
私密データが公開されないための工夫である。

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
- **1 Issue / 1 PR の境界:** 本ゲートは既存ページの構成を変えず、
  新しいページも公開しない。判断を要するものは result の `known_issues` に残す。

## 関連

- `docs/personal/knowledge-model.md` — truth authority / publication authority
- `docs/security/log-redaction.md` — 同じ「値を出さない」契約の runtime 側
- `docs/verification/privacy/README.md` — verification artifact の位置づけ
- `scripts/check-publication-redaction.mjs` — gate 本体
- `quality/profile.yaml#personal_data_review` — gate 声明 / false-pass guard
- [Issue #494](https://github.com/rebuildup/my-web-2026/issues/494)