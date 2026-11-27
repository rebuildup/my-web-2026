# attestation と build output byte の照合記録（v0.15.2 Phase A / run 45938381016 / commit 1fd5be05）

`docs/release.md` §9.1 の **Phase A（freeze run に対する照合）** の実行記録。
Phase B は release PR merge・tag 作成後に tag 対象 commit の `main` push
run へ対して別途実施する。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.15.2 |
| 対象 commit | `1fd5be05663426c2cdb4800cb46b4c62709a95f7`（release-0-15-2 head at freeze） |
| 対象 manifest | `.tmp/release-attestation/1fd5be05…/0.15.2/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/1fd5be05…/` |
| **照合した run** | [45938381016](https://github.com/rebuildup/my-web-2026/actions/runs/45938381016)（`workflow_dispatch`、branch `release-0-15-2`、conclusion `success`） |

## 2. 手順と結果

```bash
SHA=1fd5be05663426c2cdb4800cb46b4c62709a95f7
RUN=45938381016
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-attestation/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-attestation/$SHA/0.15.2/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA --source-sha=$SHA

node scripts/check-build-output-artifact.mjs \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-attestation/$SHA/0.15.2/artifact-attestation.json
```

### 2.1 attestation check

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 631 file record(s) agree with the aggregate
PASS  Source commit: 1fd5be05663426c2cdb4800cb46b4c62709a95f7
PASS  Source tree: clean
PASS  Project: my-web-2026@0.15.2
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:aae0aee7d6681f5e59fef827432de431bd1f7f1e75134c71614f701c997cd65b (631 file(s), 48433941 bytes)

status: PASS
```

### 2.2 bytes check

```text
[build-output-artifact] BYTES    match — 631 file(s), 48433941 byte(s), aggregate sha256 aae0aee7d6681f5e59fef827432de431bd1f7f1e75134c71614f701c997cd65b
[build-output-artifact] SECRETS  clean — 193 file(s) scanned, 438 skipped as non-text or oversized
[build-output-artifact] PASS
```

## 3. 判定

**Phase A PASS**。freeze run `45938381016` が `1fd5be05` で生成した
manifest と bytes が一致することを確認した。この manifest は候補証跡で
あり、GitHub Release へは tag 対象 commit の `main` push run が生成する
Phase B manifest を添付する（`docs/release.md` §9.1）。
