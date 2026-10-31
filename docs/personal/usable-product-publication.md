# 「使えるもの」を配布・API・操作の公開条件に落とす

> Status: **Issue #515 の適用例とチェックリストのみ**
> Visibility: repository documentation（公開面ではない）
> 典拠: Issue #515 が引用した Miro board の見出し語のみ（付箋本文にはアクセスできない）
> Miro board: https://miro.com/app/board/uXjVEZdqDp4=

Miro の見出し語「哲学 > 使えるものをつくる > DL配布/APIサービス」を、機能完成ではなく利用開始から失敗時の復帰までの受入指標に翻訳した公開条件。5 段階それぞれの利用者の出口と、既存 Tool 1 件・API 1 件・反例 1 件への適用例、および適用例の各段階の判定結果（適合 / 未確認 / 不適合）と次の対応。

## 典拠と読み方

本稿の典拠は、Issue #515 が引用した Miro board の見出し語「哲学 > 使えるものをつくる > DL配布/APIサービス」だけである（board の URL は本文の冒頭に記載する）。付箋の本文にはアクセスできないため、Miro にしか無い情報（年表・人数・評価・他人の私生活・未公開の作品）は本稿に一切持ち込まない。

5段階の順序と「利用者の出口」という語彙は、見出し語を受入指標へ翻訳した本 Issue 側の解釈であり、Miro の原文の逐語訳ではない。owner の意図と一致するかは未確認（owner 確認待ち）。

固有名詞・path・スキーマ・件数は、いずれも本リポジトリの記録（src/tools/manifest.json、src/http/api-directory/catalog.ts）から読み取ったものだけを記載している。記憶や推測、測定していない数値は書いていない。

- 典拠: Issue #515 の Miro 引用（見出し語のみ）。付箋本文は読めていない。
- 未確認（owner 確認待ち）: 見出し語以外の Miro 由来の記述、および 5 段階の順序と語彙が owner の意図と一致するか。
- 実測: 記録ファイルからの読み取り。preview の事実値も parity test が同じ記録を読み直して照合する。

## 公開条件の5段階

公開の判定は「動くか」ではない。利用者が利用開始から失敗時の復帰まで、それぞれの段階で終えられるかで決める。

5段階は順に置く。並び替えると「操作できないものを先に配ってよい」という誤読が生まれる。出口が閉じている段階があれば、その段階に到達するものは公開しない。

この規則の適用範囲は、これから公開する公開物（新規に公開する Tool / API サービス、および内容を改訂して再公開する公開物）である。すでに公開済みの公開物（readmark と /api/v1/reactions）をこの基準で撤回することは本稿では決めない。公開済みの公開物を提供するかどうかと、その記録を改訂するかどうかは owner の判断であり、本稿は既存の記録を現状のまま記録する。撤回に関する判断は「残存 · 要 owner 判断」の未決項目に記す。

- 入手: 利用開始できる。
- 操作: 意図した操作を実行できる。
- 説明: 結果を理解できる。
- 失敗: 失敗から復帰できる。
- 廃止: 終了を知らされ、必要なら移れる。

| 段階 | 利用者の出口 | 判定 |
| --- | --- | --- |
| 入手 | 利用者は「どこから取り出すか」を迷わない。配布物（Tool の成果物）か API の path・method・認証の形が、1 か所で表明されている。 | 入手の path・認証・前提条件が、同じ 1 つの記録に載っている。 |
| 操作 | 利用者は「何を送ればよいか」を迷わない。操作の入口と入力の形が文書に載っている。 | 操作の入力が example 付きで表明されている。 |
| 説明 | 利用者は「いま何が起きているか」を説明できる。応答の意味と field が定義されている。 | 応答の example とその意味の説明が同じ場所にあり、用語が一意に決まる。 |
| 失敗 | 利用者は「失敗したらどうするか」を迷わない。失敗の形と復帰手順が表明されている。 | 失敗の形と、復帰または再試行の手順が表明されている。 |
| 廃止 | 利用者は「使えなくなったこと」を偶発的に知らされない。終了の条件と移行先が記録に載っている。 | 提供を終了する場合、その告知と移行先が記録に載っている。 |

## 段階ごとのチェックリスト

各段階のチェックは「確認できたか」を問う。確認できない項目は保留（未確認）として記録し、勝手に埋めない。

