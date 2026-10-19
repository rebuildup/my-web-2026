# ASVS 適用範囲 coverage ledger (Issue #507)

**判定基準**: OWASP ASVS 5.0.0 の該当項目について、repository が今日持つ
証跡（test / doc / 実行される gate）を 1 行ずつ突き合わせる。証跡が無い項目は
**未検証 (`not run`)** として表示し、pass には数えない。主張した証跡が
repository に存在しない場合は `fail` であり、「未検証」ではない。

- manifest: [`quality/asvs-coverage.json`](../../../quality/asvs-coverage.json)（schema v1）
- gate: `pnpm run asvs:check`（`validate:fast` に結線されるので `validate:integration` / `validate:release` にも載る）
- report: `pnpm run asvs:report` → `.tmp/asvs-coverage-report.html`
- screenshot: `pnpm run verify:asvs-coverage-screenshot` → [`asvs-coverage-matrix.webp`](asvs-coverage-matrix.webp)（coverage matrix）と [`asvs-coverage-probes.webp`](asvs-coverage-probes.webp)（false-green probe）
- fixtures: `quality/fixtures/asvs-coverage/{pass,missing-evidence,missing-follow-up,unregistered-gate}.json`
- tests: `node --test scripts/check-asvs-coverage.test.mjs`
- profile: [`quality/profile.yaml`](../../../quality/profile.yaml) の `gates.fast.components`

## これは何であって何でないか

| であるもの | でないもの |
| --- | --- |
| 選択した ASVS 5.0.0 項目に対する repository 内の証跡台帳 | ASVS certification |
| 実行されている検査の到達性ごとの表示 | 監査（audit） |
| 未検証項目の可視化 | 標準全体への適合宣言 |

`quality/asvs-coverage.json#standard.certification` は `false` 固定であり、`true` にすると
gate が error になる。manifest の `standard.note` とレポートの
`NOT AN ASVS CERTIFICATION` バナーも同じ主張を繰り返す。

## 4 状態

| 状態 | 意味 | release を止めるか |
| --- | --- | --- |
| `pass` | 宣言した証跡がすべて解決する（ファイル存在 / 登録済みかつ surface 到達可能な gate） | — |
| `fail` | 主張が repository と矛盾する（ファイル不在 / 未登録 script / 宣言 surface に到達できない / 行の書式違反） | **止める** |
| `not run` | 適用対象だが証跡が無い。`follow_up` に将来の手作業を必ず持つ | 表示のみ（pass には数えない） |
| `not_applicable` | 対象 surface が無い。実文の `reason` を必ず持ち、`evidence` は持たない | 表示のみ（pass には数えない） |

`not run` と `N/A` を `pass` と同じ bucket に入れないことが、この gate の存在理由である。
無いものを「緑」と書く false green を、台帳そのものが構造的に拒否する。

## evidence の 3 種

| kind | 条件 |
| --- | --- |
| `test` | チェックイン済みの test file（Vitest / node:test / E2E）。`existsSync` で判定 |
| `doc` | operator / architecture ドキュメント。補助証跡。`existsSync` で判定 |
| `gate` | `pnpm run <script>` が **1 本だけ**。`package.json#scripts` に登録済みで、宣言した surface のすべてから到達できること |

`gate` の到達性は `validate:fast` / `validate:integration` / `validate:release` の
推移的 `pnpm run` 閉包と、`.github/workflows/ci.yml` の **`validate` job の
`run:` 行だけ**（YAML のコメントや別 job は数えない）から計算する
（Issue #508 の release gate ledger と同じ surface 定義）。
評価関数自体は `docs` だけの行を `pass` にもする（歴史的な判断文書は
documentation 要件に対する正直な証跡になりうるため）。そのため「pass 行には
実行可能な証跡（`test` か `gate`）が少なくとも 1 件あること」を
`scripts/check-asvs-coverage.test.mjs` の実 checkout テストが強制する。

## fixture（正常 / 不正常）

