# attestation と build output byte の照合記録（v0.11.1 Phase B / run 44978262337 / commit 03d75086）

`docs/release.md` §9.1 の **Phase B（tag 対象 commit の `main` push run
に対する照合）** の実行記録。Phase A（候補 `fd5d412a`、run 44975872262）
の証跡は
[attestation-byte-comparison-2026-11-22-fd5d412a.md](attestation-byte-comparison-2026-11-22-fd5d412a.md)
に分離して保持し、本記録は Phase B のみを対象とする。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.11.1 |
| 対象 tag | `v0.11.1` → `03d75086624ea04b0575749e79ff2895cf5a31ca`（merge commit of release PR #1157） |
| 対象 manifest | `.tmp/release-manifest/03d75086…/0.11.1/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/03d75086…/` |
| **照合した run** | [44978262337](https://github.com/rebuildup/my-web-2026/actions/runs/44978262337)（`event=push`、branch `main`、conclusion `success`、headSha `03d75086…` — tag 対象 commit 自身の run） |
| tag 作成 | `git tag -a v0.11.1 03d75086…` → push 済み |
| GitHub Release | [v0.11.1](https://github.com/rebuildup/my-web-2026/releases/tag/v0.11.1) 公開済み（sbom.cdx.json + 本 manifest を添付） |

本記録が照合したのは **CI run 44978262337 が作った artifact / bytes** である。
Phase A の artifact / bytes / manifest を Phase B の代用にしていない。

run の job 結果: `validate` success、`storybook axe` success。

## 2. 手順と結果

```bash
SHA=03d75086624ea04b0575749e79ff2895cf5a31ca
RUN=44978262337
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/$SHA/0.11.1/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --release-tag=v0.11.1

pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-manifest/$SHA/0.11.1/artifact-attestation.json
```

### 2.1 attestation check（`--release-tag=v0.11.1`）

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 545 file record(s) agree with the aggregate
PASS  Source commit: 03d75086624ea04b0575749e79ff2895cf5a31ca
PASS  Release tag: v0.11.1 -> 03d75086624ea04b0575749e79ff2895cf5a31ca
PASS  Release tag version: v0.11.1 declares 0.11.1
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

注目点: aggregate digest `5fc0d1da…` は Phase A（`fd5d412a`）と
**同一**である。merge commit `03d75086` と freeze 候補 `fd5d412a`
の間に挟まったのは Phase A 記録の docs-only コミットのみだったため、
attested bytes は一致する。これは「候補の bytes がそのまま tag 対象に
なった」ことの直接の証明である。

### 2.2 bytes check

```text
[build-output-artifact] BYTES    match — 545 file(s), 37553186 byte(s), aggregate sha256 5fc0d1da33a1beaab51bdb6372649f2e5e68a680e5ad1e956de4c9a56a67bae9
[build-output-artifact] SECRETS  clean — 191 file(s) scanned, 354 skipped as non-text or oversized
[build-output-artifact] PASS
```

status: **Phase B PASS**（attestation / byte 照合ともに）。

## 3. 観測（PASS を名乗らないものは明記）

- Cloudflare-deployed bytes は attestation の対象外
  （`Attested scope` の記載どおり）。Workers Builds が deploy した
  実バイトは本記録では検証していない。deploy 後の smoke は
  `attestation-byte-comparison` ではなく post-deploy 記録側で扱う。
- `secrets:status:check` の environment 半分（Infisical prod の
  name parity 観測）は operator step であり未実施のまま。repository
  側は `drift_failures=0` で PASS。
