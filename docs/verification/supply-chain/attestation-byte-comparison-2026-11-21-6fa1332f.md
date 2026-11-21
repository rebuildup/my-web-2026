# attestation と build output byte の照合記録（v0.11.0 Phase A / run 44902618119 / commit 6fa1332f）

`docs/release.md` §9.1 の **Phase A（merge 前の候補検証）** である
「manifest を artifact と bytes の両方に対して照合する」実行記録。
対象は ADR-0022 移行・HOME 再構成・axe/E2E ドリフト修正を統合した
freeze 候補であり、tag 対象 commit の `main` push run に対する
Phase B 照合は `release-0-11-0 → main` 統合と tag 作成
（owner 明示承認）の後に別記録として実施する。

**先行する 3 候補の freeze run はいずれも validate FAIL のため、
本候補の証拠として流用しない:**

- `b77ab61e`（run 44896660153）: Playwright axe が `/stack` の
  `target-size` と `/contact` の `link-in-text-block` の新規違反を
  検出 → PR #1120 で修正
- `fd65b5eb`（run 44899508352）: `e2e/a11y/keyboard-navigation.spec.ts`
  が文書化された `reactions disabled` marker を要求するのに対し、
  f883ebb0 の中立文言が marker を失っていた → PR #1121 で修正
- `1e2e3cbd`（run 44901094773）: `e2e/smoke.spec.ts` と
  `EXPECTED_SECTION_COUNTS['/']` が HOME の 5 節契約を pin していたが、
  v13 sponsored zone で 6 節になっていた → PR #1122 で修正

本記録は新候補自身の run / artifact / bytes のみを対象とする。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.11.0（`package.json#version` = `0.11.0`） |
| 対象 branch | `release-0-11-0` |
| 対象 commit | `6fa1332f4862f77b091d064653dee52b293a0f8b` |
| 対象 manifest | `.tmp/release-manifest/6fa1332f…/0.11.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/6fa1332f…/` |
| **照合した run** | [44902618119](https://github.com/rebuildup/my-web-2026/actions/runs/44902618119)（`event=workflow_dispatch`、branch `release-0-11-0`、conclusion `success`、headSha `6fa1332f…`） |
| tag | 未作成（`release-0-11-0 → main` 統合と tag 作成は明示承認待ちのため、`--release-tag` 照合は tag 作成後に実施） |

本記録が照合したのは **CI run 44902618119 が作った artifact / bytes** である。
それ以外の run / commit / byte を名乗るものではない。

run の job 結果: `validate` success、`storybook axe` success。
E2E は **199 passed / 2 skipped / failed 0**。

## 2. 手順

`docs/release.md` §9.1（Phase A: merge 前の候補検証）と同じ。
artifact は同一 run から取得する:

```bash
SHA=6fa1332f4862f77b091d064653dee52b293a0f8b
RUN=44902618119
gh run download $RUN -n artifact-attestation-$SHA \
  -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA \
  -D .tmp/release-bytes/$SHA
```

実行結果: 両 artifact は上記 run から取得済みで、manifest の配置は
`.tmp/release-manifest/6fa1332f…/0.11.0/artifact-attestation.json`、
bytes の配置は `.tmp/release-bytes/6fa1332f…/`（545 file(s)）である。

### 2.1 `pnpm run artifact:attestation:check`

```bash
pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/6fa1332f…/0.11.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/6fa1332f…
```

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 545 file record(s) agree with the aggregate
PASS  Source commit: 6fa1332f4862f77b091d064653dee52b293a0f8b
PASS  Source tree: clean
PASS  Project: my-web-2026@0.11.0
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:3ae5e85b202089e6af822f04d8d3ff89bfb52208fb1d904a828601ce0620ab98 (545 file(s), 37613911 bytes)

status: PASS
```

### 2.2 `pnpm run artifact:bytes:check`

```bash
pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/6fa1332f… \
  --manifest=.tmp/release-manifest/6fa1332f…/0.11.0/artifact-attestation.json
```

```text
[build-output-artifact] BYTES    match — 545 file(s), 37613911 byte(s), aggregate sha256 3ae5e85b202089e6af822f04d8d3ff89bfb52208fb1d904a828601ce0620ab98
[build-output-artifact] SECRETS  clean — 191 file(s) scanned, 354 skipped as non-text or oversized
[build-output-artifact] PASS
```

## 3. 判定と観測

- `artifact:attestation:check`: **PASS**
- `artifact:bytes:check`: **PASS**
- manifest の source commit `6fa1332f…`・project version `0.11.0`・
  lockfile digest・worker identity がすべて一致。bytes は manifest の
  file list と 545 file / 37,613,911 byte で完全一致し、secret 形状の
  スキャンも clean。
- freeze run の artifact: `artifact-attestation-6fa1332f…`、
  `cf-build-output-6fa1332f…`、`sbom-6fa1332f…`、
  `dependency-advisory-report-6fa1332f…`（run から取得済み）。
- `validate:integration` 内の issue-closure audit は
  「21 manual item(s) outstanding / 12 criterion unverified」を
  報告するが、これは owner 判断待ちの手動項目の可視化であり、
  run の conclusion は success（fail-closed ではなく報告のみ）。

## 4. 境界

- attested scope は GitHub Actions production-mode build output のみ。
  Cloudflare-deployed bytes は attestation 対象外（owner 決定
  2026-10-19）。デプロイ後の実測は merge/tag/デプロイ後に実施する。
- signature: unsigned（署名鍵なし、owner 決定どおり）。
- 本記録は merge 前候補の証拠であり、Phase B（tag 対象 commit の
  `main` push run 照合）を代替しない。

status: Phase A PASS（候補 `6fa1332f`、run 44902618119）
