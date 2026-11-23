# attestation と build output byte の照合記録（v0.13.1 Phase A / run 45124951605 / commit 94f9f45d）

`docs/release.md` §9.1 の **Phase A（release candidate freeze run に対する
照合）** の実行記録。Phase B（tag 対象 commit の `main` push run）は
merge 後に別記録として残す。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.13.1 |
| 対象 candidate | `94f9f45dcf8318a66be225803c58dbaebb147d79`（release-0-13-1 head、freeze 時点） |
| 対象 manifest | `.tmp/release-manifest/94f9f45d…/0.13.1/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/94f9f45d…/` |
| **照合した run** | [45124951605](https://github.com/rebuildup/my-web-2026/actions/runs/45124951605)（`event=workflow_dispatch`、branch `release-0-13-1`、conclusion `success`） |

freeze run は `validate:integration`（`pnpm run test` を含む）+
Playwright E2E + SBOM + attestation manifest + `cf-typegen:check` を
同一 SHA `94f9f45d` で完走した。直前の dispatch（run 45124810906 /
`8fae9ed8`）は docs-only コミット push による concurrency cancel で
中断したため、本 run が正本である。

## 2. 手順と結果

```bash
SHA=94f9f45dcf8318a66be225803c58dbaebb147d79
RUN=45124951605
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/$SHA/0.13.1/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA

pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-manifest/$SHA/0.13.1/artifact-attestation.json
```

### 2.1 attestation check — PASS

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 571 file record(s) agree with the aggregate
PASS  Source commit: 94f9f45dcf8318a66be225803c58dbaebb147d79
PASS  Source tree: clean
PASS  Project: my-web-2026@0.13.1
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:c3d13c0dd2ea95275e46347472e87c6b85ff95e201caa8b56ce4e69201ad1347 (571 file(s), 38462501 bytes)

status: PASS
```

### 2.2 bytes check — PASS

```text
[build-output-artifact] BYTES    match — 571 file(s), 38462501 byte(s),
  aggregate sha256 c3d13c0dd2ea95275e46347472e87c6b85ff95e201caa8b56ce4e69201ad1347
[build-output-artifact] SECRETS  clean — 197 file(s) scanned, 374 skipped as non-text or oversized
[build-output-artifact] PASS
```

v0.13.0（556 files / 37,856,804 bytes）からの差分は、作品リール
`reel.webp`・スキル SVG 14点・`/now` ルート等の追加による +15 files /
+576,697 bytes。ロックファイル digest は v0.13.0 と同一
（依存追加なし）。

## 3. operator ゲート（step 9）

- **A. R2 key-set audit — PASS**（2026-11-23 実施）:
  `infisical run --env=prod -- node scripts/check-r2-media-key-set.mjs
  --target=production` → `verdict=OK`、keys_total=133 /
  outside_allowlist=0 / enumeration=complete。`reel.webp`・
  `skills/*.svg` は静的 asset で R2 key-set 対象外。
- **B. Infisical prod 契約観測 / secret parity / live binding —
  未実施（operator token 不在）**: agent 環境に writer/read の
  `INFISICAL_TOKEN`（または `INFISICAL_CLIENT_ID/SECRET`）が無く、
  `check-cf-secrets.mjs --execute` を実行できない。ただし本
  リリース差分に secret・binding・wrangler 設定の変更は無い
  （`git diff --name-only origin/main...HEAD` に該当ファイルなし）。
  merge 前に operator が B-1〜B-3 を実施するか、契約不変を理由に
  省略判断するかは人間承認ゲートで確認する。
