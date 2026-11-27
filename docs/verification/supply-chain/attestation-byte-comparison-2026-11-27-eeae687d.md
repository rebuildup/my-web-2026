# attestation と build output byte の照合記録（v0.15.1 Phase B / run 45927925550 / commit eeae687d）

`docs/release.md` §9.1 の **Phase B（tag 対象 commit の `main` push run に
対する照合）** の実行記録。Phase A（候補 `e4380a46` / freeze run
45923957988）は `attestation-byte-comparison-2026-11-27-e4380a46.md` を参照。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.15.1 |
| tag | `v0.15.1` → `eeae687dfe03f2d2484b837d81515eb59df83d01`（release-0-15-1 → main の merge commit、PR #1253） |
| 対象 manifest | `.tmp/release-attestation/eeae687d…/0.15.1/artifact-attestation.json`（run artifact `artifact-attestation-eeae687d…`） |
| 対象 bytes | `.tmp/release-bytes/eeae687d…/`（run artifact `cf-build-output-eeae687d…`） |
| **照合した run** | [45927925550](https://github.com/rebuildup/my-web-2026/actions/runs/45927925550)（`event=push`、branch `main`、conclusion `success`） |

Phase A の成果物は流用せず、tag 対象 commit の `main` push run
`45927925550` から取得した manifest と build bytes のみを使用した。

## 2. 手順と結果

```bash
SHA=eeae687dfe03f2d2484b837d81515eb59df83d01
RUN=45927925550
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-attestation/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA
git fetch --tags

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-attestation/$SHA/0.15.1/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA --release-tag=v0.15.1

node scripts/check-build-output-artifact.mjs \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-attestation/$SHA/0.15.1/artifact-attestation.json
```

注: manifest の展開先は `--artifact-dir` の**外**に置く。manifest を
build output ディレクトリ配下へ展開すると file count が 1 件多く
数えられ FAIL になる（実施時に一度発生、配置を分離して再実行し PASS）。

### 2.1 attestation check

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 631 file record(s) agree with the aggregate
PASS  Source commit: eeae687dfe03f2d2484b837d81515eb59df83d01
PASS  Release tag: v0.15.1 -> eeae687dfe03f2d2484b837d81515eb59df83d01
PASS  Release tag version: v0.15.1 declares 0.15.1
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

## 3. 判定

**Phase B PASS**。tag `v0.15.1` は merge commit `eeae687d` を指し、
その commit 自身の `main` push run が生成した manifest と bytes が
一致することを確認した。Release 公開物にはこの Phase B manifest
（`artifact-attestation-v0.15.1.json`）を添付した。Phase A manifest は
候補証跡であり Release には添付しない（`docs/release.md` §9.1）。