- **入手** — Tool の配布 path と entry HTML が manifest に載っている（`delivery.artifact_path` / `delivery.entry_html`）。
- **入手** — API の認証形式と必要な scope が API directory に載っている（`authentication` / `authForm` / `purpose`）。
- **入手** — 利用者に前提となる条件があるなら、その記録に書いている。
- **操作** — 操作の入口（Tool なら配信 page、API なら method と path）が 1 か所で表明されている。
- **操作** — 操作の入力が example 付きで表明されている。
- **操作** — 同じ操作を繰り返したときの挙動（冪等性）が表明されている。
- **説明** — 応答の形が example 付きで表明されている。
- **説明** — その応答が何を意味するか（purpose）が 1 文で表明されている。
- **説明** — 用語が一意である（同じ words が 2 つの意味を持たない）。
- **失敗** — 失敗の形が列挙されている（401 / 403 / 400 / 422 / 429 など、それぞれがいつ起きるかが分かる）。
- **失敗** — rate limit が起きるなら、どの binding が上限を持つかが表明されている。
- **失敗** — 失敗した利用者が次にどうするかが表明されている（再試行 / 別経路 / 連絡先）。
- **廃止** — 提供終了の条件が表明されている（pin した version、manifest の `delivery.kind` など）。
- **廃止** — 利用者が終了に気付く手段（告知期間・記録の更新）が表明されている。
- **廃止** — 移行先があるなら、その path が表明されている。

## 判定の語彙

適用例の各段階には、判定（適合 / 未確認 / 不適合）と次の対応を記録する。判定は記録だけから出す——記録が答えられない段階は未確認とし、記録に無いまま「適合」とは書かない。

- 適合 — 記録がその段階の判定基準を満たし、その記録自身がそれを示している。
- 未確認 — 記録ではその段階を判定できない。決めとなる事実が別の記録にあるか、静的に読めない範囲にある。
- 不適合 — 記録がその段階の判定基準を満たさない。必要な項目が無く、記載があるとしても基準に届かない。

## 適用例 — 既存Tool（readmark）

配布されている Tool の実例。記録は Tool Registry manifest（src/tools/manifest.json）。

- 対象: readmark
- 典拠: `src/tools/manifest.json`（tools[slug=readmark]）
- 事実: delivery.kind = same_origin_static ／ delivery.artifact_path = /tools/readmark/app ／ delivery.entry_html = /tools/readmark/app/index.html ／ license = MIT

