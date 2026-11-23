# attestation と build output byte の照合記録（v0.13.1 Phase A / run 45154376719 / commit 04a78909）

`docs/release.md` §9.1 の **Phase A（release candidate freeze run に対する
照合）** の実行記録。PR #1208 差し戻し修正（Issue #1204/#1205、
ticket PR #1209/#1210）統合後の**新候補 SHA での取り直し**。
Phase B（tag 対象 commit の `main` push run）は merge 後に別記録として残す。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.13.1 |
| 対象 candidate | `04a7890996c47f6e9f384a17f5ba971de5efbc37`（release-0-13-1 head、freeze 時点） |
| 対象 manifest | `.tmp/release-manifest/04a78909…/0.13.1/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/04a78909…/` |
| **照合した run** | [45154376719](https://github.com/rebuildup/my-web-2026/actions/runs/45154376719)（`event=workflow_dispatch`、branch `release-0-13-1`、conclusion `success`） |

freeze run は `validate:integration`（`pnpm run test` を含む）+
Playwright E2E + SBOM + attestation manifest + `cf-typegen:check` を
同一 SHA `04a78909` で完走した。

### 中断 run の記録（正直な記録）

- run [45152883560](https://github.com/rebuildup/my-web-2026/actions/runs/45152883560)
  （dispatch @ `11c2c4c0`）は、証跡 docs コミット `04a78909` の push に
  よる concurrency cancel で中断。`ci.yml` の concurrency group は
  `github.ref` 単位のため、branch への push run が dispatch を cancel
  する（v0.13.0 時の run 45124810906 と同じ既知の挙動）。
- そのため head `04a78909` で再 dispatch した本 run が正本。
  `04a78909` は `11c2c4c0` + docs-only 1 コミットで、コード差分は
  freeze 候補 `11c2c4c0` と同一。

## 2. 手順と結果

```bash
SHA=04a7890996c47f6e9f384a17f5ba971de5efbc37
RUN=45154376719
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
PASS  Source commit: 04a7890996c47f6e9f384a17f5ba971de5efbc37
PASS  Source tree: clean
PASS  Project: my-web-2026@0.13.1
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:3cef66837738f937845add3d2cea6e6c0b51c01c176dc59d86fb92085d3c2e0f (571 file(s), 38462995 bytes)

status: PASS
```

### 2.2 bytes check — PASS

```text
[build-output-artifact] BYTES    match — 571 file(s), 38462995 byte(s),
  aggregate sha256 3cef66837738f937845add3d2cea6e6c0b51c01c176dc59d86fb92085d3c2e0f
[build-output-artifact] SECRETS  clean — 197 file(s) scanned, 374 skipped as non-text or oversized
[build-output-artifact] PASS
```

前回候補 `94f9f45d`（571 files / 38,462,501 bytes）からの差分は
+494 bytes。内訳は `/now` SVG 構成変更・roster 参照追加による Worker
bundle の変化と `reel.webp` 再生成（563,370 bytes）によるもの。
ロックファイル digest は不変（依存追加なし）。

## 3. operator ゲート（step 9）

- **A. R2 key-set audit — PASS**（2026-11-23 実施）:
  `infisical run --env=prod -- node scripts/check-r2-media-key-set.mjs
  --target=production` → `verdict=OK`、keys_total=133 /
  outside_allowlist=0 / enumeration=complete。`reel.webp`・
  `skills/*.svg` は静的 asset で R2 key-set 対象外。
- **B. `check-cf-secrets --execute` — 未実施（v0.13.1 限定例外）**:
  agent 環境に `INFISICAL_TOKEN` が無く実行できない。ユーザー判断により
  今回限り、v0.13.0 同日実測（Infisical prod parity / live Worker
  binding 全 PASS）を根拠とする例外を適用。**PASS ではなく「未実施」
  として記録する。** 本差分（ticket PR #1209/#1210 + docs）は
  secret・binding・wrangler 契約に変更なし。契約が変わった場合は
  例外を無効とし、次回以降の標準運用に省略を一般化しない。
