# attestation と build output byte の照合記録（v0.11.3 Phase A / run 45011223171 / commit f0bb9b61）

`docs/release.md` §9.1 の **Phase A（release candidate freeze run に対する
照合）** の実行記録。Phase B（tag 対象 commit の `main` push run）は
merge 後に別記録として残す。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.11.3 |
| 対象 candidate | `f0bb9b6156a76ad994c23adfa0d4c2875a3d2f61`（release-0-11-3 head、freeze 時点） |
| 対象 manifest | `.tmp/release-manifest/f0bb9b61…/0.11.3/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/f0bb9b61…/` |
| **照合した run** | [45011223171](https://github.com/rebuildup/my-web-2026/actions/runs/45011223171)（`event=workflow_dispatch`、branch `release-0-11-3`、conclusion `success`） |

## 2. 手順と結果

```bash
SHA=f0bb9b6156a76ad994c23adfa0d4c2875a3d2f61
RUN=45011223171
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/$SHA/0.11.3/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA --source-sha=$SHA

pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-manifest/$SHA/0.11.3/artifact-attestation.json
```

### 2.1 attestation check

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 545 file record(s) agree with the aggregate
PASS  Source commit: f0bb9b6156a76ad994c23adfa0d4c2875a3d2f61
PASS  Source tree: clean
PASS  Project: my-web-2026@0.11.3
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:b81fb23810f51ea732884dcf3cf91db68a36904b9fb932752b7a463a29189ca7 (545 file(s), 37561349 bytes)

status: PASS
```

### 2.2 bytes check

```text
[build-output-artifact] BYTES    match — 545 file(s), 37561349 byte(s), aggregate sha256 b81fb23810f51ea732884dcf3cf91db68a36904b9fb932752b7a463a29189ca7
[build-output-artifact] SECRETS  clean — 191 file(s) scanned, 354 skipped as non-text or oversized
[build-output-artifact] PASS
```

status: **Phase A PASS**（attestation / byte 照合ともに）。

## 3. release 前 operator gate の記録

| gate | 結果 |
| --- | --- |
| `pnpm run validate:release`（release-0-11-3 head） | PASS（85 declared steps） |
| `pnpm run r2:media:audit`（production） | verdict=OK、keys_total=133、keys_outside_allowlist=0 |
| `pnpm run infisical:check:cf --execute --environment=prod` | all checks OK（deploy-time bindings 5 名一致） |
| `node scripts/check-secret-rotation-status.mjs --observation=.tmp/cf-secrets-prod.txt` | verdict=OK、drift_failures=0、observation=observed prod |

## 4. 観測（PASS を名乗らないものは明記）

- Cloudflare-deployed bytes は attestation の対象外。
- `check-cf-secrets` Tier 3（live Worker drift）は
  `CLOUDFLARE_API_TOKEN` 未設定のため skip（従来どおり）。
- freeze run は本記録 commit（docs のみ）より前の `f0bb9b61` を対象とする。
  v0.11.2 と同じく、記録 commit は freeze 後・merge 前に積む docs-only の
  追加であり、release 対象コードは freeze 時点と同一。
