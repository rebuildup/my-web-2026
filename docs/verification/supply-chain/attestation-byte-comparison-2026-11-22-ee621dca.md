# attestation と build output byte の照合記録（v0.11.0 Phase A / run 44914392211 / commit ee621dca）

`docs/release.md` §9.1 の **Phase A（merge 前の候補検証）** である
「manifest を artifact と bytes の両方に対して照合する」実行記録。
対象は #1109 契約債務の解消（shared-styles 移行 + ui-contract 台帳整理）
と v16 サイトワイド画像レビュー記録を統合した freeze 候補であり、
tag 対象 commit の `main` push run に対する Phase B 照合は
`release-0-11-0 → main` 統合と tag 作成（owner 明示承認）の後に
別記録として実施する。

**先行候補の freeze run は validate FAIL のため、本候補の証拠と
して流用しない:**

- `6fa1332f`（run 44902618119）は Phase A PASS だったが、その後
  #1109 残存契約債務の解消でコード差分が発生し attested bytes が
  変わったため、新候補 `5c48a770` で freeze を再実施した。
- `5c48a770`（run 44912304709）は `bundle:budget:check` で
  `/links` initial JS が cap を 1,019 B 超過して FAIL →
  PR #1124 で headroom_policy の式どおり cap を再導出
  （645,000 B、`/links` のみ移動）。

本記録は新候補自身の run / artifact / bytes のみを対象とする。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.11.0（`package.json#version` = `0.11.0`） |
| 対象 branch | `release-0-11-0` |
| 対象 commit | `ee621dcacb82ef966af21a218e6efe9a81df09cf` |
| 対象 manifest | `.tmp/release-manifest/ee621dca…/0.11.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/ee621dca…/` |
| **照合した run** | [44914392211](https://github.com/rebuildup/my-web-2026/actions/runs/44914392211)（`event=workflow_dispatch`、branch `release-0-11-0`、conclusion `success`、headSha `ee621dca…`） |
| tag | 未作成（`release-0-11-0 → main` 統合と tag 作成は明示承認待ちのため、`--release-tag` 照合は tag 作成後に実施） |

本記録が照合したのは **CI run 44914392211 が作った artifact / bytes** である。
それ以外の run / commit / byte を名乗るものではない。

run の job 結果: `validate` success、`storybook axe` success。
E2E は **199 passed / 2 skipped / failed 0**。

## 2. 手順

`docs/release.md` §9.1（Phase A: merge 前の候補検証）と同じ。
artifact は同一 run から取得する:

```bash
SHA=ee621dcacb82ef966af21a218e6efe9a81df09cf
RUN=44914392211
gh run download $RUN -n artifact-attestation-$SHA \
  -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA \
  -D .tmp/release-bytes/$SHA
```

実行結果: 両 artifact は上記 run から取得済みで、manifest の配置は
`.tmp/release-manifest/ee621dca…/0.11.0/artifact-attestation.json`、
bytes の配置は `.tmp/release-bytes/ee621dca…/`（545 file(s)）である。

### 2.1 `pnpm run artifact:attestation:check`

```bash
pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/ee621dca…/0.11.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/ee621dca…
```

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 545 file record(s) agree with the aggregate
PASS  Source commit: ee621dcacb82ef966af21a218e6efe9a81df09cf
PASS  Source tree: clean
PASS  Project: my-web-2026@0.11.0
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:bdc7f6ec030227258689d8ff755595ecf11b40f16550cfca573e2d1edab1d12a (545 file(s), 37545153 bytes)

status: PASS
```

### 2.2 `pnpm run artifact:bytes:check`

```bash
pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/ee621dca… \
  --manifest=.tmp/release-manifest/ee621dca…/0.11.0/artifact-attestation.json
```

```text
[build-output-artifact] artifact: .tmp/release-bytes/ee621dca…
[build-output-artifact] manifest: .tmp/release-manifest/ee621dca…/0.11.0/artifact-attestation.json
[build-output-artifact] BYTES    match — 545 file(s), 37545153 byte(s), aggregate sha256 bdc7f6ec030227258689d8ff755595ecf11b40f16550cfca573e2d1edab1d12a
[build-output-artifact] SECRETS  clean — 191 file(s) scanned, 354 skipped as non-text or oversized
[build-output-artifact] PASS
```

status: **Phase A PASS**（attestation / byte 照合ともに）。

## 3. 観測（PASS を名乗らないものは明記）

- `validate:integration` 内の issue-closure audit は
  「21 manual item(s) outstanding / 0 human-verified」を報告する。
  owner 判断待ちの手動項目の可視化であり run は success。
  release 可否の最終判断は owner。
- copy-editorial approval は `pending` 記録を保持する
  （承認を捏造していない）。
- Dependabot advisory 17 件は owner 判定待ち。
- Cloudflare live Worker binding（Tier 3）は token 未供給で SKIP のまま。
