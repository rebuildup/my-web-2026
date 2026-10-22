# 脆弱性報告 → 修正 → 公開判断 runbook (Issue #478)

> 外部からの脆弱性報告を **status-only の証拠**に落としたまま、本番を触らず
> に priority を確定し、修正を release gate を通し、公開判断（advisory /
> 告知 / 非公開の記録）を残すまでの一連の手順。Issue #478 の成果物であり、
> `quality/security-disclosure.json`（ledger）がこの文書の機械可読な半分。
>
> Cross-linked from [`docs/security.md`](../security.md),
> [`AGENTS.md §5`](../../AGENTS.md),
> [`quality/profile.yaml`](../../quality/profile.yaml),
> [`skills/security-maintenance/SKILL.md`](../../skills/security-maintenance/SKILL.md).

**この runbook はインシデント記録ではない。** ここに現れる報告は
`quality/fixtures/security-disclosure/` の合成 fixture であり、判定は
`pnpm run security:disclosure:check` が local で再現する。

---

## 1. status-only 契約

本 flow が出力してよいのは **verdict / priority / duty id / 件数 / reason
code** だけである。下列はいずれも出力しない。

| 出力しないもの | 代わりに使うもの |
| --- | --- |
| 報告者が貼った値（credential / token / cookie） | `credential_disclosed: true` 等の boolean |
| 再現 payload / request・response body | fixture 名と、観測結果の boolean |
| 本番 URL・本番 object key | surface の名前（`internet_reachable` 等） |
| secret の値 | secret の**名前**と `MATCH` / `DIFFER` / `MISSING` |

前段落の根拠は AGENTS.md §4（実環境に対する値列挙の禁止）と
[`docs/runbook/infisical-secrets.md`](infisical-secrets.md)（status-only の
precedent）。**fixture も screenshot も例外ではない。** credential-shaped な
literal を repository に書けば `pnpm run secret:scan` が fail するのがまさに
その設計であり、hostile fixture は値ではなくレシピ（`hostile.shape`）だけを
保存し、実行時にメモリ上で組み立てて捨てる。

禁止される操作（`prohibited_operations`）:

1. **値列挙** — `infisical secrets …` / `wrangler secret list` /
   `printenv` / `cat .dev.vars`。比較は status-only の専用
   script が行う。
2. **本番再現** — 最初にProduction を叩くこと。再現は fixture か local の
   workerd pool か、operator が明示的に承認した smoke のみ。
3. **remote mutation** — production の D1 / R2 / Worker をこの flow で
   書き換えない。rotation / revocation は operator が実行し、結果だけを
   記録する。
4. **release merge** — release PR の merge・tag push・GitHub Release 発行
   は owner 承認（AGENTS.md §6）。agent は readiness を報告するだけ。
5. **修正前の公開詳細** — PoC / 再現手順 / 観測した credential は、修正が
   release されるまで public Issue・commit message・log・report に出さない。

## 2. 受付 / intake

- 報告は 1 件の record に落とす。**record は報告の写しではなく link。**
- 销售渠道は現状 2 つ（[`docs/security.md`](../security.md)）:
  非緊急は GitHub Issue、緊急（live exploitation / credential 漏えい）は
  `CODEOWNERS` / repository Settings → Code security に記録された operator
  渠道。
- `/.well-known/security.txt` は **未公開**（Issue #468、endpoint は `404`）。
  承認された reporting channel が無いので、runbook は「どのメールが
  監視されているか」を **推測しない**。security.txt が
  `200` になった時点で、この節の销售渠道表を差し替える。
- 受理時に依頼する文面: exploit detail と credential は private channel へ、
  再現は可能な範囲で boolean 観測として（payload は不要）。

出力（status-only）:

```text
[disclosure] intake channel=github_issue class=credential_disclosure detail_public=false
```

## 3. 優先度判定 / triage

判定材料は **severity ではなく、project への到達可能性**（
[`skills/security-maintenance/SKILL.md` §3](../../skills/security-maintenance/SKILL.md)）。
ledger の `priority_rules` は先頭一致の順序付きルールで、次の上から評価する。

