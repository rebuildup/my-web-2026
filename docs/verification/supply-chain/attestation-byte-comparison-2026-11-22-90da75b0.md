# attestation と build output byte の照合記録（v0.11.2 Phase B / run 44986678930 / commit 90da75b0）

`docs/release.md` §9.1 の **Phase B（tag 対象 commit の `main` push run
に対する照合）** の実行記録。Phase A（候補 `953e0010`、run 44984181467）
の証跡は
[attestation-byte-comparison-2026-11-22-953e0010.md](attestation-byte-comparison-2026-11-22-953e0010.md)
に分離して保持し、本記録は Phase B のみを対象とする。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.11.2 |
| 対象 tag | `v0.11.2` → `90da75b03c0b261bcda88b4384d9d05743dc30bd`（merge commit of release PR #1166） |
| 対象 manifest | `.tmp/release-manifest/90da75b0…/0.11.2/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/90da75b0…/` |
| **照合した run** | [44986678930](https://github.com/rebuildup/my-web-2026/actions/runs/44986678930)（`event=push`、branch `main`、conclusion `success`、headSha `90da75b0…` — tag 対象 commit 自身の run） |
| tag 作成 | `git tag -a v0.11.2 90da75b0…` → push 済み |
| GitHub Release | [v0.11.2](https://github.com/rebuildup/my-web-2026/releases/tag/v0.11.2) 公開済み（sbom.cdx.json + 本 manifest を添付） |

本記録が照合したのは **CI run 44986678930 が作った artifact / bytes** である。
Phase A の artifact / bytes / manifest を Phase B の代用にしていない。

## 2. 手順と結果

```bash
SHA=90da75b03c0b261bcda88b4384d9d05743dc30bd
RUN=44986678930
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/$SHA/0.11.2/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --release-tag=v0.11.2

pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-manifest/$SHA/0.11.2/artifact-attestation.json
```

### 2.1 attestation check（`--release-tag=v0.11.2`）

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 545 file record(s) agree with the aggregate
PASS  Source commit: 90da75b03c0b261bcda88b4384d9d05743dc30bd
PASS  Release tag: v0.11.2 -> 90da75b03c0b261bcda88b4384d9d05743dc30bd
PASS  Release tag version: v0.11.2 declares 0.11.2
PASS  Source tree: clean
PASS  Project: my-web-2026@0.11.2
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:68ae3b5cd32f5bb0c608f63f63ce415706927401ef58e7fcadcd2f474c90dce5 (545 file(s), 37544554 bytes)

status: PASS
```

注目点: aggregate digest `68ae3b5c…` は Phase A（`953e0010`）と
**同一**である。merge commit `90da75b0` と freeze 候補 `953e0010`
の間に挟まったのは Phase A 記録の docs-only コミットのみだったため、
attested bytes は一致する。

### 2.2 bytes check

```text
[build-output-artifact] BYTES    match — 545 file(s), 37544554 byte(s), aggregate sha256 68ae3b5cd32f5bb0c608f63f63ce415706927401ef58e7fcadcd2f474c90dce5
[build-output-artifact] SECRETS  clean — 191 file(s) scanned, 354 skipped as non-text or oversized
[build-output-artifact] PASS
```

status: **Phase B PASS**（attestation / byte 照合ともに）。

## 3. 観測（PASS を名乗らないものは明記）

- Cloudflare-deployed bytes は attestation の対象外
  （`Attested scope` の記載どおり）。deploy 後の smoke は
  `0.11.2-post-deploy.md` 側で扱う。
- `check-cf-secrets` Tier 3（live Worker drift）は
  `CLOUDFLARE_API_TOKEN` 未設定のため skip。
