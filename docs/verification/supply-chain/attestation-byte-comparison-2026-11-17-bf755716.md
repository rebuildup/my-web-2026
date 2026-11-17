# attestation と build output byte の照合記録（v0.9.0 / run 44014355896 / commit bf755716）

[Issue #448](https://github.com/rebuildup/my-web-2026/issues/448)
（[ADR-0035](../../adr/ADR-0035-artifact-attestation.md)）の required verification である
「最終 manifest を artifact と bytes の両方に対して照合する」実行記録。

`60c72b08` の記録（[同日付](./attestation-byte-comparison-2026-11-17-60c72b08.md)）に続く
記録。Issue #961（attestation 手順の二相化: 候補検証と tag 対象検証の分離）と
Issue #962（live feed 本番接続 runbook）の ticket PR #963 / #964 を
`release-0-9-0` へ統合したため、候補 SHA が `60c72b08` → `bf755716` に変わり、
freeze と本照合をやり直した。差分は docs / workflow コメントのみであり、
生成された build output の digest は `60c72b08` と同一である（§3）。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.9.0（`package.json#version` = `0.9.0`） |
| 対象 branch | `release-0-9-0` |
| 対象 commit | `bf7557161fd7eb1490505568af58879e5e53e213` |
| 対象 manifest | `.tmp/release-manifest/bf755716/0.9.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/bf755716/` |
| **照合した run** | [44014355896](https://github.com/rebuildup/my-web-2026/actions/runs/44014355896)（`event=workflow_dispatch`、branch `release-0-9-0`、conclusion `success`、headSha `bf755716…`） |
| tag | 未作成（`release-0-9-0 → main` 統合と tag 作成は明示承認待ちのため、`--release-tag` 照合は tag 作成後に実施） |

本記録が照合したのは **CI run 44014355896 が作った artifact / bytes** である。
それ以外の run / commit / byte を名乗るものではない。
`60c72b08` の記録は別 run（44005487801）の証跡であり、本記録の代替にはならない。

## 2. 手順

`docs/release.md` step 9.1（Phase A: merge 前の候補検証）と同じ。
artifact は同一 run から取得する:

```bash
SHA=bf7557161fd7eb1490505568af58879e5e53e213
RUN=44014355896
gh run download $RUN -R rebuildup/my-web-2026 -n artifact-attestation-$SHA \
  -D .tmp/release-manifest/${SHA:0:8}
gh run download $RUN -R rebuildup/my-web-2026 -n cf-build-output-$SHA \
  -D .tmp/release-bytes/${SHA:0:8}
```

実行結果: 両 artifact は上記 run から取得済みで、manifest の配置は
`.tmp/release-manifest/bf755716/0.9.0/artifact-attestation.json`、
bytes の配置は `.tmp/release-bytes/bf755716/` である。

### 2.1 `pnpm run artifact:attestation:check`

```bash
pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/bf755716/0.9.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/bf755716 \
  --source-sha=bf7557161fd7eb1490505568af58879e5e53e213
```

```text
[artifact-attestation] PASS  Schema: my-web-2026/artifact-attestation/v1
[artifact-attestation] PASS  Manifest file list: 498 file record(s) agree with the aggregate
[artifact-attestation] PASS  Source commit: bf7557161fd7eb1490505568af58879e5e53e213
[artifact-attestation] PASS  Source tree: clean
[artifact-attestation] PASS  Project: my-web-2026@0.9.0
[artifact-attestation] PASS  Lockfile digest: cf90030536e323a832efbc90c2c710a631b792dba4b3f052569eb718a03a4ac0 (923 resolved package version(s))
[artifact-attestation] PASS  Declared dependencies: package.json dependency ranges agree
[artifact-attestation] PASS  Package manager: pnpm@12.3.4
[artifact-attestation] PASS  Worker identity: my-web-2026
[artifact-attestation] PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
[artifact-attestation] PASS  Signature: unsigned (no signature claimed)
[artifact-attestation] PASS  Cloudflare deploy id: not provided (no id invented)
[artifact-attestation] PASS  Artifact digest: sha-256:1037ea15ff0007af03af30502cdc2031a2448cafa9fdcc568c60cacd37916d1b (498 file(s), 31810730 bytes)

status: PASS
```

### 2.2 `pnpm run artifact:bytes:check`

```bash
pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/bf755716 \
  --manifest=.tmp/release-manifest/bf755716/0.9.0/artifact-attestation.json
```

```text
[build-output-artifact] BYTES    match — 498 file(s), 31810730 byte(s), aggregate sha256 1037ea15ff0007af03af30502cdc2031a2448cafa9fdcc568c60cacd37916d1b
[build-output-artifact] SECRETS  clean — 167 file(s) scanned, 331 skipped as non-text or oversized
[build-output-artifact] PASS
```

## 3. manifest 側の内容（読んだ値）

`artifact-attestation.json` の主な値（本記録が実行して読んだ範囲）:

| フィールド | 値 |
| --- | --- |
| `schema` | `my-web-2026/artifact-attestation/v1` |
| `source.repository` | `https://github.com/rebuildup/my-web-2026` |
| `source.commit` | `bf7557161fd7eb1490505568af58879e5e53e213` |
| `source.branch` | `release-0-9-0` |
| `source.tree` | `clean` |
| `project.name` / `project.version` | `my-web-2026` / `0.9.0` |
| `dependencies.package_manager` | `pnpm@12.3.4` |
| `dependencies.lockfile` | `pnpm-lock.yaml` sha256 `cf90030536e323a832efbc90c2c710a631b792dba4b3f052569eb718a03a4ac0`（923 resolved package version(s)） |
| `dependencies.declared` | `package.json` の dependency ranges と一致（attestation check が検証済み） |
| `subject.kind` / `subject.root` | `cloudflare-build-output` / `.cloudflare/output/v0` |
| `subject.digest.algorithm` / `subject.digest.value` | `sha-256` / `1037ea15ff0007af03af30502cdc2031a2448cafa9fdcc568c60cacd37916d1b` |
| `subject.file_count` / `subject.total_bytes` | `498` / `31810730` |
| `cloudflare` | `provider: cloudflare-workers-builds`、`worker: my-web-2026`、`build_uuid: null`、`deploy_id: null` |
| `coverage` | `github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested`（`deployed_bytes_attested: false`） |
| `signature` | `unsigned`（`status: unsigned`、algorithm / key_id / value すべて null） |

manifest は run id / event を保持しない。対象 run（`44014355896`、
`event=workflow_dispatch`）は artifact 名と run の `headSha` 記録で特定した。
bytes 照合の結果: `BYTES match`（498 files / 31,810,730 bytes）、`SECRETS clean`
（167 text file scanned、331 skipped as non-text or oversized）。

`60c72b08` の digest（`1037ea15…`、31,810,730 bytes）と**完全に一致**する。
`60c72b08` → `bf755716` の差分は `docs/release.md`、`docs/runbook/**`、
`docs/security/supply-chain-artifact-attestation.md`、`.github/workflows/ci.yml`
のコメント、および証跡文書であり、build output に入る byte を一切変更しない。
この一致は「docs のみの差分が artifact を変えない」ことの実測であり、
以降 docs だけの commit に対して freeze を繰り返さない判断の根拠になる。

## 4. 範囲外（本記録が名乗らないこと）

1. **Cloudflare が deploy した byte は attest していない。** manifest の
   `coverage` は `github-actions-production-build-output hashed; Cloudflare-deployed
   bytes NOT attested` で、owner 決定 2026-10-19 のまま変わっていない。
2. **署名はしていない**（`unsigned`）。本記録は署名の代わりにならない。
3. **byte の保持は CI run の保持期間に依存する。** 90 日を過ぎると artifact は消え、
   この照合は再現できなくなる（manifest の記録は残るが byte は残らない）。
4. **tag `v0.9.0` での再確認は release step 12 以降の作業（Phase B）。**
   `release-0-9-0 → main` の通常 merge は新しい merge commit を生むため、
   本記録の manifest は tag 対象 commit に対して `SOURCE_COMMIT_MISMATCH` で
   fail するのが正しい。tag 対象 commit の `main` push run が残す
   artifact pair を使って `--release-tag=v0.9.0` 照合と byte 照合を
   別途実施する（`docs/release.md` §9.1 Phase B）。
5. **`bf755716` 以降の docs commit（本記録を含む）と merge commit の byte は
   本記録の対象外。** freeze 対象は run 44014355896 の headSha であり、
   それ以外の commit の byte を名乗るものではない。

## 5. 実行手順の注意（`--source-sha`）

release step 9.1 のコマンド例は release ブランチの head をそのまま checkout して
実行する前提になっている。本記録の commit 後、checkout の HEAD は本記録を含む
docs commit となり manifest の `source.commit`（`bf755716`）と一致しないため、
照合時は `--source-sha` を明示する。別 commit の run を照合する場合は必須である
（v0.8.1 の記録 §4、`60c72b08` の記録 §5 と同じ理由）。