| # | Priority | 条件 | 意味 |
| --- | --- | --- | --- |
| 0 | `P0` | `credential_disclosed = true` | credential は到達可能性に関係なく compromised 扱い。封じ込めが修正より先 |
| 1 | `P0` | `exploit_observed = true` | 実観測された悪用。sprint 計画を中断し patch release |
| 2 | `P1` | `internet_reachable = true` かつ `pre_auth = true` | 未認証で外から到達。current release の blocking 候補 |
| 3 | `P2` | `internet_reachable = true` | 到達はするが認証後 / 経路が限定。近距離 release の ticket |
| 4 | `P3` | 上記いずれでもない | この deployment の露出面に届かない。dependency hygiene / defence in depth |

CVSS が高いだけで `P0` にしない。逆に CVSS が中程度でも未認証・本番露出なら
上げる。判定は `(P1, rule #2)` のように **どの rule で出たかを必ず併記**する
（どのみtenance slot で再判定されたかを追えるようにするため）。

## 4. 再現の固定 / reproduce

- 再現は **fixture か local workerd pool**（[`docs/development.md`](../development.md)）。
  production は最初に叩かない。
- 事実を boolean と class に畳む。保持しないもの: payload、request/response
  body、本番 URL、credential、token、cookie。
- fixture は削除ではなく `quality/fixtures/security-disclosure/` に残す。
  hostile な値はレシピとして保存する（§1）。
- 依存側の advisory へ着地した場合は
  [`docs/runbook/dependency-advisories.md`](dependency-advisories.md) へ
  引き継ぐ。`pnpm run dep-audit:check` は registry endpoint が必要なため
  offline な `validate:fast` には入っていない（CI ステップ）。

## 5. 修正と回帰 / fix

- ticket branch は Issue 番号のみ（`123`）、base は `release-x-y-z`
  （[AGENTS.md §6](../../AGENTS.md)）。
- 脆弱パスが閉じていることを **suite に載った回帰テスト** で示す。
  テストファイルは `package.json#scripts.test` から到達可能でなければ
  ならない（`pnpm run test:wiring:check`、Issue #247）。配線されていない
  テストは「テストが無い」と同じ意味である。
- 修正 diff の review では「何が攻撃可能だったか」を diff の外（private
  channel）で述べ、public side には closed されたという事実だけを残す。

## 6. release gate / gate

- `pnpm run validate:release` と CI の `validate` job が **fix commit 上で**
  green であること。gate は
  [`docs/release.md`](../release.md) の sprint cycle が正本。
- 「green だが inspect の一つかけていない」を検出するのが
  `pnpm run release:gate:check`（`quality/release-gate.json`）。`not run` と
  `not applicable` は pass ではない。
- 既存 gate の位置づけ（本 flow の変更対象は何かを明確にするため）:
  `secret:scan`（source / bundle）、`csrf:contract:check`、
  `security:headers:check`、`asvs:check`、`sbom:check`、
  `install:scripts:check`、`dep-audit:check`。全て
  [`quality/profile.yaml`](../../quality/profile.yaml) に記録がある。
- production への deploy は Cloudflare Workers Builds が所有する
  （GitHub Actions は検証と手動 smoke のみ、
  [`docs/runbook/cloudflare-workers-builds.md`](cloudflare-workers-builds.md)）。
  本 flow は deploy 手段を持たない。

## 7. 公開判断 / disclose

公開判断は **修正が release された後**、そして owner の承認が前提。

1. advisory（GitHub Security Advisory / release note）publish。
2. Issue 参照のみ（advisory を立てない判断）。
3. **何も公開しない**判断（例: 情報漏洩以外的内部事象で、まだリスクが
   未整理）。**これは「記録される判断」であり、既定で省略してはいけない。**
   `advisory_recorded` が false のまま `COMPLETE` にはできない。

判断の根拠として必ず残すもの: priority、適用した rule、修正 commit、
公開範囲（何种を出したか）、owner 承認の事実と日付。

