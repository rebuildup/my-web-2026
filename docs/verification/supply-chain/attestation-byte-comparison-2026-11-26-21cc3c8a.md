# attestation と build output byte の照合記録（v0.14.0 Phase A / run 45817045977 / commit 21cc3c8a）

`docs/release.md` §9.1 の **Phase A（freeze 対象候補 commit の freeze run
に対する照合）** の実行記録。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.14.0 |
| 候補 commit（freeze SHA） | `21cc3c8ae2fd28bce26216c80f8f824b6d32ce11`（release-0-14-0 head、PR #1237 merge commit） |
| 対象 manifest | `.tmp/release-manifest/21cc3c8a…/0.14.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/21cc3c8a…/` |
| **照合した run** | [45817045977](https://github.com/rebuildup/my-web-2026/actions/runs/45817045977)（`event=workflow_dispatch`、branch `release-0-14-0`、conclusion `success`） |

## 2. 手順と結果

```bash
SHA=21cc3c8ae2fd28bce26216c80f8f824b6d32ce11
RUN=45817045977
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/$SHA/0.14.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA

pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-manifest/$SHA/0.14.0/artifact-attestation.json
```

freeze run `45817045977` の `validate` job・`storybook axe` job ともに
success。`artifact-attestation-21cc3c8a…` と `cf-build-output-21cc3c8a…`
の両 artifact が同 run から取得できたことを確認した。

### 2.1 attestation check

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 630 file record(s) agree with the aggregate
PASS  Source commit: 21cc3c8ae2fd28bce26216c80f8f824b6d32ce11
PASS  Source tree: clean
PASS  Project: my-web-2026@0.14.0
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:4e9a78f1c9becf6c938408c9fbe95dc70aad9ba832588e1b5546a42cc564969e (630 file(s), 43685417 bytes)

status: PASS
```

### 2.2 bytes check

```text
[build-output-artifact] BYTES    match — 630 file(s), 43685417 byte(s), aggregate sha256 4e9a78f1c9becf6c938408c9fbe95dc70aad9ba832588e1b5546a42cc564969e
[build-output-artifact] SECRETS  clean — 193 file(s) scanned, 437 skipped as non-text or oversized
[build-output-artifact] PASS
```

Phase A verdict: **PASS**。freeze 後に release ブランチへ積まれる差分は
docs-only の記録コミットに限るため、tag 対象の Phase B 照合は merge
commit の `main` push run に対して別途実施する（§9.1）。
