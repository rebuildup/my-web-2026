# attestation と build output byte の照合記録（v0.17.0 Phase A / run 46142074171 / commit 2ef09c67）

`docs/release.md` §9.1 の **Phase A（freeze 対象候補 commit の freeze run
に対する照合）** の実行記録。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.17.0 |
| 候補 commit（freeze SHA） | `2ef09c67b8baf2dbc92a19f4c617dc8d674a531f`（release-0-17-0 head、PR #1327 merge 後。#1312 `daf82c24`・#1306 `d5ea18f9`・#1313 `bf803427`・bundle budget 再導出 `ce6eb56b`・E2E 収束 `2ef09c67` を含む） |
| 対象 manifest | `.tmp/release-manifest/2ef09c67…/0.17.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/2ef09c67…/` |
| **照合した run** | [46142074171](https://github.com/rebuildup/my-web-2026/actions/runs/46142074171)（`event=workflow_dispatch`、branch `release-0-17-0`、conclusion `success`、validate job + storybook axe job ともに success） |

先行 freeze run `46135686965`（`ce6eb56b`）は Playwright E2E 5 件 FAIL
で不成立。内訳は実 a11y 違反 1 件（/stack inverse band の secondary
Button コントラスト）と redesign merge 由来の spec 鮮度切れ 4 件で、
PR #1327（Issue #1323）で収束させた。本記録はその修正を含む最終候補に
対する Phase A 証跡である。

## 2. 手順と結果

```bash
SHA=2ef09c67b8baf2dbc92a19f4c617dc8d674a531f
RUN=46142074171
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA

node scripts/check-artifact-attestation.mjs \
  --manifest=.tmp/release-manifest/$SHA/0.17.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA

node scripts/check-build-output-artifact.mjs \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-manifest/$SHA/0.17.0/artifact-attestation.json
```

照合は `my-web-2026-release017` worktree（checkout HEAD = freeze SHA
`2ef09c67`）で実行したため `--source-sha` の付与は不要だった
（`docs/release.md` §9.1: release head の commit は HEAD と一致する）。

freeze run `46142074171` の `validate` job（`validate:integration` +
attestation 生成 + Playwright E2E + cf build output）と `storybook axe`
job ともに success。

### 2.1 attestation check

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 631 file record(s) agree with the aggregate
PASS  Source commit: 2ef09c67b8baf2dbc92a19f4c617dc8d674a531f
PASS  Source tree: clean
PASS  Project: my-web-2026@0.17.0
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:2ebb4451c05104db0f2e27a53280f73c4767ce3c5f2d01de6944b99757675b67 (631 file(s), 48507841 bytes)
```

### 2.2 build output byte 照合

```text
[build-output-artifact] BYTES    match — 631 file(s), 48507841 byte(s), aggregate sha256 2ebb4451c05104db0f2e27a53280f73c4767ce3c5f2d01de6944b99757675b67
[build-output-artifact] SECRETS  clean — 193 file(s) scanned, 438 skipped as non-text or oversized
[build-output-artifact] PASS
```

manifest の file record 集合・per-file digest・aggregate digest が
cf-build-output artifact の実 bytes と完全一致。secrets 混入なし。

## 3. 判定

**Phase A PASS。** freeze 対象候補 `2ef09c67` の build output bytes は
attestation manifest と byte 単位で一致し、secret を含まない。
`docs/release.md` §9 の freeze → Phase A → Phase B の順序に従い、
release PR #1315 の merge・tag `v0.17.0`・GitHub Release 公開へ進める。
