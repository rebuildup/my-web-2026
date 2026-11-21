# attestation と build output byte の照合記録（v0.11.0 Phase B / run 44918864101 / commit 9714aaba）

`docs/release.md` §9.1 の **Phase B（tag 対象 commit の `main` push run
に対する照合）** の実行記録。Phase A（候補 `ee621dca`、run 44914392211）
の証跡は
[attestation-byte-comparison-2026-11-22-ee621dca.md](attestation-byte-comparison-2026-11-22-ee621dca.md)
に分離して保持し、本記録は Phase B のみを対象とする。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.11.0 |
| 対象 tag | `v0.11.0` → `9714aaba0c2eda6f4f7a5894a22d5cb23a82d468`（merge commit of release PR #1125） |
| 対象 manifest | `.tmp/release-manifest/9714aaba…/0.11.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/9714aaba…/` |
| **照合した run** | [44918864101](https://github.com/rebuildup/my-web-2026/actions/runs/44918864101)（`event=push`、branch `main`、conclusion `success`、headSha `9714aaba…` — tag 対象 commit 自身の run） |
| tag 作成 | `git tag -a v0.11.0 9714aaba…` → push 済み |
| GitHub Release | [v0.11.0](https://github.com/rebuildup/my-web-2026/releases/tag/v0.11.0) 公開済み（sbom.cdx.json + 本 manifest を添付） |

本記録が照合したのは **CI run 44918864101 が作った artifact / bytes** である。
Phase A の artifact / bytes / manifest を Phase B の代用にしていない。

run の job 結果: `validate` success、`storybook axe` success。

## 2. 手順と結果

```bash
SHA=9714aaba0c2eda6f4f7a5894a22d5cb23a82d468
RUN=44918864101
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/$SHA/0.11.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --release-tag=v0.11.0

pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-manifest/$SHA/0.11.0/artifact-attestation.json
```

### 2.1 attestation check（`--release-tag=v0.11.0`）

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 545 file record(s) agree with the aggregate
PASS  Source commit: 9714aaba0c2eda6f4f7a5894a22d5cb23a82d468
PASS  Release tag: v0.11.0 -> 9714aaba0c2eda6f4f7a5894a22d5cb23a82d468
PASS  Release tag version: v0.11.0 declares 0.11.0
PASS  Source tree: clean
PASS  Project: my-web-2026@0.11.0
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:bdc7f6ec030227258689d8ff755595ecf11b40f16550cfca573e2d1edab1d12a (545 file(s), 37545153 bytes)

status: PASS
```

注目点: aggregate digest `bdc7f6ec…` は Phase A（`ee621dca`）と
**同一**である。merge commit `9714aaba` と freeze 候補 `ee621dca`
の build input（src / package / lockfile / public / 設定）は同一
ツリーであり、間に挟まったのは検証記録の docs-only コミットのみ
だったため、attested bytes は一致する。これは「候補の bytes が
そのまま tag 対象になった」ことの直接の証明である。

### 2.2 bytes check

```text
[build-output-artifact] BYTES    match — 545 file(s), 37545153 byte(s), aggregate sha256 bdc7f6ec030227258689d8ff755595ecf11b40f16550cfca573e2d1edab1d12a
[build-output-artifact] SECRETS  clean — 191 file(s) scanned, 354 skipped as non-text or oversized
[build-output-artifact] PASS
```

status: **Phase B PASS**（attestation / byte 照合ともに）。

## 3. 観測（PASS を名乗らないものは明記）

- Cloudflare-deployed bytes は attestation の対象外
  （`Attested scope` の記載どおり）。Workers Builds が deploy した
  実バイトは本記録では検証していない。
- copy-editorial approval `pending`、Dependabot 17 件、
  Cloudflare Tier 3 SKIP、issue-closure 手動 21 件は owner 受容済みの
  残存リスクとして記録を維持する（PASS・承認済みへの偽装なし）。
