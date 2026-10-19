# Cloudflare 設定 drift runbook（Issue #480）

> production に deploy される Cloudflare 設定が「意図した production
> contract」と一致しているかを、実測-vs-記録で判定する gate の手順。
> secret 値を一切読まず・出力せず、credential 無し・ネットワーク無しで
> 実行する。gate は `pnpm run validate:fast` に属するので
> `validate:integration` / `validate:release` / CI `validate` job の
> すべてで release 前に走る。

**status-only 契約**が本 gate の中心にある。出力は verdict・dimension 別の
finding 件数・reason code のみで、**binding の secret 値・text var の予期外
の値・credential を一切出さない**（AGENTS.md §4、
[`docs/runbook/infisical-secrets.md`](infisical-secrets.md) の precedent）。
出力はそのまま PR 本文や Issue に貼れる。

---

## 1. 何を強制しているのか

Cloudflare Workers Builds は `main` への push で production を deploy する
（[`docs/runbook/cloudflare-workers-builds.md`](cloudflare-workers-builds.md)）。
それが deploy するのは

1. `cloudflare.config.ts` が **production mode** で生成する Worker surface
   （binding / route / compatibility 設定）、
2. Cloudflare Dashboard（Workers Builds）に設定された **build command と
   deploy command**、
3. Cloudflare Static Assets が適用する **`public/_headers`**、

である。Issue #247 で `wrangler.jsonc` と `wrangler.production.jsonc` の
二重管理を 1 枚へ寄せた副作用として、**「dev と prod の差分が意図した
ものか」を示す機械的な手段**がなくなった。`ConfigContext.mode` の分岐は
ファイル差分に出ることはなく、binding を mode 条件付きで 1 つ足した
だけで「dev だけにある」ことが静かに成立する。

本 gate の主張は 1 つに尽きる。

> production Worker surface / development Worker surface / build・deploy
> command / static asset の header surface が、**記録された production
> contract**（`quality/cloudflare-config-drift.json`）と一致する。

判定は 5 dimension で行う。

| dimension | 対象 | 典型 finding |
| --- | --- | --- |
| `bindings` | production binding 集合（型・text 値・D1/R2 の対象・rate limit の namespace と予算）。secret binding は**名前**のみ | `missing` / `unexpected` / `mismatch` / `type_mismatch` |
| `routes` | route / hostname（`domains`）。production は正規 origin、development は空 | `route_mismatch` |
| `headers` | Cloudflare Static Assets の `public/_headers` の coverage と nosniff baseline | `header_rule_uncovered` / `header_value_mismatch` / `header_rule_missing` |
| `build_commands` | Workers Builds が実行する command が `package.json` script を指し、runbook の表と一致しているか | `script_missing` / `runbook_mismatch` |
| `mode` | dev と prod の差分が、記録に宣言された差分だけか。比較対象は binding 集合・route 集合・**scalar**（`accountId` / `name` / `compatibilityDate` / `compatibilityFlags` / `entrypoint` / `observability`） | `undeclared_mode_difference` / `undeclared_mode_field_difference` / `undeclared_mode_scalar_difference` |

**1 項目の不一致が 1 finding、1 finding が 1 つの赤**である。tolerance 帯も
閾値も「ほぼ一致」に落とす判定も存在しない。

同じ項目を 2 つの dimension が重複して数えることはしない。production binding
の欠落は `bindings` dimension が所有し、`mode` dimension はそれを繰り返さない
（件数が repair のチェックリストとして使えるため）。一方で、1 件の変更が
**別の 2 つの事実**を露呈することはある（例: production の text 値が記録と
違う＝`bindings`、かつ dev と prod の値が違う＝`mode`）。その場合は 2 finding になる。

### なぜ「期待値」をデータとして持つのか

config 同士を比べただけでは何も証明できない。`cloudflare.config.ts` を編集
すれば期待値と実測が同じ PR の中で一緒に動き、drift はその PR で再び緑に
なる。期待値はしたがって**レビュー可能な設定判断としてデータに置く**
（`quality/cloudflare-config-drift.json`）。差分は git diff として読める。

### 記録の「内側の契約」

**section が存在するだけでは記録は成立していない。** gate が期待値として読む
field が 1 つでも欠けていれば、その dimension は**何も検査しないまま緑**に
なる（`static_asset_headers.required_paths` を落とすと header coverage は
検査されないまま `MATCH`、`build_commands` を空にすると build / deploy
command は 1 本も検査されないまま `MATCH`）。これは「読めなかった」を
「clean」に落とすのと同じ種類の fail-open なので、記録の**内側**も検査する。

