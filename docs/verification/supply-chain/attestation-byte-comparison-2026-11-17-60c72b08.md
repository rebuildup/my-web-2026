# attestation と build output byte の照合記録（v0.9.0 / run 44005487801 / commit 60c72b08）

[Issue #448](https://github.com/rebuildup/my-web-2026/issues/448)
（[ADR-0035](../../adr/ADR-0035-artifact-attestation.md)）の required verification である
「最終 manifest を artifact と bytes の両方に対して照合する」実行記録。

`ce1b69f3` の記録（[同日付](./attestation-byte-comparison-2026-11-17.md)）に続く
**再 freeze 後の候補**に対する記録。PR #960（GitHub Readme Stats 縮退契約 +
Home 活動説明の整合）を `release-0-9-0` へ統合したため、候補 SHA が
`ce1b69f3` → `60c72b08` に変わり、freeze と本照合をやり直した。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.9.0（`package.json#version` = `0.9.0`） |
| 対象 branch | `release-0-9-0` |
| 対象 commit | `60c72b08aeaec3b341c2d2434e21e10ef8bae51d` |
| 対象 manifest | `.tmp/release-manifest/60c72b08/0.9.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/60c72b08/` |
| **照合した run** | [44005487801](https://github.com/rebuildup/my-web-2026/actions/runs/44005487801)（`event=workflow_dispatch`、branch `release-0-9-0`、conclusion `success`、headSha `60c72b08…`） |
| tag | 未作成（`release-0-9-0 → main` 統合と tag 作成は明示承認待ちのため、`--release-tag` 照合は tag 作成後に実施） |

本記録が照合したのは **CI run 44005487801 が作った artifact / bytes** である。
それ以外の run / commit / byte を名乗るものではない。
`ce1b69f3` の記録は別 run（43995834611）の証跡であり、本記録の代替にはならない。

## 2. 手順

`docs/release.md` step 9.1 と同じ。artifact は同一 run から取得する:

```bash
SHA=60c72b08aeaec3b341c2d2434e21e10ef8bae51d
RUN=44005487801
gh run download $RUN -R rebuildup/my-web-2026 -n artifact-attestation-$SHA \
  -D .tmp/release-manifest/${SHA:0:8}
gh run download $RUN -R rebuildup/my-web-2026 -n cf-build-output-$SHA \
  -D .tmp/release-bytes/${SHA:0:8}
```

実行結果: 両 artifact は上記 run から取得済みで、manifest の配置は
`.tmp/release-manifest/60c72b08/0.9.0/artifact-attestation.json`、
bytes の配置は `.tmp/release-bytes/60c72b08/` である。

### 2.1 `pnpm run artifact:attestation:check`

```bash
pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/60c72b08/0.9.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/60c72b08 \
  --source-sha=60c72b08aeaec3b341c2d2434e21e10ef8bae51d
```

```text
[artifact-attestation] PASS  Schema: my-web-2026/artifact-attestation/v1
[artifact-attestation] PASS  Manifest file list: 498 file record(s) agree with the aggregate
[artifact-attestation] PASS  Source commit: 60c72b08aeaec3b341c2d2434e21e10ef8bae51d
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
  --artifact-dir=.tmp/release-bytes/60c72b08 \
  --manifest=.tmp/release-manifest/60c72b08/0.9.0/artifact-attestation.json
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
| `source.commit` | `60c72b08aeaec3b341c2d2434e21e10ef8bae51d` |
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

manifest は run id / event を保持しない。対象 run（`44005487801`、
`event=workflow_dispatch`）は artifact 名と run の `headSha` 記録で特定した。
bytes 照合の結果: `BYTES match`（498 files / 31,810,730 bytes）、`SECRETS clean`
（167 text file scanned、331 skipped as non-text or oversized）。

`ce1b69f3` の digest（`e7ae1795…`、31,809,485 bytes）との差分は PR #960 の
build output への反映分であり、file 数は同じ 498。

## 4. 範囲外（本記録が名乗らないこと）

1. **Cloudflare が deploy した byte は attest していない。** manifest の
   `coverage` は `github-actions-production-build-output hashed; Cloudflare-deployed
   bytes NOT attested` で、owner 決定 2026-10-19 のまま変わっていない。
2. **署名はしていない**（`unsigned`）。本記録は署名の代わりにならない。
3. **byte の保持は CI run の保持期間に依存する。** 90 日を過ぎると artifact は消え、
   この照合は再現できなくなる（manifest の記録は残るが byte は残らない）。
4. **tag `v0.9.0` での再確認は release step 12 以降の作業。** 本記録は tag 作成前の
   commit `60c72b08` に対する照合であり、tag 照合（`--release-tag`）は
   tag が存在してから別途実施する。
5. **`60c72b08` 以降の docs commit（本記録を含む）と merge commit の byte は
   本記録の対象外。** freeze 対象は run 44005487801 の headSha であり、
   それ以外の commit の byte を名乗るものではない。

## 5. 実行手順の注意（`--source-sha`）

release step 9.1 のコマンド例は release ブランチの head をそのまま checkout して
実行する前提になっている。本記録では checkout の HEAD（`6979f32d`）が manifest の
`source.commit`（`60c72b08`）と一致しないため `--source-sha` を明示した。
別 commit の run を照合する場合は必須である（v0.8.1 の記録 §4 と同じ理由）。