出してはいけないもの（§1 の再掲）: 観測した credential の値、攻撃者の
実データ、step-by-step の exploit、再現 payload。

## 8. 事後処理 / follow-up

- **credential が関わっていた場合**: revoke と rotation が完了しているかを
  boolean で記録（`credential_containment`）。結果は status-only。実際の
  rotation は [`docs/runbook/infisical-secrets.md`](infisical-secrets.md) と
  専用 script が行う。
- **再発防止**:「同じ報告を次回は人手判定しない」ように、どの gate / 契約が
  増えるかを 1 行で残す。gate が増えれば `quality/release-gate.json` と
  `quality/profile.yaml` の両方を更新する（片方だけの更新は drift として
  gate が落とす）。
- **Rule の変更**: `priority_rules` の並びを変えると全 report の分類が
  変わる。`docs/runbook/security-disclosure.md` の表と
  `quality/security-disclosure.json` の両方を同じ PR で更新する。

---

## 9. 正常時の観測

```text
$ pnpm run security:disclosure:check
[disclosure] ledger=quality/security-disclosure.json stages=7 duties=11 priorities=4 probes=5
[disclosure] probe=complete-p0 verdict=COMPLETE priority=P0 duties=10/10 reasons=-
[disclosure] probe=complete-p2 verdict=COMPLETE priority=P2 duties=6/6 reasons=-
[disclosure] probe=missing-regression-test verdict=INCOMPLETE priority=P1 duties=8/9 reasons=regression_test
[disclosure] probe=published-before-fix verdict=INCOMPLETE priority=P1 duties=8/9 reasons=detail_withheld_until_fix,public_detail_before_fix
[disclosure] probe=pasted-credential verdict=LEAK_REFUSED priority=P0 duties=9/10 reasons=credential_shaped_value
[disclosure] verdict=OK headings_resolved=7 commands_resolved=8 references_resolved=14
```

`verdict=OK` のとき、runbook の heading・duty の evidence・参照先・`pnpm run`
command がすべて解決し、5 本の probe が期待どおりの verdict を返している。

### スクリーンショット

コミット済み検証物
[`docs/verification/security/disclosure-runbook.webp`](../verification/security/disclosure-runbook.webp)
は上記と同じ evaluator と fixture から生成した report の撮影である
（`pnpm run verify:security-disclosure-screenshot`）。Issue が `.png` と
書いているが、同ディレクトリの他 artefact と同じく WebP で納める（Playwright
は WebP を書けないため、メモリ上の capture を `sharp` で再エンコードし、
途中 PNG は作らない）。**画像は証拠であって判定の代用ではない** — 判定は
exit code と `node --test scripts/check-security-disclosure.test.mjs` が担う。

## 10. 異常時の観測と手順

`[disclosure] verdict=FAIL problems=<n>` のとき、`- ` で始まる行が 1 行 =
1 問題。codes と対処:

| code | 意味 | 対処 |
| --- | --- | --- |
| `stage_heading_not_documented` | ledger の stage に対応する heading が runbook に無い（改名や削除の drift） | runbook に heading を戻すか、ledger の stage を更新する。片方だけの変更は drift |
| `command_not_registered` | runbook が呼ぶ `pnpm run <name>` が `package.json#scripts` に無い | script 名を直すか、実体を足す。名前だけの step は走らない |
| `reference_unresolved` | 参照先が repository に無い | link を直す（移動・削除された文書の可能性） |
| `duty_evidence_missing` | duty が指す evidence（runbook / gate / manifest）が無い | duty を実装するか、duty を消す。**両方を残さない** |
| `priority_without_rule` / `rule_without_priority_entry` | priority と rule の対応が切れている | 対応表を直す |
| `priority_without_required_duties` / `priority_names_undefined_duty` | priority に duty が無い、または未定義の duty を参照 | 必須 duty を宣言する。空の宣言は pass にされない |
| `probe_mismatch` | fixture の期待と evaluator の結果が食い違う（fixture / evaluator / ledger のどれかが嘘） | どれが嘘かを決める。**期待値を実装に合わせ直すことで緑にするのは禁止** |
| `probe_unevaluable` / `unknown_report_field` / `unknown_duty` | fixture が ledger が知らない fact / duty を使っている | fixture を ledger の語彙に寄せる。未知の field を false 扱いしない |
| `manifest_unreadable` / `manifest_not_an_object` | ledger を読めない | fail-closed。0 件扱いにしない |
| `empty_roster: <name>` | roster が空 | 空 roster は gate を黙らせるので必ず error |

