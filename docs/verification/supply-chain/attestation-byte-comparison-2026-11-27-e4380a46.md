# attestation と build output byte の照合記録（v0.15.1 Phase A / run 45923957988 / commit e4380a46）

`docs/release.md` §9.1 の **Phase A（freeze 対象候補 commit の freeze run
に対する照合）** の実行記録。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.15.1 |
| 候補 commit（freeze SHA） | `e4380a46ee9f889d2bb1c5fbaca38a4770dd86b0`（release-0-15-1 head） |
| 対象 manifest | `.tmp/release-manifest/e4380a46…/0.15.1/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/e4380a46…/` |
| **照合した run** | [45923957988](https://github.com/rebuildup/my-web-2026/actions/runs/45923957988)（`event=workflow_dispatch`、branch `release-0-15-1`、conclusion `success`） |

## 2. 手順と結果

```bash
SHA=e4380a46ee9f889d2bb1c5fbaca38a4770dd86b0
RUN=45923957988
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/$SHA/0.15.1/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA

pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-manifest/$SHA/0.15.1/artifact-attestation.json
```

freeze run `45923957988` の `validate` job・`storybook axe` job ともに
success。両 artifact が同 run から取得できたことを確認した。

### 2.1 attestation check

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 631 file record(s) agree with the aggregate
PASS  Source commit: e4380a46ee9f889d2bb1c5fbaca38a4770dd86b0
PASS  Source tree: clean
PASS  Project: my-web-2026@0.15.1
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:20fa2cb1d2a090a452aa9a5f5c7efcc0a0292e528811bb6e671f2b4d7512df5a (631 file(s), 48433839 bytes)

status: PASS
```

### 2.2 bytes check

```text
[build-output-artifact] BYTES    match — 631 file(s), 48433839 byte(s), aggregate sha256 20fa2cb1d2a090a452aa9a5f5c7efcc0a0292e528811bb6e671f2b4d7512df5a
[build-output-artifact] SECRETS  clean — 193 file(s) scanned, 438 skipped as non-text or oversized
[build-output-artifact] PASS
```

v0.15.0 Phase A（digest `31a45362…`）との差分は `src/http/stats/router.ts`
の ingest body 上限変更による bundle 差 — file 数・lockfile・依存は同一。
