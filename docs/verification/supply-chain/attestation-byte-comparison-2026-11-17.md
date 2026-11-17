# attestation と build output byte の照合記録（v0.9.0 / run 43995834611 / commit ce1b69f3）

[Issue #448](https://github.com/rebuildup/my-web-2026/issues/448)
（[ADR-0035](../../adr/ADR-0035-artifact-attestation.md)）の required verification である
「最終 manifest を artifact と bytes の両方に対して照合する」実行記録。

v0.8.0 / v0.8.1 の記録（[2026-11-02](./attestation-byte-comparison-2026-11-02.md) /
[2026-11-05](./attestation-byte-comparison-2026-11-05.md)）と同じ手順で、
v0.9.0 release branch `release-0-9-0` の freeze run に対して実施した。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.9.0（`package.json#version` = `0.9.0`） |
| 対象 branch | `release-0-9-0` |
| 対象 commit | `ce1b69f3e59462617730eb37453e0673c0818bf0` |
| 対象 manifest | `.tmp/release-manifest/ce1b69f3/0.9.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/ce1b69f3/` |
| **照合した run** | [43995834611](https://github.com/rebuildup/my-web-2026/actions/runs/43995834611)（`event=workflow_dispatch`、branch `release-0-9-0`、conclusion `success`） |
| tag | 未作成（`release-0-9-0 → main` 統合と tag 作成は明示承認待ちのため、`--release-tag` 照合は tag 作成後に実施） |

本記録が照合したのは **CI run 43995834611 が作った artifact / bytes** である。
それ以外の run / commit / byte を名乗るものではない。

## 2. 手順

`docs/release.md` step 9.1 と同じ。artifact は同一 run から取得する:

```bash
SHA=ce1b69f3e59462617730eb37453e0673c0818bf0
RUN=43995834611
gh run download $RUN -R rebuildup/my-web-2026 -n artifact-attestation-$SHA \
  -D .tmp/release-manifest/$SHA
gh run download $RUN -R rebuildup/my-web-2026 -n cf-build-output-$SHA \
  -D .tmp/release-bytes/$SHA
```

実行結果: 両 artifact は上記 run から取得済みで、manifest の配置は
`.tmp/release-manifest/ce1b69f3/0.9.0/artifact-attestation.json`、
bytes の配置は `.tmp/release-bytes/ce1b69f3/` である。

### 2.1 `pnpm run artifact:attestation:check`

```bash
pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/ce1b69f3/0.9.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/ce1b69f3 \
  --source-sha=ce1b69f3e59462617730eb37453e0673c0818bf0
```

```text
[artifact-attestation] PASS  Schema: my-web-2026/artifact-attestation/v1
[artifact-attestation] PASS  Manifest file list: 498 file record(s) agree with the aggregate
[artifact-attestation] PASS  Source commit: ce1b69f3e59462617730eb37453e0673c0818bf0
[artifact-attestation] PASS  Source tree: clean
[artifact-attestation] PASS  Project: my-web-2026@0.9.0
[artifact-attestation] PASS  Lockfile digest: cf90030536e323a832efbc90c2c710a631b792dba4b3f052569eb718a03a4ac0 (923 resolved package version(s))
[artifact-attestation] PASS  Declared dependencies: package.json dependency ranges agree
[artifact-attestation] PASS  Package manager: pnpm@12.3.4
[artifact-attestation] PASS  Worker identity: my-web-2026
[artifact-attestation] PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
[artifact-attestation] PASS  Signature: unsigned (no signature claimed)
[artifact-attestation] PASS  Cloudflare deploy id: not provided (no id invented)
[artifact-attestation] PASS  Artifact digest: sha-256:e7ae179524763b246259d220064fecd755a439d27ba60ecb93f8e90c6b8c5997 (498 file(s), 31809485 bytes)

status: PASS
```

### 2.2 `pnpm run artifact:bytes:check`

```bash
pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/ce1b69f3 \
  --manifest=.tmp/release-manifest/ce1b69f3/0.9.0/artifact-attestation.json
```

```text
[build-output-artifact] BYTES    match — 498 file(s), 31809485 byte(s), aggregate sha256 e7ae179524763b246259d220064fecd755a439d27ba60ecb93f8e90c6b8c5997
[build-output-artifact] SECRETS  clean — 167 file(s) scanned, 331 skipped as non-text or oversized
[build-output-artifact] PASS
```

## 3. manifest 側の内容（読んだ値）

`artifact-attestation.json` の主な値（本記録が実行して読んだ範囲）:

| フィールド | 値 |
| --- | --- |
| `schema` | `my-web-2026/artifact-attestation/v1` |
| `producer.run.id` | `43995834611` |
| `producer.run.event` | `workflow_dispatch` |
| `producer.run.branch` | `release-0-9-0` |
| `source.commit` | `ce1b69f3e59462617730eb37453e0673c0818bf0` |
| `source.tree` | `clean` |
| `project.name` / `project.version` | `my-web-2026` / `0.9.0` |
| `toolchain.package_manager` | `pnpm` / `12.3.4` |
| `toolchain.build` | `vite` / `7.3.6` |
| `toolchain.runtime` | `@cloudflare/vite-plugin` / `1.56.0`、`wrangler` / `4.151.0` |
| `toolchain.runner` | `ubuntu-24.04` |
| `inputs.lockfile_digest` | `sha256:cf90030536e323a832efbc90c2c710a631b792dba4b3f052569eb718a03a4ac0`（923 resolved package version(s)） |
| `inputs.cloudflare.bindings_source` | `wrangler.jsonc`（`base_development_data_source` / `remote_proxy_oauth` は frozen せず production 値のみ、Issue #581 / #606 / #613） |
| `coverage` | `github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested` |
| `signature` | `none`（`unsigned`） |
| `deploy.id` | `not provided` |
| `artifact.count` / `artifact.total_bytes` | `498` / `31809485` |
| `artifact.digest.algorithm` / `artifact.digest.value` | `sha-256` / `e7ae179524763b246259d220064fecd755a439d27ba60ecb93f8e90c6b8c5997` |

bytes 照合の結果: `BYTES match`（498 files / 31,809,485 bytes）、`SECRETS clean`
（167 text file scanned、331 skipped as non-text or oversized）。

## 4. 範囲外（本記録が名乗らないこと）

1. **Cloudflare が deploy した byte は attest していない。** manifest の
   `coverage` は `github-actions-production-build-output hashed; Cloudflare-deployed
   bytes NOT attested` で、owner 決定 2026-10-19 のまま変わっていない。
2. **署名はしていない**（`unsigned`）。本記録は署名の代わりにならない。
3. **byte の保持は CI run の保持期間に依存する。** 90 日を過ぎると artifact は消え、
   この照合は再現できなくなる（manifest の記録は残るが byte は残らない）。
4. **tag `v0.9.0` での再確認は release step 12 以降の作業。** 本記録は tag 作成前の
   commit `ce1b69f3` に対する照合であり、tag 照合（`--release-tag`）は
   tag が存在してから別途実施する。
5. **v0.9.0 の merge commit / tag 作成後の byte は本記録の対象外。**
   merge commit での再確認は release report に記す。

## 5. 実行手順の注意（`--source-sha`）

release step 9.1 のコマンド例は release ブランチの head をそのまま checkout して
実行する前提になっている。本記録では checkout の HEAD が manifest の
`source.commit` と一致していたため `--source-sha` は明示したが、別 commit の run を
照合する場合は必須である（v0.8.1 の記録 §4 と同じ理由）。