3 つの verdict の扱い:

- `COMPLETE` — priority が必要とする duty がすべて記録されている。
- `INCOMPLETE` — duty が足りない、または修正前の公開詳細が記録されている。
  **pass に落とさない。** 足りていない duty id が reasons に出るので、
  次の行動はその id を読むだけ。
- `LEAK_REFUSED` — 報告 text に credential-shaped な値があった。値は出力
  されない。fixture / report に値を書かないこと（§1）。実運用では
  「値を貼らないでほしい」という依頼を、report に貼り直さない。

### fixture だけ実行する（demo / 確認）

```bash
pnpm run security:disclosure:check -- --fixture=quality/fixtures/security-disclosure/complete-p0.json
# -> [disclosure] fixture=… verdict=COMPLETE priority=P0 duties=10/10 reasons=- source=fixture
```

`--fixture` は gate ではなく **確認用**。exit code は fixture の verdict を
そのまま返すだけで、runbook / ledger の drift は見ない（drift を見たいのは
gate 側）。

## 11. この gate が見ないもの（scope）

| 対象 | なぜこの gate では閉じないか |
| --- | --- |
| security.txt の publish 判断 | Issue #468 の owner 決定。channel が決まるまで `404` が正しい状態。runbook は推測しない |
| advisory 本文の品質 | 公開判断の存在を gate にするのは scope 越过。内容は owner review |
| production の実測（実際の到達可能性） | 本番を叩かないことが §1 の契約。実測は operator の承認済み smoke のみ |
| credential の rotation 実行 | operator の操作。gate は結果の boolean を見るだけ |
| dependency advisory の取得 | registry endpoint が要るため CI ステップ（Issue #470）。`docs/runbook/dependency-advisories.md` が正本 |
| R2 key-set 監査 | credential が要るため operator 実行（Issue #577、`docs/runbook/r2-media-key-set-audit.md`） |

## 12. 参照

- [`quality/security-disclosure.json`](../../quality/security-disclosure.json) —
  flow・priority rule・duty・禁止操作の SoT。
- [`scripts/check-security-disclosure.mjs`](../../scripts/check-security-disclosure.mjs) —
  evaluator と CLI（status-only）。
- [`scripts/check-security-disclosure.test.mjs`](../../scripts/check-security-disclosure.test.mjs) —
  判定の権威。
- [`scripts/make-security-disclosure-report.mjs`](../../scripts/make-security-disclosure-report.mjs) —
  report / スクリーンショット生成。
- [`docs/security.md`](../security.md) — 公開されている security policy。
- [`docs/security/security-txt.md`](../security/security-txt.md) — Issue #468。
- [`docs/runbook/infisical-secrets.md`](infisical-secrets.md) — secret の SoT と
  status-only 出力。
- [`docs/runbook/cloudflare-workers-builds.md`](cloudflare-workers-builds.md) —
  release 順序と rollback。
- [`docs/runbook/dependency-advisories.md`](dependency-advisories.md) — 依存側の flow。
- [`skills/security-maintenance/SKILL.md`](../../skills/security-maintenance/SKILL.md) —
  source priority・inventory・P0-P3。
- [`AGENTS.md` §4 / §6](../../AGENTS.md) — 値列挙の禁止と release merge の owner gate。

外部参照: OWASP ASVS
(<https://owasp.org/www-project-application-security-verification-standard/>)、
RFC 9116 (`/.well-known/security.txt`)。

どの step も secret を読まない、Cloudflare binding を変更しない、本番を
変更しない。