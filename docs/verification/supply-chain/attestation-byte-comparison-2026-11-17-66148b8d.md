# attestation と build output byte の照合記録 — Phase B（v0.9.0 / run 44090425346 / merge commit 66148b8d）

[Issue #448](https://github.com/rebuildup/my-web-2026/issues/448)
（[ADR-0035](../../adr/ADR-0035-artifact-attestation.md)）の required verification の
**Phase B（tag 対象検証）** 実行記録。`docs/release.md` §9.1 の二相化に基づき、
merge commit 自身の `main` push run が残した artifact pair を照合した。

Phase A（merge 前候補検証）の記録は
[`attestation-byte-comparison-2026-11-17-8d62960a.md`](./attestation-byte-comparison-2026-11-17-8d62960a.md)
（run 44081774235 / candidate `8d62960a`）。**Phase A の manifest を tag 対象に
使ってはいけない**（`SOURCE_COMMIT_MISMATCH` で fail するのが正しい）ため、
本記録は別 run・別 commit の証跡である。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.9.0（`package.json#version` = `0.9.0`） |
| 対象 branch | `main`（merge commit） |
| 対象 commit | `66148b8deb599a944df709622ce606d5a74f5003`（PR #926 の merge commit） |
| tag | `v0.9.0` → `66148b8d…`（annotated tag object `2416c65a`、tag 対象 commit は merge commit と一致） |
| 対象 manifest | `.tmp/release-manifest/66148b8d/0.9.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/66148b8d/` |
| **照合した run** | [44090425346](https://github.com/rebuildup/my-web-2026/actions/runs/44090425346)（`event=push`、branch `main`、headSha `66148b8d…`、conclusion `success`） |
| merge | PR #926 `release-0-9-0 → main`、merged 2026-11-17T13:12:28Z |

本記録が照合したのは **CI run 44090425346 が作った artifact / bytes** である。
Phase A の run 44081774235 の artifact を名乗るものではない。

## 2. 手順

`docs/release.md` step 9.1（Phase B: tag 対象検証）と同じ。
artifact は tag 対象 commit の `main` push run から取得する:

```bash
SHA=66148b8deb599a944df709622ce606d5a74f5003
RUN=44090425346
gh run download $RUN -R rebuildup/my-web-2026 -n artifact-attestation-$SHA \
  -D .tmp/release-manifest/${SHA:0:8}
gh run download $RUN -R rebuildup/my-web-2026 -n cf-build-output-$SHA \
  -D .tmp/release-bytes/${SHA:0:8}
git fetch --tags
pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/${SHA:0:8}/0.9.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/${SHA:0:8} \
  --release-tag=v0.9.0
pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/${SHA:0:8} \
  --manifest=.tmp/release-manifest/${SHA:0:8}/0.9.0/artifact-attestation.json
```

実行結果: 両 artifact は上記 run から取得済み（498 files）。

### 2.1 `pnpm run artifact:attestation:check --release-tag=v0.9.0`

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 498 file record(s) agree with the aggregate
PASS  Source commit: 66148b8deb599a944df709622ce606d5a74f5003
PASS  Release tag: v0.9.0 -> 66148b8deb599a944df709622ce606d5a74f5003
PASS  Release tag version: v0.9.0 declares 0.9.0
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

```text
[build-output-artifact] BYTES    match — 498 file(s), 31810006 byte(s), aggregate sha256 efb2c67e9eca336a98cb83ebbfc350271cdf794fd69886b0b579f3fcafeb1bd0
[build-output-artifact] SECRETS  clean — 167 file(s) scanned, 331 skipped as non-text or oversized
[build-output-artifact] PASS
```

## 3. Phase A との照合（副次的な確認）

Phase B の aggregate digest `sha-256:efb2c67e…`（498 files / 31,810,006 bytes）は
**Phase A 候補 `8d62960a` の digest と完全に一致**する。`8d62960a` → merge commit
`66148b8d` の差分は merge に伴う docs / verification ファイルのみで、build output
に入る byte を変更しないことの実測であり、freeze 候補と出荷 byte の同一性を裏付ける。

| 項目 | Phase A（`8d62960a` / run 44081774235） | Phase B（`66148b8d` / run 44090425346） |
| --- | --- | --- |
| source.commit | `8d62960a…` | `66148b8d…`（merge commit、tag 対象） |
| artifact digest | `sha-256:efb2c67e…` | `sha-256:efb2c67e…`（同一） |
| file count / bytes | 498 / 31,810,006 | 498 / 31,810,006（同一） |
| lockfile digest | `cf900305…` | `cf900305…`（同一） |
| attestation verdict | PASS | PASS（`--release-tag=v0.9.0` で tag 照合も PASS） |
| byte comparison | BYTES match / SECRETS clean | BYTES match / SECRETS clean |

## 4. manifest 側の内容（読んだ値）

Phase A 記録 §3 と同一の構造。`source.commit` = `66148b8d…`、
`source.branch` = `main`、`subject.digest.value` = `efb2c67e…`、
`coverage` = `github-actions-production-build-output hashed; Cloudflare-deployed
bytes NOT attested`、`signature` = `unsigned`。

同 run が出力した他 artifact: `sbom-66148b8d…`（`sbom.cdx.json`）、
`dependency-advisory-report-66148b8d…`。GitHub Release には本 Phase B の
manifest と SBOM を添付する。

## 5. 範囲外（本記録が名乗らないこと）

1. **Cloudflare が deploy した byte は attest していない。** Workers Builds が
   `main` push で deploy した byte は manifest の attested scope 外
   （`deployed_bytes_attested: false`）。本番応答の確認は smoke test の範囲。
2. **署名はしていない**（`unsigned`）。
3. **byte の保持は CI run の保持期間に依存する。**
4. **本記録は merge commit `66148b8d` の byte のみを名乗る。** それ以降の
   main への commit（本記録を含む）は別 commit であり、tag `v0.9.0` の
   対象外である。

## 6. 公開ゲートの状態（本記録時点）

- copy editorial approval: PASS（`pr-926` record、fingerprint
  `sha256:dca17a59…`、owner-review confirmed — PR #926 コメント
  issuecomment-6947470726）
- privacy data-lifecycle 台帳: pending 0 件（全 entry `approved`）
- stale-content-review: queue 空（agent-recorded record は owner confirmation 待ち）
- operator gate: R2 audit PASS（133 keys / diff none）、secret parity OK
  （contract 4 name MATCH、extra は advisory）
- `validate:release`: 81/81 PASS（release head `7d45ad78`）
- PR #926 CI（pull_request / validate:integration）: SUCCESS
- Phase A: PASS（run 44081774235 / `8d62960a`）
- **Phase B: PASS（本記録 / run 44090425346 / `66148b8d` / tag `v0.9.0`）**
- 本番 deploy: Cloudflare Workers Builds が merge push で実施済み。
  `/api/v1/health` は `version: "0.9.0"` を返す（2026-11-17 確認）
- post-release smoke（`pnpm run e2e:prod`）: 本記録と同時進行。結果は
  release notes / 別記録に残す

Phase B PASS により `docs/release.md` §9.1 の tag 対象検証は完了し、
GitHub Release の公開条件を満たす。
