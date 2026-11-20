# attestation と build output byte の照合記録（v0.11.0 Phase A / run 44755878379 / commit c629da10）

`docs/release.md` §9.1 の **Phase A（merge 前の候補検証）** である
「manifest を artifact と bytes の両方に対して照合する」実行記録。
対象は E2E spec drift 修正（PR #1102）を統合した freeze 候補であり、
tag 対象 commit の `main` push run に対する Phase B 照合は
`release-0-11-0 → main` 統合と tag 作成（owner 明示承認）の後に
別記録として実施する。

**旧候補 `9563569e` の freeze run（44747907024）は E2E 3 件の失敗で
validate が FAIL したため、本候補の証拠として流用しない。**
本記録は新候補自身の run / artifact / bytes のみを対象とする。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.11.0（`package.json#version` = `0.11.0`） |
| 対象 branch | `release-0-11-0` |
| 対象 commit | `c629da10e0eb5e000d95fe84d7f1de1a1e046134` |
| 対象 manifest | `.tmp/release-bytes/c629da10…/attestation/0.11.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/c629da10…/output/` |
| **照合した run** | [44755878379](https://github.com/rebuildup/my-web-2026/actions/runs/44755878379)（`event=workflow_dispatch`、branch `release-0-11-0`、conclusion `success`、headSha `c629da10…`） |
| tag | 未作成（`release-0-11-0 → main` 統合と tag 作成は明示承認待ちのため、`--release-tag` 照合は tag 作成後に実施） |

本記録が照合したのは **CI run 44755878379 が作った artifact / bytes** である。
それ以外の run / commit / byte を名乗るものではない。

run の job 結果: `validate` success、`storybook axe` success（100 tests）。
E2E は **192 passed / 2 skipped / flaky 0 / failed 0**
（旧候補で失敗した `e2e/about.spec.ts`・`e2e/commission.spec.ts`・
`e2e/links.spec.ts` の 3 件は PR #1102 で修正済み）。

## 2. 手順

`docs/release.md` §9.1（Phase A: merge 前の候補検証）と同じ。
artifact は同一 run から取得する:

```bash
SHA=c629da10e0eb5e000d95fe84d7f1de1a1e046134
RUN=44755878379
gh run download $RUN -n artifact-attestation-$SHA \
  -D .tmp/release-bytes/$SHA/attestation
gh run download $RUN -n cf-build-output-$SHA \
  -D .tmp/release-bytes/$SHA/output
```

実行結果: 両 artifact は上記 run から取得済みで、manifest の配置は
`.tmp/release-bytes/c629da10…/attestation/0.11.0/artifact-attestation.json`、
bytes の配置は `.tmp/release-bytes/c629da10…/output/`（543 file(s)）である。

### 2.1 `pnpm run artifact:attestation:check`

```bash
pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-bytes/c629da10…/attestation/0.11.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/c629da10…/output
```

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 543 file record(s) agree with the aggregate
PASS  Source commit: c629da10e0eb5e000d95fe84d7f1de1a1e046134
PASS  Source tree: clean
PASS  Project: my-web-2026@0.11.0
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:27edd5414e1c1aaa9091f3d8e2a57b2f7475841aa609dfbd0ba7c01a3454c9db (543 file(s), 37725364 bytes)

status: PASS
```

### 2.2 `pnpm run artifact:bytes:check`

```bash
pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/c629da10…/output \
  --manifest=.tmp/release-bytes/c629da10…/attestation/0.11.0/artifact-attestation.json
```

```text
[build-output-artifact] BYTES    match — 543 file(s), 37725364 byte(s), aggregate sha256 27edd5414e1c1aaa9091f3d8e2a57b2f7475841aa609dfbd0ba7c01a3454c9db
[build-output-artifact] SECRETS  clean — 189 file(s) scanned, 354 skipped as non-text or oversized
[build-output-artifact] PASS
```

## 3. 判定と観測

- `artifact:attestation:check`: **PASS**
- `artifact:bytes:check`: **PASS**
- manifest の source commit `c629da10…`・project version `0.11.0`・
  lockfile digest・worker identity がすべて一致。bytes は manifest の
  file list と 543 file / 37,725,364 byte で完全一致し、secret 形状の
  スキャンも clean。
- freeze run の artifact: `artifact-attestation-c629da10…`、
  `cf-build-output-c629da10…`、`sbom-c629da10…`、
  `dependency-advisory-report-c629da10…`（run から取得済み）。

## 4. 境界

- attested scope は GitHub Actions production-mode build output のみ。
  Cloudflare-deployed bytes は attestation 対象外（owner 決定
  2026-10-19）。デプロイ後の実測は merge/tag/デプロイ後に実施する。
- signature: unsigned（署名鍵なし、owner 決定どおり）。
- 本記録は merge 前候補の証拠であり、Phase B（tag 対象 commit の
  `main` push run 照合）を代替しない。
- ローカル `pnpm run validate:release` は同一 SHA で別途実行中。
  結果は [0.11.0-candidate-freeze-c629da10.md](../release/0.11.0-candidate-freeze-c629da10.md)
  に記録する。

status: Phase A PASS（候補 `c629da10`、run 44755878379）
