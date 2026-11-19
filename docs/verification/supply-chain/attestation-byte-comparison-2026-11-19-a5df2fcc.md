# attestation と build output byte の照合記録（v0.10.0 / run 44450888155 / commit a5df2fcc）

`docs/release.md` §9.1 の **Phase A（merge 前の候補検証）** である
「manifest を artifact と bytes の両方に対して照合する」実行記録。
対象は `release-0-10-0` の freeze run であり、tag 対象 commit の
`main` push run に対する Phase B 照合は別記録として後続で実施する。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.10.0（`package.json#version` = `0.10.0`） |
| 対象 branch | `release-0-10-0` |
| 対象 commit | `a5df2fccc56b6ac2082f94b037b6fc4147eb571d` |
| 対象 manifest | `.tmp/release-manifest/a5df2fcc/0.10.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/a5df2fcc/` |
| **照合した run** | [44450888155](https://github.com/rebuildup/my-web-2026/actions/runs/44450888155)（`event=workflow_dispatch`、branch `release-0-10-0`、conclusion `success`、headSha `a5df2fcc…`） |
| tag | 未作成（`release-0-10-0 → main` 統合と tag 作成は明示承認待ちのため、`--release-tag` 照合は tag 作成後に実施） |

本記録が照合したのは **CI run 44450888155 が作った artifact / bytes** である。
それ以外の run / commit / byte を名乗るものではない。

run の job 結果: `validate` success（21m45s）、`storybook axe` success（2m19s、97 tests passed）。
E2E は 170 passed / 2 skipped / 1 flaky（`e2e/portfolio.spec.ts` archived-slug 404、retry で pass — `cf d1 raw` local spawn の ETIMEDOUT による infra flake）。

## 2. 手順

`docs/release.md` §9.1（Phase A: merge 前の候補検証）と同じ。
artifact は同一 run から取得する:

```bash
SHA=a5df2fccc56b6ac2082f94b037b6fc4147eb571d
RUN=44450888155
gh run download $RUN -R rebuildup/my-web-2026 -n artifact-attestation-$SHA \
  -D .tmp/release-manifest/a5df2fcc
gh run download $RUN -R rebuildup/my-web-2026 -n cf-build-output-$SHA \
  -D .tmp/release-bytes/a5df2fcc
```

実行結果: 両 artifact は上記 run から取得済みで、manifest の配置は
`.tmp/release-manifest/a5df2fcc/0.10.0/artifact-attestation.json`、
bytes の配置は `.tmp/release-bytes/a5df2fcc/` である。

### 2.1 `pnpm run artifact:attestation:check`

```bash
pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/a5df2fcc/0.10.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/a5df2fcc \
  --source-sha=a5df2fccc56b6ac2082f94b037b6fc4147eb571d
```

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 529 file record(s) agree with the aggregate
PASS  Source commit: a5df2fccc56b6ac2082f94b037b6fc4147eb571d
PASS  Source tree: clean
PASS  Project: my-web-2026@0.10.0
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:74dbe96a01be28be3860644f59d8db61ccde4ca3fc35b650c4fa0e9b9b6be137 (529 file(s), 37299699 bytes)

status: PASS
```

### 2.2 `pnpm run artifact:bytes:check`

```bash
pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/a5df2fcc \
  --manifest=.tmp/release-manifest/a5df2fcc/0.10.0/artifact-attestation.json
```

```text
[build-output-artifact] BYTES    match — 529 file(s), 37299699 byte(s), aggregate sha256 74dbe96a01be28be3860644f59d8db61ccde4ca3fc35b650c4fa0e9b9b6be137
[build-output-artifact] SECRETS  clean — 175 file(s) scanned, 354 skipped as non-text or oversized
[build-output-artifact] PASS
```

## 3. manifest 側の内容（読んだ値）

`artifact-attestation.json` の主な値（本記録が実行して読んだ範囲）:

| フィールド | 値 |
| --- | --- |
| `schema` | `my-web-2026/artifact-attestation/v1` |
| `source.repository` | `https://github.com/rebuildup/my-web-2026` |
| `source.commit` | `a5df2fccc56b6ac2082f94b037b6fc4147eb571d` |
| `source.branch` | `release-0-10-0` |
| `source.tree` | `clean` |
| `project.name` / `project.version` | `my-web-2026` / `0.10.0` |
| `dependencies.package_manager` | `pnpm@12.3.4` |
| `dependencies.lockfile` | `pnpm-lock.yaml` sha256 `eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406`（923 resolved package version(s)） |
| `dependencies.declared` | `package.json` の dependency ranges と一致（attestation check が検証済み） |
| `subject.kind` / `subject.root` | `cloudflare-build-output` / `.cloudflare/output/v0` |
| `subject.digest.algorithm` / `subject.digest.value` | `sha-256` / `74dbe96a01be28be3860644f59d8db61ccde4ca3fc35b650c4fa0e9b9b6be137` |
| `subject.file_count` / `subject.total_bytes` | `529` / `37299699` |
| `cloudflare` | `provider: cloudflare-workers-builds`、`worker: my-web-2026`、`build_uuid: null`、`deploy_id: null` |
| `coverage` | `github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested`（`deployed_bytes_attested: false`） |
| `signature` | `unsigned`（`status: unsigned`、algorithm / key_id / value すべて null） |

manifest は run id / event を保持しない。対象 run（`44450888155`、
`event=workflow_dispatch`）は artifact 名と run の `headSha` 記録で特定した。

## 4. 範囲外（本記録が名乗らないこと）

1. **Cloudflare が deploy した byte は attest していない。** manifest の
   `coverage` は `github-actions-production-build-output hashed; Cloudflare-deployed
   bytes NOT attested` で、owner 決定 2026-10-19 のまま変わっていない。
2. **署名はしていない**（`unsigned`）。本記録は署名の代わりにならない。
3. **byte の保持は CI run の保持期間に依存する。** 保持期間を過ぎると
   artifact は消え、この照合は再現できなくなる（manifest の記録は残るが
   byte は残らない）。
4. **tag `v0.10.0` での再確認は release step 12 以降の作業（Phase B）。**
   `release-0-10-0 → main` の通常 merge は新しい merge commit を生むため、
   本記録の manifest は tag 対象 commit に対して `SOURCE_COMMIT_MISMATCH` で
   fail するのが正しい。tag 対象 commit の `main` push run が残す
   artifact pair を使って `--release-tag=v0.10.0` 照合と byte 照合を
   別途実施し、別記録（または本記録とは別の dated section）として残す。
5. **`a5df2fcc` 以降の docs commit（本記録を含む）と merge commit の byte は
   本記録の対象外。** freeze 対象は run 44450888155 の headSha であり、
   それ以外の commit の byte を名乗るものではない。

## 5. 実行手順の注意（`--source-sha`）

release step 9.1 のコマンド例は release ブランチの head をそのまま checkout
して実行する前提になっている。本記録の commit 後、checkout の HEAD は本記録を
含む docs commit となり manifest の `source.commit`（`a5df2fcc`）と一致しない
ため、照合時は `--source-sha` を明示する。別 commit の run を照合する場合は
必須である（v0.8.1 / v0.9.0 の記録と同じ理由）。

## 6. operator credentialed production checks

本 freeze では operator credentialed production checks（R2 media key-set audit、
secret parity / Cloudflare binding checks、read-only production smoke）は
**未実行**である。operator credential が agent 環境に存在しないためであり、
成功を名乗るものではない。これらは `docs/release.md` の operator gate として
owner / operator が別途実施する。

## 7. QA record

`docs/verification/release/` への v0.10.0 QA 記録は本記録とは別に作成する。
本記録は Phase A attestation/byte 照合のみを対象とし、QA verdict や release
readiness の主張を含まない。

## 8. 残りの release gate

- operator credentialed production checks（§6、未実行）
- `docs/verification/release/` の QA 記録
- `release-0-10-0 → main` promotion（明示 owner approval 必須）
- Phase B attestation/byte 照合（tag 作成後）
- GitHub Release 公開（sbom + phase-B manifest 添付、同一 human gate）

本記録は release readiness を主張しない。candidate freeze の Phase A 証跡のみである。

関連: [docs/release.md](../../release.md) §9.1、
[Issue #448](https://github.com/rebuildup/my-web-2026/issues/448)、
[ADR-0035](../../adr/ADR-0035-artifact-attestation.md)、
[v0.9.0 Phase A 記録](./attestation-byte-comparison-2026-11-17-bf755716.md)