| 記録の部位 | 成立条件 |
| --- | --- |
| `production.bindings` | 1 件以上。`type` が文字列。`type: "secret"` は**名前だけ**（値があれば credential なので拒否） |
| `production.routes` | 1 件以上の非空 string（canonical origin の宣言。空は「何も宣言していない」ので不可） |
| `production.accountId` / `name` / `compatibilityDate` / `entrypoint` | いずれも非空 string |
| `production.observability` | boolean |
| `production.compatibilityFlags` | string の配列 |
| `development.routes` | 配列（**空でよい**: development は production origin を継承しないのが正しい状態） |
| `development.mode_only_bindings.production_only` / `.development_only` | string の配列 |
| `development.mode_only_fields` | string の配列（scalar の mode 差分を宣言する場所。空 = どの scalar も両 mode で同じ） |
| `build_commands` | `$` 始まりの documentation key を除いて **1 件以上**、かつ各 value が `pnpm run <script>` 形式 |
| `static_asset_headers.file` / `policy_file` / `baseline_rule` / `baseline_header` / `baseline_policy_key` | いずれも非空 string |
| `static_asset_headers.required_paths` | 1 件以上の非空 string |

1 つでも欠けたら `verdict=UNDECIDABLE`（exit 2、reason は
`record_incomplete:<field>`）になる。**空の記録を「該当なし」に読み替えない。**

## 2. 実行方法

```bash
# gate 本体（validate:fast の一部 / CI でも同じ command が走る）
pnpm run cf:config:drift:check

# 検証用 HTML レポート + スクリーンショット（下記 3 章の画像の元）
pnpm run cf:config:drift:report   # -> .tmp/cloudflare-config-drift-report.html
                                #    docs/verification/security/cloudflare-config-drift.webp

# 記録済み fixture での観測（release verdict ではない。出力に source=fixture と出る）
pnpm run cf:config:drift:check -- --case=one-missing-binding
```

Exit codes:

| code | verdict | 意味 |
| --- | --- | --- |
| `0` | `MATCH` | 記録された contract と一致 |
| `1` | `DRIFT` | 1 項目以上の差分 |
| `2` | `UNDECIDABLE` | **判定不能**（fail-closed）。記録 / surface / `public/_headers` / policy ファイルが読めない、記録が契約として成立していない（**section の欠落**と**内側の field の欠落**の両方。secret binding に値がある、等）、usage error、または status-only を出力できない |

`2` が pass と同じ信号にならないことがこの gate の要件である。「読めなかった」
を「clean」に落とす実装は、この gate の存在意義を消す。

### fixture について

`quality/fixtures/cloudflare-config-drift/*.json` は**実測 surface への
単一項目 mutation recipe**であり、「その時点の記録済み surface のコピー」
ではない。実測_surface に 1 項目だけ変更を加えて gate を実行するため、
設定が将来変わっても fixture 自体が腐らない。各 fixture は自分が
 どの verdict になるべきかを `expect` に宣言し、レポート生成とユニット
テストがその宣言を検証する（宣言と実測が食い違えばコマンドは非ゼロ終了）。

| fixture | 示すもの | expect |
| --- | --- | --- |
| `one-missing-binding` | production binding を 1 件外すと 1 finding・赤（受け入れ条件 1） | `DRIFT` / 1 |
| `secret-binding-dropped` | runtime secret の **名前** 1 件の欠落。値は出ない。production binding の欠落は `bindings` dimension が 1 件の finding として所有する | `DRIFT` / 1 |
| `text-value-drift` | text var の値が記録と違う 1 項目と、その結果生じる未宣言の dev/prod 値差分（別々の 2 事実）。実際の値は出さず長さだけ（redaction 契約） | `DRIFT` / 2 |
| `undeclared-development-binding` | 記録に宣言していない development 専用 binding | `DRIFT` / 1 |
| `match` | 何も変えないので緑（ハーネス由来で赤にならないことの証明） | `MATCH` / 0 |

### 既存 gate との関係（変更しないもの）

- secret の SoT は Infisical（ADR-0015 §6 / §9）。本 gate は runtime secret の
  **名前集合**だけを見て、値には触れない。Wrangler / `cf` の secret 投入経路も
  deploy path も一切変わらない。
- production deploy の権限は Cloudflare Workers Builds のままである。
  GitHub Actions は検証と手動 smoke のみ（`docs/runbook/cloudflare-workers-builds.md`）。
- release PR の human gate（AGENTS.md §6）はそのまま。

## 3. 正常時の観測

