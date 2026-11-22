# attestation と build output byte の照合記録（v0.11.1 Phase A / run 44975872262 / commit fd5d412a）

`docs/release.md` §9.1 の **Phase A（freeze run に対する照合）** の実行記録。
Phase B（tag 対象 commit の `main` push run に対する照合）は release PR
merge・tag 作成後に別記録として残す。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.11.1 |
| 対象 candidate | `fd5d412a99e1a03b4da07e9c5ecdb476bea3a7b0`（release-0-11-1 head = PR #1156 merge commit） |
| 対象 manifest | `.tmp/release-manifest/fd5d412a…/0.11.1/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/fd5d412a…/` |
| **照合した run** | [44975872262](https://github.com/rebuildup/my-web-2026/actions/runs/44975872262)（`event=workflow_dispatch`、branch `release-0-11-1`、conclusion `success`、headSha `fd5d412a…` — freeze 対象 commit 自身の run） |

本記録が照合したのは **CI run 44975872262 が作った artifact / bytes** である。

run の job 結果: `validate` success、`storybook axe` success。

## 2. 手順と結果

```bash
SHA=fd5d412a99e1a03b4da07e9c5ecdb476bea3a7b0
RUN=44975872262
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/$SHA/0.11.1/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --source-sha=$SHA

pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-manifest/$SHA/0.11.1/artifact-attestation.json
```

### 2.1 attestation check

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 545 file record(s) agree with the aggregate
PASS  Source commit: fd5d412a99e1a03b4da07e9c5ecdb476bea3a7b0
PASS  Source tree: clean
PASS  Project: my-web-2026@0.11.1
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:5fc0d1da33a1beaab51bdb6372649f2e5e68a680e5ad1e956de4c9a56a67bae9 (545 file(s), 37553186 bytes)

status: PASS
```

### 2.2 bytes check

```text
[build-output-artifact] BYTES    match — 545 file(s), 37553186 byte(s), aggregate sha256 5fc0d1da33a1beaab51bdb6372649f2e5e68a680e5ad1e956de4c9a56a67bae9
[build-output-artifact] SECRETS  clean — 191 file(s) scanned, 354 skipped as non-text or oversized
[build-output-artifact] PASS
```

status: **Phase A PASS**（attestation / byte 照合ともに）。

## 3. 観測（PASS を名乗らないものは明記）

- Cloudflare-deployed bytes は attestation の対象外
  （`Attested scope` の記載どおり）。Workers Builds が deploy した
  実バイトは本記録では検証していない。Phase B で tag 対象 commit の
  run に対して同じ照合を行う。
- `secrets:status:check` の environment 半分（Infisical prod の
  name parity 観測）は operator step であり、本記録の対象外。
  repository 側は `drift_failures=0` で PASS。