| fixture | 内容 | 期待 |
| --- | --- | --- |
| `pass.json` | 証跡が解決する 1 行 / 適用対象だが証跡なし（`follow_up` あり）1 行 / N/A 1 行 | errors 0 / pass 1 / not run 1 / N/A 1 |
| `missing-evidence.json` | 宣言した test file が存在しない | errors 1 / **fail** 1。`not run` ではなく `fail`（存在しないパスは「未検証」ではなく虚偽の主張） |
| `missing-follow-up.json` | 適用対象・証跡なし・`follow_up` なし（黙っての省略） | errors 1 / **fail** 1 |
| `unregistered-gate.json` | 宣言した gate が `package.json#scripts` に無い | errors 1 / **fail** 1 |

同じ評価関数 (`evaluateAsvsCoverage`) が fixture と実 checkout の両方を駆動する。
レポート下部の false-green probe はこの 4 fixture をそのまま描画するので、
スクリーンショットとテストが食い違えない。

未検証 / 対象外の各行の prose（`follow_up` / `reason`）は、画像内では先頭 110 文字
に clip する。全文は manifest とこの doc にあり、その旨をレポート上にも記す。45 行の
table に全文を載せると 300 KB の証跡予算に収まらず、optimizer が grayscale まで
落として行が読めなくなるためで、ledger の情報そのものは削っていない。

## 実行手順（再現）

```bash
pnpm run asvs:check                    # 判定のみ（exit 0 / 1）
pnpm run asvs:report                   # .tmp/asvs-coverage-report.html を生成
pnpm run verify:asvs-coverage-screenshot # HTML を撮影し WebP 化
node --test scripts/check-asvs-coverage.test.mjs
```

画像は検算の補助であり、判定そのものではない。判定は gate の終了コードと、
上の fixture を固定した unit test が担保する。レポートと画像は **working tree だけ** を読む
（Worker 起動も network も D1/R2 も secret も使わない）。

画像は 2 枚に分ける。coverage matrix（総数・未検証一覧・対象外一覧・45 行）を
`asvs-coverage-matrix.webp`、その下の false-green probe と実行手順を
`asvs-coverage-probes.webp` に撮る。1 枚の full-page では 300 KB の証跡予算に
収まらず、可読性を下げる quality しか選べない（列が読めない画像は証跡にならない）。
どちらも Chromium のメモリ上の PNG を `sharp` で WebP に再エンコードしたもので、
途中 PNG は作らない。テキストが対象なので lossy では読みにくくなるため、
`nearLossless` を優先し、予算に収まる最高 quality を選ぶ。

## 対象外の項目と理由

| 項目 | 理由 | 将来の姿 |
| --- | --- | --- |
| V1.2.5（OS command injection） | HTTP / SSR の実行経路に OS command 呼び出しが無い。`scripts/**` は operator tooling であり攻撃面ではない | 実行経路が追加された時点で同じ manifest に追加する |
| V1.5.1（XML / XXE） | Worker と SSR path が XML を parse しない | XML integration を置いた同じ Issue で追加する |
| V2.4.2（L3 の人間 timing 要件） | 本 ledger の target level は L1 / L2 | L3 を target にする Issue で再評価 |
| V4.3.1（GraphQL） | 外部境界は Hono の REST route のみ | GraphQL を置いた Issue |
| V4.4.1（WebSocket / realtime） | Worker に WebSocket endpoint が無い | realtime を置いた Issue |
| V9.1.1（client-side session token） | session は D1 実装の Better Auth reference token、API key は server-side scope | client storage に token をおく方式を採った Issue |
| V13.4.1（deploy artifact に .git / .svn が無いこと） | Workers の deploy は生成済み Build Output（bundle と `dist/client` の asset tree）だけを upload し、Worker には filesystem が無い。checkout をそのまま公開する surface が無い | Build Output に VCS metadata が入り得る経路（submodule や asset の copy）が追加されたら、同じ manifest に戻して artifact の検査を証跡にする |
| V14.3.1（client storage の認証データを消去） | `src/**` は localStorage / sessionStorage / IndexedDB を読み書きしない。認証情報は HttpOnly cookie（`src/cloudflare/auth/session-cookie-contract.test.ts` が属性を固定。cookie cache の 5 分間も同様）と D1 の session row にあり、script から読めない | client storage に認証情報を書く方式を採った Issue。その時点で `not_applicable` を `applicable` に戻す |
| V10.1.1（OIDC / social login） | social / OIDC provider を構成していない。OAuth callback 面は所有者 Issue が未決 | owner decision 後の別 Issue |
| V17.1.1（TURN） | WebRTC / TURN / media signaling surface が無い | realtime 面の Issue |

