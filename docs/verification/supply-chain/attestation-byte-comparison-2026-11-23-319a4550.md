# attestation と build output byte の照合記録（v0.12.0 Phase B / run 45036091731 / commit 319a4550）

`docs/release.md` §9.1 の **Phase B（tag 対象 commit の `main` push run に
対する照合）** の実行記録。Phase A（候補 `b7ec6e39` / run 45031883949）は
`attestation-byte-comparison-2026-11-22-b7ec6e39.md` を参照。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.12.0 |
| tag | `v0.12.0` → `319a4550915185a2c98c1069fd0a862b5b5555e0`（release-0-12-0 → main の merge commit） |
| 対象 manifest | `.tmp/release-manifest/319a4550…/0.12.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/319a4550…-phaseb/` |
| **照合した run** | [45036091731](https://github.com/rebuildup/my-web-2026/actions/runs/45036091731)（`event=push`、branch `main`、conclusion `success`） |

## 2. 手順と結果

```bash
SHA=319a4550915185a2c98c1069fd0a862b5b5555e0
RUN=45036091731
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA-phaseb
git fetch --tags

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/$SHA/0.12.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA-phaseb --release-tag=v0.12.0

pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/$SHA-phaseb \
  --manifest=.tmp/release-manifest/$SHA/0.12.0/artifact-attestation.json
```

### 2.1 attestation check

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 551 file record(s) agree with the aggregate
PASS  Source commit: 319a4550915185a2c98c1069fd0a862b5b5555e0
PASS  Release tag: v0.12.0 -> 319a4550915185a2c98c1069fd0a862b5b5555e0
PASS  Release tag version: v0.12.0 declares 0.12.0
PASS  Source tree: clean
PASS  Project: my-web-2026@0.12.0
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:8602b89ffeacff544350c963be9894ea39bb8ad09de5a584cf665f0153670de2 (551 file(s), 37606186 bytes)

status: PASS
```

### 2.2 bytes check

```text
[build-output-artifact] BYTES    match — 551 file(s), 37606186 byte(s), aggregate sha256 8602b89ffeacff544350c963be9894ea39bb8ad09de5a584cf665f0153670de2
[build-output-artifact] SECRETS  clean — 197 file(s) scanned, 354 skipped as non-text or oversized
[build-output-artifact] PASS
```

Phase A と同一の aggregate digest（`8602b89f…`）— merge commit の build
output は候補 freeze run のものと byte 一致（freeze 後の差分は docs-only
の記録 2 ファイルのみ）。

## 3. 公開・事後確認

- GitHub Release `v0.12.0` を tag `v0.12.0` に発行し、
  `sbom.cdx.json`（938 components）と本 phase の
  `artifact-attestation.json` を添付。
- 本番 deploy: Workers Builds が `319a4550` を配信。
  `GET https://rebuildup.dev/api/v1/health` が `version: "0.12.0"` を
  返すことを実測。
- production smoke: `pnpm run e2e:prod`（`e2e/prod-smoke.spec.ts`）
  **16 passed / 1 skipped** — canonical origin の代表 5 ルート
  （`/`・`/about`・`/portfolio`・`/tools`・`/api/v1/health`）の
  documented default state、short navigation path、transport security
  をすべて確認。
