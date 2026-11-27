# attestation と build output byte の照合記録（v0.15.2 Phase B / run 45947220633 / commit c00f8dc1）

`docs/release.md` §9.1 の **Phase B（tag 対象 commit の `main` push run に
対する照合）** の実行記録。Phase A（候補 `1fd5be05` / freeze run
45938381016）は `attestation-byte-comparison-2026-11-27-1fd5be05.md` を参照。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.15.2 |
| tag | `v0.15.2` → `c00f8dc1c9dac093ebd46788eb18e0779c8afdd1`（release-0-15-2 → main の merge commit、PR #1258） |
| 対象 manifest | `.tmp/release-attestation/c00f8dc1…/0.15.2/artifact-attestation.json`（run artifact `artifact-attestation-c00f8dc1…`） |
| 対象 bytes | `.tmp/release-bytes/c00f8dc1…/`（run artifact `cf-build-output-c00f8dc1…`） |
| **照合した run** | [45947220633](https://github.com/rebuildup/my-web-2026/actions/runs/45947220633)（`event=push`、branch `main`、conclusion `success`） |

Phase A の成果物は流用せず、tag 対象 commit の `main` push run
`45947220633` から取得した manifest と build bytes のみを使用した。

## 2. 手順と結果

```bash
SHA=c00f8dc1c9dac093ebd46788eb18e0779c8afdd1
RUN=45947220633
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-attestation/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA
git fetch --tags

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-attestation/$SHA/0.15.2/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA --release-tag=v0.15.2

node scripts/check-build-output-artifact.mjs \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-attestation/$SHA/0.15.2/artifact-attestation.json
```

manifest の展開先は `--artifact-dir` の外（`.tmp/release-attestation/`）に
置く — build output ディレクトリ配下に manifest を展開すると file count
が 1 件多く数えられ FAIL になる（v0.15.1 Phase B で実測済み）。

### 2.1 attestation check

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 631 file record(s) agree with the aggregate
PASS  Source commit: c00f8dc1c9dac093ebd46788eb18e0779c8afdd1
PASS  Release tag: v0.15.2 -> c00f8dc1c9dac093ebd46788eb18e0779c8afdd1
PASS  Release tag version: v0.15.2 declares 0.15.2
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

**Phase B PASS**。tag `v0.15.2` は merge commit `c00f8dc1` を指し、
その commit 自身の `main` push run が生成した manifest と bytes が
一致することを確認した。aggregate digest は Phase A（`1fd5be05`）と
同一（`aae0aee7…`）— freeze 後の差分は docs のみで build output に
影響しないことの実測的裏付け。Release 公開物にはこの Phase B manifest
（`artifact-attestation-v0.15.2.json`）を添付した。