- **入手** — 記録が述べていること: manifest が `same_origin_static` として配布 path（`/tools/readmark/app`）と entry HTML（`/tools/readmark/app/index.html`）を宣言し、iframe は `sandbox: allow-scripts` / `referrer_policy: no-referrer`。 ／ 記録に無いこと: 配布の前提（Tool の build が host の release に載る条件）は manifest に宣言されていない。 ／ 判定結果: 未確認 ／ 次の対応: 配布の前提（Tool の build が host の release に載る条件）を manifest に宣言する件は manifest schema の変更であり、保留条項「Tool manifest に操作の入力形（受け付ける file 形式・上限）を宣言するかは、manifest schema の変更として別の Issue の領域にする。」の判断に含める。
- **操作** — 記録が述べていること: manifest の description が「A local-first reading app for the browser. PDFs in MVP; EPUB/Markdown/text next.」と対象範囲を書き、対象形式が PDF に限ると記している。 ／ 記録に無いこと: 入力の型（受け付ける file 形式・上限）と、操作に失敗したときの表示は manifest に宣言されていない。 ／ 判定結果: 不適合 ／ 次の対応: 操作の入力形（受け付ける file 形式・上限）と操作に失敗したときの表示を manifest に宣言する件は、保留条項「Tool manifest に操作の入力形（受け付ける file 形式・上限）を宣言するかは、manifest schema の変更として別の Issue の領域にする。」の判断に含める。
- **説明** — 記録が述べていること: manifest の description と `license: MIT` が対象とライセンスを説明し、`delivery.privacy.basis` は「measured at pinned readmark 906c90e: no external origin in index.html or src/**; re-measure after a bump」と測定根拠として記録する。 ／ 判定結果: 適合 ／ 次の対応: 対応不要（記録が判定基準を満たしている）。
- **失敗** — 記録が述べていること: 同じ manifest が、配布できない Tool には `delivery.disabled_reason` で「なぜ出せないか」を宣言する書式を持っている。 ／ 記録に無いこと: readmark には `disabled_reason` が無く、配布に失敗したときの表示（build 不能・成果物が無い）は manifest に宣言されていない。 ／ 判定結果: 不適合 ／ 次の対応: 配布に失敗したときの表示（build 不能・成果物が無い）を manifest に宣言する件は manifest schema の変更であり、保留条項「Tool manifest に操作の入力形（受け付ける file 形式・上限）を宣言するかは、manifest schema の変更として別の Issue の領域にする。」の判断に含める。
- **廃止** — 記録が述べていること: manifest は `source.pinned_sha` を固定し、`delivery.privacy.basis` に「re-measure after a bump」と書いている。 ／ 記録に無いこと: 提供終了の告知期間と移行先は manifest に宣言されていない。 ／ 判定結果: 不適合 ／ 次の対応: 提供終了の告知期間は保留条項「廃止段階の告知期間（何日前にお知らせするか）は owner の判断であり、本 Issue では決めない。」の判断に含める。移行先の path を manifest に宣言する件は manifest schema の変更として別の Issue の領域にする。

## 適用例 — 既存API（/api/v1/reactions）

公開されている API サービスの実例。記録は公開 API directory（src/http/api-directory/catalog.ts）。

- 対象: /api/v1/reactions
- 典拠: `src/http/api-directory/catalog.ts`（publicApiCatalog の path = /api/v1/reactions の 3 件（GET / PUT / DELETE））
- 事実: path = /api/v1/reactions ／ methods = GET / PUT / DELETE ／ authentication = credentialed ／ authForm = api-key ／ scopes = reactions:read / reactions:write

- **入手** — 記録が述べていること: API directory が `path` / `method` / `authentication: credentialed` / `authForm: api-key` を宣言し、必要な scope（`reactions:read` / `reactions:write`）を `purpose` に明記している。 ／ 記録に無いこと: API key をどこで発行するかについての記載は catalog に無く、catalog の責務外である。 ／ 判定結果: 未確認 ／ 次の対応: API key をどこで発行し、利用者がたどる案内をどの記録に書くかは、未決項目「API key をどこで発行し、利用者がたどる案内をどの記録に書くかは owner の判断である（未確認・owner 確認待ち）。」の判断に含める。
- **操作** — 記録が述べていること: `purpose` が「idempotent by target + actor + image reference」と操作の入力を名指しし、`responseExample` が成功時の応答の形を示している。 ／ 記録に無いこと: リクエスト body の field 名・型・必須か任意かの区別は表明されておらず、入力の example も無い。 ／ 判定結果: 不適合 ／ 次の対応: リクエスト body の field 名・型・必須か任意かの区別と入力の example を catalog に宣言する件は、保留条項「API directory の schema に deprecation を表す field を追加するかは、既存 schema の変更として別の Issue の領域にする。」の判断に含める。
- **説明** — 記録が述べていること: 3 verb すべての `purpose` が何を返すかを示し、`responseExample` が field 単位の形を示している。 ／ 判定結果: 適合 ／ 次の対応: 対応不要（記録が判定基準を満たしている）。
- **失敗** — 記録が述べていること: `errorForm` が 401 / 403 / 400 / 422 / 429 を列挙し、`rateLimitBinding` が read と write の上限 binding を示す。 ／ 記録に無いこと: 429 を受けた利用者がいつ再試行してよいか（Retry-After のような指標）は catalog に宣言されていない。 ／ 判定結果: 不適合 ／ 次の対応: 429 を受けた利用者が再試行してよい時期の指標を catalog に宣言する件は、保留条項「API directory の schema に deprecation を表す field を追加するかは、既存 schema の変更として別の Issue の領域にする。」の判断に含める。
- **廃止** — 記録が述べていること: なし（catalog に、廃止や廃止予定を表す field が無い）。 ／ 記録に無いこと: 提供を終了するときの告知と移行先の記述が catalog に無い。schema への追加は別の Issue の領域である。 ／ 判定結果: 未確認 ／ 次の対応: 提供終了の告知と移行先を catalog に宣言する件は、保留条項「API directory の schema に deprecation を表す field を追加するかは、既存 schema の変更として別の Issue の領域にする。」の判断に含める。

## 反例 — 公開できないTool（text-counter）

同じ manifest が「公開できない」ことも記録できる。manifest が host_disabled として持つ記録は、5 段階のどの段階で出口が閉じているかを語れる。

- 対象: text-counter
- 典拠: `src/tools/manifest.json`（tools[slug=text-counter]）
- 事実: delivery.kind = host_disabled ／ classification = needs_tool_side_fix ／ license = MIT

- **入手** — 記録が述べていること: manifest が `delivery.kind: host_disabled` と `disabled_reason` に「Tool is currently a Next.js component library (no vite.config, no index.html). Embedding blocked until the Tool repo adds a standalone Vite build path (Issue #81 follow-up after pilot).」を宣言している。 ／ 判定結果: 不適合 ／ 次の対応: manifest の disabled_reason が宣言している解禁の条件「Tool repo adds a standalone Vite build path」どおり、Tool リポジトリが standalone Vite build path を追加する（配布 path と entry HTML が manifest に載る）。
- **操作** — 記録が述べていること: なし（配布 path が無いので、操作の入口も無い）。 ／ 記録に無いこと: 利用者が入るべき入口が存在しない。 ／ 判定結果: 不適合 ／ 次の対応: manifest の disabled_reason が宣言している解禁の条件「Tool repo adds a standalone Vite build path」どおり、Tool リポジトリが standalone Vite build path を追加する（配布 path と操作の入口が manifest に載る）。
- **説明** — 記録が述べていること: `disabled_reason` が「なぜ公開できないか」を説明している。 ／ 判定結果: 不適合 ／ 次の対応: manifest の disabled_reason が宣言している解禁の条件「Tool repo adds a standalone Vite build path」どおり、Tool リポジトリが standalone Vite build path を追加する（対象とライセンスの説明が manifest に載る）。
- **失敗** — 記録が述べていること: なし。 ／ 記録に無いこと: 失敗した利用者に「待つ」以外の復帰手段が無い。 ／ 判定結果: 不適合 ／ 次の対応: manifest の disabled_reason が宣言している解禁の条件「Tool repo adds a standalone Vite build path」どおり、Tool リポジトリが standalone Vite build path を追加する（配布に失敗したときの表示が manifest に載る）。
- **廃止** — 記録が述べていること: `disabled_reason` が解禁の条件（Tool リポジトリ側に standalone Vite build path を追加する）を書いている。 ／ 記録に無いこと: 終了の告知は該当しない（そもそも未公開）。 ／ 判定結果: 不適合 ／ 次の対応: manifest の disabled_reason が宣言している解禁の条件「Tool repo adds a standalone Vite build path」どおり、Tool リポジトリが standalone Vite build path を追加する（解禁の条件と移行先が manifest に載る）。

## 採用と保留

採用とは、本 Issue の成果物として採用した判断である。保留とは、owner の判断か別の Issue の領域であるため採用しなかったもの——保留の項目は「決定した」とは書かない。

### 採用

- 5段階の順序（入手 → 操作 → 説明 → 失敗 → 廃止）と、それぞれの「利用者の出口」を公開条件の語彙として採用する。
- 5段階の並び替えを認めない。出口が閉じている段階があれば、その段階に到達するものは公開しない。
- 判定の物差しは「動くか」ではなく「利用者が終えられるか」にする。
- Tool は Tool Registry manifest、API は公開 API directory という 2 つの既存記録に照らして適用例を書く。
- 確認できない項目は保留（未確認）として記録し、埋めない。

### 保留

- 廃止段階の告知期間（何日前にお知らせするか）は owner の判断であり、本 Issue では決めない。
- API directory の schema に deprecation を表す field を追加するかは、既存 schema の変更として別の Issue の領域にする。
- Tool manifest に操作の入力形（受け付ける file 形式・上限）を宣言するかは、manifest schema の変更として別の Issue の領域にする。
- 5 段階を機械検査する gate にするかは、本 Issue の範囲（文書 + 単独 preview）を超える。

## 残存 · 要 owner 判断

次の項目は owner しか決められないため、本 Issue では実装せず記録に留めた。

- Miro の付箋本文（見出し語以外）を確認できないため、5 段階の順序と「出口」の語彙が owner の意図と一致するかは未確認（owner 確認待ち）。
- 「配布する Tool」と「公開する API サービス」のどちらに比重を置くかは、owner の判断である（未確認・owner 確認待ち）。
- 廃止の告知をどの記録に書くか（Tool manifest / API catalog / 別の記録）は未確認（owner 確認待ち）。
- API key をどこで発行し、利用者がたどる案内をどの記録に書くかは owner の判断である（未確認・owner 確認待ち）。
- すでに公開済みの公開物（readmark と /api/v1/reactions）が本稿の基準で「不適合」の段階を持つことを踏まえ、公開の継続・撤回・記録の改訂のどれを選ぶかは owner の判断である（未確認・owner 確認待ち）。