```text
[cf-config-drift] source=repository target=production
[cf-config-drift] verdict=MATCH
[cf-config-drift] reason=-
[cf-config-drift] dimensions=bindings,routes,headers,build_commands,mode
[cf-config-drift] findings=0 dim(bindings=0 routes=0 headers=0 build_commands=0 mode=0)
[cf-config-drift] observed=bindings=12 secrets=3 (names only) routes=1 build_commands=2 header_rules=8
[cf-config-drift] diff=none
```

`verdict=MATCH` かつ `findings=0` で初めて release gate を通過する。

### スクリーンショット

コミット済み検証物
[`docs/verification/security/cloudflare-config-drift.webp`](../verification/security/cloudflare-config-drift.webp)
は `pnpm run cf:config:drift:report` の出力（live verdict + 4 つの異常ケース
+ 1 つの正常ケースの実測結果と status-only の CLI 出力）を撮影したもので
ある。binding 値・credential は写っていない（生成側が同じ leak guard を
通している）。Issue #480 が指定した `cloudflare-config-drift.png` はリポジトリの
WebP 規約に従い同じ stem の `.webp` として commit している。

## 4. 異常時の観測と手順

### 4.1 `verdict=DRIFT`（exit 1）

`finding=<path> kind=<kind> expected=<…> actual=<…>` が finding 数だけ
出る。`dim(...)` が dimension 別の内訳、`observed=` が実測の binding 数・
secret binding 数・route 数である。

| 症状 | まず疑うもの | 手順 |
| --- | --- | --- |
| `kind=missing` / `unexpected`（`bindings.*`） | `cloudflare.config.ts` の binding 追加・削除・改名 | binding は 3 者を揃える: `cloudflare.config.ts`（実体）、`scripts/_cloudflare-contract.mjs` / `scripts/_cloudflare-identity.mjs`（名前 SoT）、`quality/cloudflare-config-drift.json`（記録）。**binding を足したら `pnpm run cf-typegen`、D1/R2 を使う service の追加は ADR-0004 の ticket が必要**（AGENTS.md §4） |
| `kind=mismatch`（`bindings.*.id` / `.namespace` / `.name`） | 別 database / bucket / rate-limit namespace を指した | 本番 object's 変更であり operator 側の判断。repository 側の SoT（`_cloudflare-identity.mjs`）を直してから再実行する。実値は識別子なので finding に出力される |
| `kind=mismatch`（`bindings.*.value`） | text var の値が記録と違う | 意図的な変更なら**同じ PR で**記録を更新する。実値は出ないので、何-putったかは **PR の diff で**読む（`actual=<redacted len=N>` は長さだけ） |
| `kind=route_mismatch`（`production.routes`） | canonical origin の付け忘れ・外れ | `PRODUCTION_CUSTOM_DOMAIN`（ADR-0014）を基準に直す。`development.routes` が赤なら、dev が本番 origin を引き継いでいる（ADR-0014 §development が禁じている状態） |
| `kind=undeclared_mode_difference`（`mode.*`） | 記録にない mode 専用 binding が 1 つ増えた | 意図的な差分なら記録の `development.mode_only_bindings` へ**名前だけ**を追加する。意図しない差分ならその binding を消す |
| `kind=undeclared_mode_field_difference` | 同じ binding の**値**が mode ごとに違う | 値の mode 分岐は deployment ごとの挙動差になるため、原則そのままにする。やむなく維持するなら記録へ宣言し、レビューで 1 回だけ議論する |
| `kind=undeclared_mode_scalar_difference`（`mode.undeclared_field.*`） | dev と prod の **scalar**（`compatibilityDate` / `name` / `entrypoint` / `observability` / `accountId` / `compatibilityFlags`）が違う | mode 分岐はファイル差分に出ないので、差分は記録でしか表せない。意図的な差分なら記録の `development.mode_only_fields` へ field 名を追加する |
| `kind=header_rule_uncovered` / `header_value_mismatch`（`headers.*`） | `public/_headers` の rule 欠落、nosniff baseline の改変 | header の**値**と合成セマンティクスは `pnpm run security:headers:check`（Issue #449）の責務で、まずそちらを通すこと |
| `kind=script_missing` / `runbook_mismatch`（`build_commands.*`） | `package.json` script の改名・削除、または runbook 表の陳腐化 | script 名を変えたなら **Cloudflare Dashboard（Workers Builds）の build / deploy command も同時に変更**する。ここを直さないと production は存在しない command を実行し続ける。runbook の表も同時に直す（本 gate が両者の一致を検証する） |

`finding` 1 件が「その 1 項目だけ直せばよい」 corresponding な単位になっている
ので、件数がそのまま repairs のチェックリストとして使える。同じ項目を 2 つの
dimension が重複して数えることはない（production binding の欠落は
`bindings` dimension が所有する）。1 件の変更が別の 2 つの事実を露呈する
場合は 2 finding になる（§1 の dimension 表の直後の注記を参照）。