## `not run`（適用対象だが証跡が無い項目）

| 項目 | 将来の手作業 |
| --- | --- |
| V3.4.3（enforcing CSP） | 現在は `Content-Security-Policy-Report-Only`（#447）。enforcing 化の判断は owner decision |
| V6.3.3（MFA または同等 Combining） | MFA は未実装。admin 面の要否は owner decision |
| V7.4.3（全セッション終了の選択肢） | パスワード変更後に他セッションを全て終了する repository 証跡が無い |
| V8.2.2（data-specific access control） | admin matrix は function-level を証明するのみで、data-specific な IDOR/BOLA の証跡が無い |
| V15.2.1（更新・修正の期限を破っていない component だけを持つ） | `pnpm run dep-audit:check` は CI 専用かつ `enforcement: audit` で、blocking finding を出して落ちない。lockfile に未処理の critical/high が残り、severity ごとの修正期限もどの文書にも書かれていない |
| V16.1.1（logging inventory：層・イベント・format・保管先・利用・アクセス制御・保持期間） | `docs/security/log-redaction.md` は「何が書けるか」（redaction, #467）を書いているが、保管先・読み手・保持期間には触れない |

この 6 件は「緑」と書かない。台帳は `not run (unverified)` として表示し、
pass 件数に含めない。V15.2.1 と V16.1.1 は「その要求に対応する repository 証跡が
まだ無い」という意味で、既存の別要件の証跡（SBOM / pin、redaction）を借りれば
pass になるが、それは要求を満たしていない。どちらを直すか（gate の escalation を
owner が決めるか、inventory を誰がどこへ書くか）は owner decision で、
manifest の `follow_up` に将来の手作業として残してある。

## 既知の制約（scanner limits）

- manifest は **選択**した項目の一覧であり、ASVS 全 345 項目の写しではない。
  選択した章は V1 / V2 / V3 / V4 / V5 / V6 / V7 / V8 / V9 / V10 / V13 / V14 /
  V15 / V16 / V17 であり、章の並びを固定しない。**V11（Cryptography）と
  V12（Secure Communication）は 1 行も置いていない** — 引用も証跡も無い状態で
  適用対象と宣言しないため。埋めるには ASVS 5.0.0 原文からの requirement text と
  証跡（または reason）が要る。これは未決事項として PR 本文に残す。
- `requirement` の文と `level` は ASVS 5.0.0 の当該 requirement と照合済み。
  `chapter` / `section` は原文の章名・節名に requirement ID を付けた表記
  （例: `"V1 Encoding and Sanitization"`）であり、逐語の写しではない。
- 到達性は command chain 上の text の事実である。各検査が自分の verdict を何と言おうと、
  ここでは「その検査が release で走るか」しか見ていない。verdict の権限は各検査 script にある。
- `pnpm run` の推移閉包を前提にしており、shell 変数で組み立てた script 名は追えない。
- evidence の `test` は **存在**を確かめるもので、その test が当該要求を
  assert しているかは行ごとの `control` 記述とレビューに委ねる。
  行を 1 つ増やすレビュー負荷があるため、本 gate はそれを隠さず
  「registry である」こと（本 gate は適用範囲の可視化であり、適合の判定ではない）を
  manifest とレポートの両方に書いている。
- `docs` のみの行を `pass` にするのは、歴史的な判断文書が documentation 要件に対する
  正直な証跡になりうるため。実行可能な証跡（`test` / `gate`）との対は、実 checkout
  を評価する `scripts/check-asvs-coverage.test.mjs` の
  "gives every pass row an executable evidence item" が担保する。
- `pass` は「宣言した証跡が解決する」ことしか意味しない。証跡となる `test` が
  その requirement を assert しているかは manifest の `control` / `note` とレビューに
  委ねられる。この差を塞ぐため、本 PR では証跡が要求と無関係だった 7 行を、
  正しい control / 証跡への付け替え（V4.1.1 / V13.3.2 / V15.2.2）か
  `not_applicable`（V13.4.1 / V14.3.1）、`not run`（V15.2.1 / V16.1.1）への
  降格のどちらかで正直にしている。
