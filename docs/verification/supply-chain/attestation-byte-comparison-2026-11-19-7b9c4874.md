# attestation と build output byte の照合記録（v0.10.0 / run 44466692996 / commit 7b9c4874）

`docs/release.md` §9.1 の **Phase A（merge 前の候補検証）** である
「manifest を artifact と bytes の両方に対して照合する」実行記録。
対象は HOME フィールドパネル修正（PR #1039）を統合した新しい freeze
候補であり、tag 対象 commit の `main` push run に対する Phase B 照合は
別記録として後続で実施する。

**旧候補 `a5df2fcc` の Phase A 証跡
（`attestation-byte-comparison-2026-11-19-a5df2fcc.md`）はコード変更を
含む本候補の証拠として流用しない。** 本記録は新候補自身の run /
artifact / bytes のみを対象とする。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.10.0（`package.json#version` = `0.10.0`） |
| 対象 branch | `release-0-10-0` |
| 対象 commit | `7b9c48745111a9ec3d641ae252701d16b8e70414` |
| 対象 manifest | `.tmp/release-manifest/7b9c4874…/0.10.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/7b9c4874…/` |
| **照合した run** | [44466692996](https://github.com/rebuildup/my-web-2026/actions/runs/44466692996)（`event=workflow_dispatch`、branch `release-0-10-0`、conclusion `success`、headSha `7b9c4874…`） |
| tag | 未作成（`release-0-10-0 → main` 統合と tag 作成は明示承認待ちのため、`--release-tag` 照合は tag 作成後に実施） |

本記録が照合したのは **CI run 44466692996 が作った artifact / bytes** である。
それ以外の run / commit / byte を名乗るものではない。

run の job 結果: `validate` success（12m25s）、`storybook axe` success（97 tests passed）。
E2E は **171 passed / 2 skipped / flaky 0**（前回候補で flaky だった
`e2e/portfolio.spec.ts` archived-slug 404 visibility-boundary は今回
初回 PASS。Issue #1037 の infra flake は再発せず）。

ローカル側の包括ゲート: `pnpm run validate:release` を HEAD
`7b9c4874` で実行し **OK（83 declared steps）**。

## 2. 手順

`docs/release.md` §9.1（Phase A: merge 前の候補検証）と同じ。
artifact は同一 run から取得する:

```bash
SHA=7b9c48745111a9ec3d641ae252701d16b8e70414
RUN=44466692996
gh run download $RUN -n artifact-attestation-$SHA \
  -D .tmp/release-manifest/7b9c4874
gh run download $RUN -n cf-build-output-$SHA \
  -D .tmp/release-bytes/7b9c4874
```

実行結果: 両 artifact は上記 run から取得済みで、manifest の配置は
`.tmp/release-manifest/7b9c4874…/0.10.0/artifact-attestation.json`、
bytes の配置は `.tmp/release-bytes/7b9c4874…/` である。

### 2.1 `pnpm run artifact:attestation:check`

```bash
pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/7b9c4874…/0.10.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/7b9c4874…
```

（checkout HEAD が対象 commit と一致するため `--source-sha` は不要。
`Source commit` 行が manifest 記録値と HEAD の一致を示す。）

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 529 file record(s) agree with the aggregate
PASS  Source commit: 7b9c48745111a9ec3d641ae252701d16b8e70414
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

### 2.2 `pnpm run artifact:bytes:check`

```bash
pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/7b9c4874… \
  --manifest=.tmp/release-manifest/7b9c4874…/0.10.0/artifact-attestation.json
```

```text
[build-output-artifact] BYTES    match — 529 file(s), 37312922 byte(s), aggregate sha256 815f2223d875ed36009a57727d5f50876ec7ddb38c8a9efe1f8ff7be205e7940
[build-output-artifact] SECRETS  clean — 175 file(s) scanned, 354 skipped as non-text or oversized
[build-output-artifact] PASS
```

## 3. 判定

- `artifact:attestation:check`: **PASS**
- `artifact:bytes:check`: **PASS**（BYTES match + SECRETS clean）
- manifest digest: `sha-256:815f2223d875ed36009a57727d5f50876ec7ddb38c8a9efe1f8ff7be205e7940`
- manifest file count / bytes: 529 / 37,312,922
- signature: unsigned（署名鍵は存在しない。owner 決定どおり）
- attested scope: GitHub Actions production-mode build output のみ。
  Cloudflare-deployed bytes は attestation 対象外（owner 決定 2026-10-19、
  `coverage.deployed_bytes_attested=false`）

## 4. 境界

- 本記録は Phase A（merge 前候補）のみ。Phase B（tag 対象 merge commit の
  `main` push run に対する `--release-tag=v0.10.0` 照合）は tag 作成後に
  別記録で実施する。Phase A の証跡を Phase B の代用にしない。
- operator credentialed production checks（R2 key-set audit /
  Infisical 契約 / secret parity / live binding）は step-9 記録
  （`docs/verification/ops/release-step-9-operator-gate-2026-11-19.md`）
  のとおり。R2・Infisical・parity は PASS、live binding は
  `CLOUDFLARE_API_TOKEN` 未供給で **SKIP**（PASS ではない）。
  これらは candidate 非依存の本番状態検査であり、新候補 SHA への
  再実行は不要と判断（credential 契約・secret 名集合・R2 key 集合は
  コード差分の影響を受けない）。live binding の SKIP は変わらず。
- HOME 実画面受入の証跡は
  `docs/verification/home/968-field-panels.md`（before/after
  1440/390 × light/dark、computed-style 計測値）。デザイン受入の
  最終判定は owner のスクリーンショットレビューを含む。
- #984（露出 credential ローテーション）と 2026-11-19 の Infisical
  session token 露出は **未解消の owner/operator 対応項目**。
  session token 露出は #984 にコメント追記済み。release blocker と
  するかの判断は owner に委ねる。
- 本記録は release readiness / shipped を宣言しない。
  `release-0-10-0 → main` 統合・tag・GitHub Release 公開は
  owner 明示承認 + HOME 実画面受入 + セキュリティ項目の整理が
  条件である。

status: Phase A PASS（新候補 `7b9c4874`、run 44466692996）