### 4.2 `verdict=UNDECIDABLE`（exit 2）

| reason | 意味 | 対処 |
| --- | --- | --- |
| `record_unreadable` | 記録ファイルが読めない / JSON として壊れている | `quality/cloudflare-config-drift.json` を読む |
| `record_incomplete` | 記録の **section** が欠けている（`production` / `production.bindings` / `production.routes` / `build_commands` / `static_asset_headers` / `development.mode_only_bindings`） | 記録を修復する。**空の記録を「該当なし」に読み替えない** |
| `record_incomplete:<field>` | 記録の **内側**が欠けている（例: `record_incomplete:static_asset_headers.required_paths` / `record_incomplete:build_commands` / `record_incomplete:development.routes` / `record_incomplete:production.routes` / `record_incomplete:development.mode_only_bindings.production_only`） | 該当 field を §1「記録の「内側の契約」」の表に従って修復する。この状態では該当 dimension が**何も検査していない**ので、`MATCH` は出ていない（出ていたら fail-open） |
| `record_incomplete:bindings.<NAME>` | `type: "secret"` の binding に別のフィールドがある | その値は credential である。記録から値を削除し、runtime secret の値は Infisical（ADR-0015）に置くこと |
| `surface_unreadable` | `cloudflare.config.ts` が解決できない、または `worker` が surface として解釈できない | ローカルで `node -e "import('./cloudflare.config.ts').then(m => console.log(Object.keys(m.default)))"` を確認する。`cf` devDependency の導入漏れ也在此处に出る |
| `scripts_unreadable` / `runbook_unreadable` | `package.json` / runbook が読めない | ファイル自体の欠落・改名を疑う |
| `headers_file_unreadable` / `header_policy_unreadable` | `public/_headers` / `src/http/security-headers.json` が読めない | 記録の `static_asset_headers.file` / `policy_file` が実ファイルと一致しているか確認する |
| `input_unreadable` | `--case=<name>` の fixture が読めない | `quality/fixtures/cloudflare-config-drift/<name>.json` の存在を確認 |
| usage error | 未知の引数 | `--help` 参照 |

いずれも **fail-open ではなく fail-closed** であり、`MATCH` へ落とす escape
hatch は存在しない（意図的）。

## 5. スコープ境界（強制しないこと）

本 gate は **リポジトリが宣言する設定** の drift だけを強制する。以下は
本 gate では閉じない。

| 対象 | なぜこの gate では閉じないか |
| --- | --- |
| Build Output（実際に deploy される artifact） | `pnpm run cloudflare:contract:check:build`（`validate:integration`）の責務。本 gate は source 側だけを見る |
| Cloudflare Dashboard 実体（Workers Builds の build 変数、API token 権限、production branch 設定） | local tool から読めない。gate が検証できるのは「記録された command が `package.json` の実 script を指すこと」と「runbook が同じことを言っていること」まで |
| live Worker の binding 状態（deploy 済み secret 名の一致） | remote read であり credential が必要。Infisical / Workers Builds の責務（ADR-0015 §9） |
| header の値・合成セマンティクス・Tool grant | `pnpm run security:headers:check`（Issue #449）の責務。本 gate は coverage と nosniff baseline のみ |
| runtime secret の**値**そのもの | SoT は Infisical（ADR-0015 §6）。本 gate は名前集合のみを比較する |
| D1 の実データ・schema の migration 状態 | `scripts/d1.mjs` と release runbook の責務 |

## 参照

- [`quality/cloudflare-config-drift.json`](../../quality/cloudflare-config-drift.json) —
  記録された production contract（本 gate の期待値）。
- [`cloudflare.config.ts`](../../cloudflare.config.ts) /
  [`scripts/_cloudflare-contract.mjs`](../../scripts/_cloudflare-contract.mjs) /
  [`scripts/_cloudflare-identity.mjs`](../../scripts/_cloudflare-identity.mjs) —
  実体と名前 SoT。
- [`scripts/check-cloudflare-config-drift.mjs`](../../scripts/check-cloudflare-config-drift.mjs) /
  [`scripts/_cloudflare-drift.mjs`](../../scripts/_cloudflare-drift.mjs) —
  gate と純粋 seam。
- [`docs/runbook/cloudflare-workers-builds.md`](cloudflare-workers-builds.md) —
  production delivery の canonical path（deploy 権限の所在）。
- [`docs/runbook/infisical-secrets.md`](infisical-secrets.md) —
  status-only 出力の precedent と secret SoT。
- `quality/profile.yaml#cloudflare_config_drift` と
  `quality/release-gate.json#cloudflare-config-drift` — gate の登録と reason。