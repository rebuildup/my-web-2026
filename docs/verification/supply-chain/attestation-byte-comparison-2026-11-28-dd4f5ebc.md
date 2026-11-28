# attestation と build output byte の照合記録（v0.16.0 Phase A / run 46103659171 / commit dd4f5ebc）

`docs/release.md` §9.1 の **Phase A（freeze 対象候補 commit の freeze run
に対する照合）** の実行記録。先行記録
[`attestation-byte-comparison-2026-11-28-a7f0511a.md`](./attestation-byte-comparison-2026-11-28-a7f0511a.md)
は #1282 / #1285 merge 前の候補に対するもので、本記録が現行の最終候補に
対する Phase A 証跡である。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.16.0 |
| 候補 commit（freeze SHA） | `dd4f5ebc88cd354865ede2ae89c56bb87e404afc`（release-0-16-0 head、#1285 merge 後。#1282 `e7b08915`・#1285 `dd4f5ebc` を含む） |
| 対象 manifest | `.tmp/release-manifest/dd4f5ebc…/0.16.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/dd4f5ebc…/` |
| **照合した run** | [46103659171](https://github.com/rebuildup/my-web-2026/actions/runs/46103659171)（`event=workflow_dispatch`、branch `release-0-16-0`、conclusion `success`、validate job 10m47s） |

## 2. 手順と結果

```bash
SHA=dd4f5ebc88cd354865ede2ae89c56bb87e404afc
RUN=46103659171
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA

node scripts/check-artifact-attestation.mjs \
  --manifest=.tmp/release-manifest/$SHA/0.16.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA

node scripts/check-build-output-artifact.mjs \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-manifest/$SHA/0.16.0/artifact-attestation.json
```

照合は `release-0-16-0-verify` worktree（checkout HEAD = freeze SHA
`dd4f5ebc`）で実行したため `--source-sha` の付与は不要だった
（`docs/release.md` §9.1: release head の commit は HEAD と一致する）。

freeze run `46103659171` の `validate` job（`validate:integration` +
attestation 生成 + Playwright E2E + cf build output）と `storybook axe`
job ともに success。

### 2.1 attestation check

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 631 file record(s) agree with the aggregate
PASS  Source commit: dd4f5ebc88cd354865ede2ae89c56bb87e404afc
PASS  Source tree: clean
PASS  Project: my-web-2026@0.16.0
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:7016728ae212905172718e7db2f5b81228efdeeebde9865321567d754fd9f8d4 (631 file(s), 48434575 bytes)

status: PASS
```

### 2.2 bytes check

```text
[build-output-artifact] BYTES    match — 631 file(s), 48434575 byte(s), aggregate sha256 7016728ae212905172718e7db2f5b81228efdeeebde9865321567d754fd9f8d4
[build-output-artifact] SECRETS  clean — 193 file(s) scanned, 438 skipped as non-text or oversized
[build-output-artifact] PASS
```

先行候補 `a7f0511a`（631 files / 48,430,047 bytes、digest `c430b35f…`）
との差分は #1282（home: NOW facts 列・AdRect/AdLeaderboard の locked
height → minHeight floor・ui-contract allowlist shrink）と #1285
（portfolio: detail hero の media-led Split 再構成）の bundle 差 —
file 数は同一、bytes は +4,528。

## 3. 残存注意

- freeze SHA `dd4f5ebc` は #1285 merge 直後の head。本記録・step-9 記録・
  v19 README 既知制限の追記は freeze 後の docs-only commit であり、
  v0.15.1 / a7f0511a と同じ運用（freeze SHA を候補として保持、head の
  docs 差分は attestation 対象外）に従う。
- 並行 PR #1299（Selected Works band）・#1300（サイト再設計の監査・
  コンセプト正本）はユーザー判断により **v0.16.0 対象外**（Epic #1266
  Part B の次期リリースライン）。両 PR にコメントで記録済み。これらが
  merge された場合は release head が進むため、次期リリース側で改めて
  freeze が必要になる。
