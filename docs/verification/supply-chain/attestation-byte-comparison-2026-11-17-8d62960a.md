# attestation と build output byte の照合記録（v0.9.0 / run 44081774235 / commit 8d62960a）

[Issue #448](https://github.com/rebuildup/my-web-2026/issues/448)
（[ADR-0035](../../adr/ADR-0035-artifact-attestation.md)）の required verification である
「最終 manifest を artifact と bytes の両方に対して照合する」実行記録。

`bf755716` の記録（[同日付](./attestation-byte-comparison-2026-11-17-bf755716.md)）に続く
記録。owner 判断（2026-11-17、PR #926）により privacy data-lifecycle 台帳の
pending 5 entry を `approved` 化して公開文を追加し、公開日本語 copy の
owner 承認 record（`pr-926`）を ledger に記録したため、候補 SHA が
`bf755716` → `8d62960a` に変わり、freeze と本照合をやり直した。

`bf755716` → `8d62960a` の差分は `src/privacy/data-lifecycle.ts`（公開文の
追加と「匿名」→「名称非公開」の文言修正）、その test、
`quality/stale-content-review.json`（8 record 追加）、
`quality/copy-editorial-approvals.json`（`pr-926` 承認 record 追加）、
`scripts/check-stale-content-review.test.mjs`（SHIPPED_TODAY 前進）、
および copy レビュー資料である。build output に入る byte は privacy
notice の本文が変わるため digest は `bf755716` と異なる（§3）。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.9.0（`package.json#version` = `0.9.0`） |
| 対象 branch | `release-0-9-0` |
| 対象 commit | `8d62960a3d47f44f1178e824765b5e5ad6b3ef91` |
| 対象 manifest | `.tmp/release-manifest/8d62960a/0.9.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/8d62960a/` |
| **照合した run** | [44081774235](https://github.com/rebuildup/my-web-2026/actions/runs/44081774235)（`event=workflow_dispatch`、branch `release-0-9-0`、conclusion `success`、headSha `8d62960a…`） |
| tag | 未作成（`release-0-9-0 → main` 統合と tag 作成は owner 明示承認済みだが、merge commit 確定後に `--release-tag` 照合を実施） |

本記録が照合したのは **CI run 44081774235 が作った artifact / bytes** である。
それ以外の run / commit / byte を名乗るものではない。
`bf755716` の記録は別 run（44014355896）の証跡であり、本記録の代替にはならない。

## 2. 手順

`docs/release.md` step 9.1（Phase A: merge 前の候補検証）と同じ。
artifact は同一 run から取得する:

```bash
SHA=8d62960a3d47f44f1178e824765b5e5ad6b3ef91
RUN=44081774235
gh run download $RUN -R rebuildup/my-web-2026 -n artifact-attestation-$SHA \
  -D .tmp/release-manifest/${SHA:0:8}
gh run download $RUN -R rebuildup/my-web-2026 -n cf-build-output-$SHA \
  -D .tmp/release-bytes/${SHA:0:8}
```

実行結果: 両 artifact は上記 run から取得済みで、manifest の配置は
`.tmp/release-manifest/8d62960a/0.9.0/artifact-attestation.json`、
bytes の配置は `.tmp/release-bytes/8d62960a/` である。

### 2.1 `pnpm run artifact:attestation:check`

```bash
pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/8d62960a/0.9.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/8d62960a
```

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 498 file record(s) agree with the aggregate
PASS  Source commit: 8d62960a3d47f44f1178e824765b5e5ad6b3ef91
PASS  Source tree: clean
PASS  Project: my-web-2026@0.9.0
PASS  Lockfile digest: cf90030536e323a832efbc90c2c710a631b792dba4b3f052569eb718a03a4ac0 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:efb2c67e9eca336a98cb83ebbfc350271cdf794fd69886b0b579f3fcafeb1bd0 (498 file(s), 31810006 bytes)

status: PASS
```

### 2.2 `pnpm run artifact:bytes:check`

```bash
pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/8d62960a \
  --manifest=.tmp/release-manifest/8d62960a/0.9.0/artifact-attestation.json
```

```text
[build-output-artifact] BYTES    match — 498 file(s), 31810006 byte(s), aggregate sha256 efb2c67e9eca336a98cb83ebbfc350271cdf794fd69886b0b579f3fcafeb1bd0
[build-output-artifact] SECRETS  clean — 167 file(s) scanned, 331 skipped as non-text or oversized
[build-output-artifact] PASS
```

## 3. manifest 側の内容（読んだ値）

`artifact-attestation.json` の主な値（本記録が実行して読んだ範囲）:

| フィールド | 値 |
| --- | --- |
| `schema` | `my-web-2026/artifact-attestation/v1` |
| `source.repository` | `https://github.com/rebuildup/my-web-2026` |
| `source.commit` | `8d62960a3d47f44f1178e824765b5e5ad6b3ef91` |
| `source.branch` | `release-0-9-0` |
| `source.tree` | `clean` |
| `project.name` / `project.version` | `my-web-2026` / `0.9.0` |
| `dependencies.package_manager` | `pnpm@12.3.4` |
| `dependencies.lockfile` | `pnpm-lock.yaml` sha256 `cf90030536e323a832efbc90c2c710a631b792dba4b3f052569eb718a03a4ac0`（923 resolved package version(s)） |
| `dependencies.declared` | `package.json` の dependency ranges と一致（attestation check が検証済み） |
| `subject.kind` / `subject.root` | `cloudflare-build-output` / `.cloudflare/output/v0` |
| `subject.digest.algorithm` / `subject.digest.value` | `sha-256` / `efb2c67e9eca336a98cb83ebbfc350271cdf794fd69886b0b579f3fcafeb1bd0` |
| `subject.file_count` / `subject.total_bytes` | `498` / `31810006` |
| `cloudflare` | `provider: cloudflare-workers-builds`、`worker: my-web-2026`、`build_uuid: null`、`deploy_id: null` |
| `coverage` | `github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested`（`deployed_bytes_attested: false`） |
| `signature` | `unsigned`（`status: unsigned`、algorithm / key_id / value すべて null） |

manifest は run id / event を保持しない。対象 run（`44081774235`、
`event=workflow_dispatch`）は artifact 名と run の `headSha` 記録で特定した。
bytes 照合の結果: `BYTES match`（498 files / 31,810,006 bytes）、`SECRETS clean`
（167 text file scanned、331 skipped as non-text or oversized）。

`bf755716` の digest（`1037ea15…`、31,810,730 bytes）とは異なる。
privacy notice の公開文追加・文言修正が build output に入るためであり、
差分が artifact を変えることの実測である。lockfile digest と package
manager は `bf755716` と同一（依存関係の変更なし）。

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
5. **`8d62960a` 以降の docs commit（本記録を含む）と merge commit の byte は
   本記録の対象外。** freeze 対象は run 44081774235 の headSha であり、
   それ以外の commit の byte を名乗るものではない。

## 5. 実行手順の注意（`--source-sha`）

release step 9.1 のコマンド例は release ブランチの head をそのまま checkout して
実行する前提になっている。本記録の commit 後、checkout の HEAD は本記録を含む
docs commit となり manifest の `source.commit`（`8d62960a`）と一致しないため、
照合の再現時は `--source-sha=8d62960a3d47f44f1178e824765b5e5ad6b3ef91` を明示する
（v0.8.1 の記録 §4、`bf755716` / `60c72b08` の記録 §5 と同じ理由）。
本記録の実行時点では checkout HEAD が `8d62960a` と一致していたため
`--source-sha` は付けていない。

## 6. copy approval / stale review の状態（本候補時点）

- `pnpm run copy:approval:check -- --base=origin/main`: **PASS**。
  release 変更集合 fingerprint `sha256:dca17a5986715878faf9d0c9e11ad6bd09a822b847e403a4bd460f6f5820d7e2`、
  `pr-926` record が owner-review / confirmed（PR #926 コメント
  issuecomment-6947470726）。merge 前に公開日本語 copy が変われば
  fingerprint が変わり本承認は stale になる。
- `pnpm run copy:stale:check`: exit 0、review queue 空。
  新規公開文 8 expression の record は agent-recorded / unconfirmed
  （owner confirmation 待ち。鮮度ゲートのブロッカーではない）。
- privacy data-lifecycle 台帳: pending 0 件、全 entry `approved`。
- copy レビュー資料: `docs/verification/copy/release-0-9-0-public-copy-review-2026-11-17.md`。
  **承認記録ではなくレビュー資料**であり、承認の正本は `pr-926` record と
  PR #926 コメントである。

いずれも merge 前に copy / privacy / stale registry が変わった場合は
再検証が必要であり、本記録はその変化をカバーしない。
EOF
cd /tmp/r090b && git add docs/verification/supply-chain/attestation-byte-comparison-2026-11-17-8d62960a.md && git -c user.name="Devin" -c user.email="158243242+devin-ai-integration[bot]@users.noreply.github.com" commit -m "$(cat <<'EOF'
docs(release): record Phase A attestation and byte comparison for 8d62960a

Freeze run 44081774235 (workflow_dispatch, success): attestation
PASS (498 files / 31,810,006 bytes, aggregate sha256 efb2c67e…) and
byte comparison PASS (BYTES match, SECRETS clean) for the v0.9.0
release candidate after the owner-approved privacy/copy changes.

Generated with [Devin](https://devin.ai)

Co-Authored-By: Devin <158243242+devin-ai-integration[bot]@users.noreply.github.com>
EOF
)" && git push origin HEAD:release-0-9-0 2>&1 | tail -3 && git rev-parse HEAD