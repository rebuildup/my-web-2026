# Release-gate check ledger (Issue #508)

**判定基準**: リリースは「実行した検査」だけを「検証済み」と報告できる。
必須検査の 1 本が実行されなくても release は緑のまま「検証済み」と書かれていた。
この ledger は、その false green を検算する。

- manifest: [`quality/release-gate.json`](../../../quality/release-gate.json)（schema v1）
- gate: `pnpm run release:gate:check`（`validate:fast` に結線されるので `validate:release` にも載る）
- report: `pnpm run release:gate:report` → `.tmp/release-gate-report.html`
- screenshot: `pnpm run verify:release-gate-screenshot` → [`release-gate-missing-check.webp`](release-gate-missing-check.webp)
- fixtures: `quality/fixtures/release-gate/{pass,missing-required-check,unregistered-command}.json`
- tests: `node --test scripts/check-release-gate-coverage.test.mjs`
- profile: [`quality/profile.yaml`](../../../quality/profile.yaml) の `release_gate_coverage` block

## なぜこの gate が必要か

release gate は「コマンドの列」である。導入済みの検査は、`package.json#scripts` の
entry point（`validate:fast` / `validate:integration` / `validate:release`）か、
`.github/workflows/ci.yml` の `validate` job の step として存在するだけである。

その 1 本を外しても他の検査は緑に終わる。release report と release が実際に実行する
コマンドを比較するものが repository に存在しなかったため、`not run` と `pass` が
同じ文面になっていた。この gate はその比較だけを行い、判定そのものは各検査 script の
権限として残す（到達性と verdict は別）。Issue #566 以降は `package.json` の entry point が
1 行の runner になり、実行順は `quality/profile.yaml` の `components` が持つ。

## 4 状態

| 状態 | 意味 | release を止めるか |
| --- | --- | --- |
| `pass` | 行が宣言したすべての surface で command に到達でき、runner file が存在する | — |
| `fail` | 主張が repository と矛盾する（command 未登録 / runner file 不在）、または必須検査が未実行 | **止める** |
| `not run` | command は存在するが、宣言した release surface のどれも実行していない | 必須行なら**止める**。任意行なら表示のみ |
| `N/A` | 未導入の検査。実文の理由（`reason`）を必ず持ち、command は持たない | 表示のみ（pass には数えない） |

`not run` と `N/A` を `pass` と同じ bucket に入れないことが、この gate の存在理由である。

## surface の定義

| surface | 由来 | 備考 |
| --- | --- | --- |
| `fast` | `quality/profile.yaml#gates.fast.components` を `scripts/run-quality-gates.mjs` が実行 | offline / read-only |
| `integration` | `gates.integration.components`（`fast` を展開） | `fast` を含む |
| `release` | `gates.release.components`（`integration` を展開） | `integration` を含む |
| `ci` | `.github/workflows/ci.yml` の `jobs.validate.steps[*].run` | `pnpm run validate:<gate>` はその gate の宣言 plan も展開する（Issue #470 の dependency advisory gate はここ） |

Issue #566 以降、entry point は `&&` チェーンではなく 1 行の runner である。
profile は「実行順そのもの」であり、宣言された component は runner が実際に実行する。
ただし、その宣言を到達性の事実として数えるのは entry point の body が
**完全に** `node scripts/run-quality-gates.mjs <gate>`（run mode）である場合だけである。
`--list` が付いた body や旧来のチェーンは宣言を実行しないので、rule 6 / rule 10 は
未到達として扱う。この独立した照合がないと、宣言だけを根拠に「実行した」と
報告する tautology に戻ってしまう。

`prod-smoke` workflow は surface に含めない。deploy 後の operator step であり、
release の事前判定ではない（`AGENTS.md` §5 / `docs/release.md` step 7）。台帳では
`production-smoke` 行が `not run` として明示される。

## silent pass を防ぐ構造

1. 必須行が宣言 surface に到達できない場合は **error**（warning ではない）。
2. `protected_checks` の行を削除する / `required: false` にする / `N/A` 化する → **error**。
   「意図的に省略する」という操作そのものが fail になる。
3. `protected_checks` が空なら **fail closed**。ガードを空にするだけでは無効化できない。
4. `quality/profile.yaml#gates.<level>.components` に `package.json` script が無い
   component（phantom step）、またはその entry point から到達できない component → **error**。
   profile を「実行された plan」として数えるのは、entry point の body が
   `node scripts/run-quality-gates.mjs <gate>` と完全一致する run mode のときだけであり、
   `--list` を付けた body や旧来のチェーンは宣言を実行しない。
   実在する差異 1 件（`deploy:cf:prebuilt:dry-run` は `deploy:cf:prebuilt:selftest`
   経由で実行される）は台帳の `profile_equivalences` に理由つきで記録してある。
