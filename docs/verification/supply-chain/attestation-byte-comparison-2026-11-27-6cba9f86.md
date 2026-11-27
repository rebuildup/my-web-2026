# attestation と build output byte の照合記録（v0.15.0 Phase A / run 45909808204 / commit 6cba9f86）

`docs/release.md` §9.1 の **Phase A（freeze 対象候補 commit の freeze run
に対する照合）** の実行記録。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.15.0 |
| 候補 commit（freeze SHA） | `6cba9f86671b13a4b50b332caeee66ec5ab9413d`（release-0-15-0 head、PR #1249 merge commit） |
| 対象 manifest | `.tmp/release-manifest/6cba9f86…/0.15.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/6cba9f86…/` |
| **照合した run** | [45909808204](https://github.com/rebuildup/my-web-2026/actions/runs/45909808204)（`event=workflow_dispatch`、branch `release-0-15-0`、conclusion `success`） |

## 2. 手順と結果

```bash
SHA=6cba9f86671b13a4b50b332caeee66ec5ab9413d
RUN=45909808204
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/$SHA/0.15.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA

pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-manifest/$SHA/0.15.0/artifact-attestation.json
```

freeze run `45909808204` の `validate` job・`storybook axe` job ともに
success。`artifact-attestation-6cba9f86…` と `cf-build-output-6cba9f86…`
の両 artifact が同 run から取得できたことを確認した。

### 2.1 attestation check

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 631 file record(s) agree with the aggregate
PASS  Source commit: 6cba9f86671b13a4b50b332caeee66ec5ab9413d
PASS  Source tree: clean
PASS  Project: my-web-2026@0.15.0
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:31a45362cdbeb80a436a90e3c98ca931299ade0fdd438a6b8d3e194e797fe72b (631 file(s), 48433743 bytes)

status: PASS
```

### 2.2 bytes check

```text
[build-output-artifact] BYTES    match — 631 file(s), 48433743 byte(s), aggregate sha256 31a45362cdbeb80a436a90e3c98ca931299ade0fdd438a6b8d3e194e797fe72b
[build-output-artifact] SECRETS  clean — 193 file(s) scanned, 438 skipped as non-text or oversized
[build-output-artifact] PASS
```

v0.14.0 Phase A（630 files / 43.7MB）から +1 file / +4.7MB —
`public/github-profile/showcase-light.webp`（#1242 の Light バリアント、
4,742,904 bytes）が増分。attestation manifest・bytes は freeze SHA
`6cba9f86` と完全一致。
