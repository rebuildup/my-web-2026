# attestation と build output byte の照合記録（v0.10.0 Phase B / run 44471414756 / commit 8268ca10）

`docs/release.md` §9.1 の **Phase B（tag 対象 commit の `main` push run
に対する照合）** の実行記録。Phase A（候補 `7b9c4874`、run 44466692996）
の証跡は
[attestation-byte-comparison-2026-11-19-7b9c4874.md](attestation-byte-comparison-2026-11-19-7b9c4874.md)
に分離して保持し、本記録は Phase B のみを対象とする。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.10.0 |
| 対象 tag | `v0.10.0` → `8268ca1076f1898c71523c1c0e60511b958163cf`（merge commit of release PR #1040） |
| 対象 manifest | `.tmp/release-manifest/8268ca10…/0.10.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/8268ca10…/` |
| **照合した run** | [44471414756](https://github.com/rebuildup/my-web-2026/actions/runs/44471414756)（`event=push`、branch `main`、conclusion `success`、headSha `8268ca10…` — tag 対象 commit 自身の run） |
| tag 作成 | `git tag -a v0.10.0 8268ca10…` → push 済み |

本記録が照合したのは **CI run 44471414756 が作った artifact / bytes** である。
Phase A の artifact / bytes / manifest を Phase B の代用にしていない。

run の job 結果: `validate` success、`storybook axe` success（97 tests）。

## 2. 手順と結果

```bash
SHA=8268ca1076f1898c71523c1c0e60511b958163cf
RUN=44471414756
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/8268ca10
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/8268ca10

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/8268ca10…/0.10.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/8268ca10… \
  --release-tag=v0.10.0

pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/8268ca10… \
  --manifest=.tmp/release-manifest/8268ca10…/0.10.0/artifact-attestation.json
```

### 2.1 attestation check（`--release-tag=v0.10.0`）

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 529 file record(s) agree with the aggregate
PASS  Source commit: 8268ca1076f1898c71523c1c0e60511b958163cf
PASS  Release tag: v0.10.0 -> 8268ca1076f1898c71523c1c0e60511b958163cf
PASS  Release tag version: v0.10.0 declares 0.10.0
PASS  Source tree: clean
PASS  Project: my-web-2026@0.10.0
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:815f2223d875ed36009a57727d5f50876ec7ddb38c8a9efe1f8ff7be205e7940 (529 file(s), 37312922 bytes)

status: PASS
```

### 2.2 byte comparison

```text
[build-output-artifact] BYTES    match — 529 file(s), 37312922 byte(s), aggregate sha256 815f2223d875ed36009a57727d5f50876ec7ddb38c8a9efe1f8ff7be205e7940
[build-output-artifact] SECRETS  clean — 175 file(s) scanned, 354 skipped as non-text or oversized
[build-output-artifact] PASS
```

## 3. 判定と観測

- `artifact:attestation:check --release-tag=v0.10.0`: **PASS**
- `artifact:bytes:check`: **PASS**
- tag → commit → manifest → bytes の束縛を確認: `v0.10.0` は
  `8268ca10…` を指し、manifest の source commit・tag version・
  package version（0.10.0）・同一 run artifact がすべて一致。
- merge commit の build output aggregate は Phase A 候補
  `7b9c4874` と**同一**（`sha-256:815f2223…`）。freeze 後の差分は
  docs-only で build 入力に変更がなく、byte 一致はその裏付けである。
- GitHub Release `v0.10.0` に添付した `artifact-attestation.json` は
  **本 Phase B manifest**（`8268ca10…` 由来）であり、Phase A manifest
  ではない。`sbom.cdx.json` も同 Release に添付済み。

## 4. 境界

- attested scope は GitHub Actions production-mode build output のみ。
  Cloudflare-deployed bytes は attestation 対象外（owner 決定
  2026-10-19）。デプロイ後の実測は
  [0.10.0-post-deploy.md](../release/0.10.0-post-deploy.md) を参照。
- signature: unsigned（署名鍵なし、owner 決定どおり）。
- 本記録は shipped の証拠であり、post-deploy 検証記録と併せて
  release 完了の判定材料となる。

status: Phase B PASS（tag `v0.10.0`、merge commit `8268ca10`、run 44471414756）

