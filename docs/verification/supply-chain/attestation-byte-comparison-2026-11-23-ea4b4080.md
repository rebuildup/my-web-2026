# attestation と build output byte の照合記録（v0.13.1 Phase A / run 45163611724 / commit ea4b4080）

`docs/release.md` §9.1 の **Phase A（release candidate freeze run に対する
照合）** の実行記録。PR #1208 第2ラウンド差し戻し修正（Issue #1204/#1205、
ticket PR #1211）統合後の**新候補 SHA での取り直し**。
Phase B（tag 対象 commit の `main` push run）は merge 後に別記録として残す。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.13.1 |
| 対象 candidate | `ea4b408093cf414598cb667f8287415b1896e41a`（release-0-13-1 head、freeze 時点） |
| 対象 manifest | `.tmp/release-manifest/ea4b4080…/0.13.1/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/ea4b4080…/` |
| **照合した run** | [45163611724](https://github.com/rebuildup/my-web-2026/actions/runs/45163611724)（`event=workflow_dispatch`、branch `release-0-13-1`、conclusion `success`） |

freeze run は `validate:integration`（`pnpm run test` を含む）+
Playwright E2E + SBOM + attestation manifest + `cf-typegen:check` を
同一 SHA `ea4b4080` で完走した。

前候補 `04a78909`（run 45154376719）の記録:
`attestation-byte-comparison-2026-11-23-04a78909.md`。

## 2. 手順と結果

```bash
SHA=ea4b408093cf414598cb667f8287415b1896e41a
RUN=45163611724
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
PASS  Source commit: ea4b408093cf414598cb667f8287415b1896e41a
PASS  Source tree: clean
PASS  Project: my-web-2026@0.13.1
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:35fd36d55accc031fd2c42cb85ae7409d73ab260206e07d8e10e65ab749bac63 (571 file(s), 38478322 bytes)

status: PASS
```

### 2.2 bytes check — PASS

```text
[build-output-artifact] BYTES    match — 571 file(s), 38478322 byte(s), aggregate sha256 35fd36d55accc031fd2c42cb85ae7409d73ab260206e07d8e10e65ab749bac63
[build-output-artifact] SECRETS  clean — 197 file(s) scanned, 374 skipped as non-text or oversized
[build-output-artifact] PASS
```

## 3. 差分サマリ（前候補 04a78909 → 今候補 ea4b4080）

- ticket PR #1211（`849c48e0` + merge `ea4b4080`）: `/now` の
  DECLARED FOCUS 化・コンパクト化、リールのシーム修正と
  isogasii→shinkansen 差替え、証跡 docs 更新。
- secret・binding・wrangler 契約の変更なし（operator gate B の
  v0.13.1 限定例外条件を維持）。
- R2 key-set: `public/` 配下のキー構成に変更なし（`reel.webp` は
  同一キーの内容更新のみ）。