5. release surface にある security 系 command で台帳に行が無いもの → `unaccounted`
   warning。検査を release 報告の外に足すことを可視化する（release 自体は止めない）。
6. `N/A` は実文の理由を要求し、`command` を持てない。

## fixture（正常 / 不正常）

| fixture | 内容 | 期待 |
| --- | --- | --- |
| `pass.json` | 必須検査がすべて surface に到達。任意 1 行が `not run`、1 行が `N/A` | errors 0 / warnings 0 / pass 3 |
| `missing-required-check.json` | **必須検査 `secret:scan` を release chain から外す** | errors 2 / not run 2。うち 1 件は `secret-scan-source … is not run`、もう 1 件は profile の canonical component と chain の不整合 |
| `unregistered-command.json` | `package.json` から必須検査の command を消す（台帳の行は残る） | errors 2 / fail 1。`not run` ではなく `fail`（command 自体が実行不能） |

同じ評価関数 (`evaluateReleaseGate`) が fixture と実 checkout の両方を駆動する。
レポートの false-green probe はこの fixture をそのまま描画するので、
スクリーンショットとテストが食い違えない。

## 実行手順（再現）

```bash
pnpm run release:gate:check             # 判定のみ（exit 0 / 1）
pnpm run release:gate:report            # .tmp/release-gate-report.html を生成
pnpm run verify:release-gate-screenshot # HTML を撮影し WebP 化
node --test scripts/check-release-gate-coverage.test.mjs
```

画像は検算の補助であり、判定そのものではない。判定は gate の終了コードと、
上の fixture を固定した unit test が担保する。

## 対象外と将来の手作業

この Issue が**導入していない**検査は `not_applicable` として理由つきで記録し、
pass には数えていない。

| 検査 | 理由 | 将来の姿 |
| --- | --- | --- |
| dynamic security scanning (DAST) | スキャン対象が無い。ADR-0014 は canonical production origin を 1 つ固定しており、本 repository に staging / preview origin は無い。AGENTS.md §4 は新サービスと外向き連携に ticket + ADR を要求し、本 Issue はどちらも追加しない | 検証可能な origin が用意された時点で、ticket + ADR を先に置く別 Issue |
| static security scanning (SAST / taint) | 採用ツールは Biome（AGENTS.md §2）。同 §11 は ESLint / Oxlint の追加を out of scope とする。Biome は taint analyser ではなく、2 つ目の静的解析器の導入は stack decision になる | ADR を置いた後の別 Issue |
| runtime WAF policy | WAF ruleset は repository 外の Cloudflare ダッシュボード設定であり、AGENTS.md §4 の ticket + ADR 対象。アプリ層の防御（header / CSP / rate limit / CSRF）は repository 内で検証済み | Cloudflare 側で設定する場合は運用 runbook の Issue |
| signed provenance（SBOM 署名） | SBOM 在庫の生成と検査は済んでいるが、署名の発行には Infisical / Workers Builds runbook が管理する release signing identity の運用判断が要る | owner decision の後に runbook Issue |
| independent penetration test | 外部 tester も report の契約も無く、release report のために作り出せない | 契約が確定した後の別 Issue |

`not run` 行（command は存在するが release chain に無いもの）:

| 検査 | 理由 |
| --- | --- |
| `production-smoke` (`pnpm run e2e:prod`) | deploy 後 Smoke #2 / #3 の operator step。pre-merge の release chain には載せない（`docs/release.md` step 7） |
| `ssrf-url-adapter-evidence` (`pnpm run security:ssrf:report`) | 契約は suite が毎回 assert する。picture はオンデマンド再生成であって release gate ではない |

## 既知の制約（scanner limits）

- 到達性は command chain 上の text の事実である。各検査が自分の verdict を何と言おうと、
  ここでは「release が走らせたか」しか見ていない。各検査 script が自己 verdict の権限を持つ。
- entry point が 1 行の runner である場合に限り、宣言（profile）を実行 plan として読む。
  runner の body が完全一致しない場合（`--list`、チェーン、別 command）は
  `package.json` の推移閉包だけを surface とし、宣言との差分を rule 10 が error にする。
- `pnpm run` の 1 段展開を前提にしており、shell 変数で組み立てた script 名は追えない。
- `ci` surface は `ci.yml` の `validate` job のみ。他の job と手動 workflow は surface ではない。
- 台帳は security / supply-chain / release-integrity に絞った curated inventory であり、
  `validate:fast` の全 40 component の写しではない（route 統合や多言語の完成を前提にしない）。

参照: OWASP ASVS（Issue の根拠リンク）。本 gate は ASVS の章立てを実装するものではなく、
「その検査を release が実行したか」を問うにすぎない。