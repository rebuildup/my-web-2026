# attestation と build output byte の照合記録（v0.13.0 Phase A / run 45050144861 / commit 90bc3bc4）

`docs/release.md` §9.1 の **Phase A（release candidate freeze run に対する
照合）** の実行記録。Phase B（tag 対象 commit の `main` push run）は
merge 後に別記録として残す。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.13.0 |
| 対象 candidate | `90bc3bc429519ea2791d4dc87845b1c2b5c62535`（release-0-13-0 head、freeze 時点） |
| 対象 manifest | `.tmp/release-manifest/90bc3bc4…/0.13.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/90bc3bc4…/` |
| **照合した run** | [45050144861](https://github.com/rebuildup/my-web-2026/actions/runs/45050144861)（`event=workflow_dispatch`、branch `release-0-13-0`、conclusion `success`） |

## 2. 手順と結果

```bash
SHA=90bc3bc429519ea2791d4dc87845b1c2b5c62535
RUN=45050144861
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/$SHA/0.13.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA

pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-manifest/$SHA/0.13.0/artifact-attestation.json
```

`--source-sha` は渡していない: checkout の HEAD が freeze 対象
`90bc3bc4`（release-0-13-0 head）そのものであり、manifest の
`source.commit` と一致するため既定の比較で十分である。

### 2.1 attestation check

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 556 file record(s) agree with the aggregate
PASS  Source commit: 90bc3bc429519ea2791d4dc87845b1c2b5c62535
PASS  Source tree: clean
PASS  Project: my-web-2026@0.13.0
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:f9d96f346c805b5c78d77c63bc081ff99426fa323ddc8cf700cd11a848765beb (556 file(s), 37856804 bytes)

status: PASS
```

### 2.2 bytes check

```text
[build-output-artifact] BYTES    match — 556 file(s), 37856804 byte(s), aggregate sha256 f9d96f346c805b5c78d77c63bc081ff99426fa323ddc8cf700cd11a848765beb
[build-output-artifact] SECRETS  clean — 197 file(s) scanned, 359 skipped as non-text or oversized
[build-output-artifact] PASS
```

## 3. 補足

- freeze run `45050144861` は `workflow_dispatch` で release-0-13-0 head
  `90bc3bc4` に対して実行され、`validate` job（`validate:integration`
  84 step + dependency advisory + issue-closure audit + SBOM +
  attestation manifest + `cf-typegen:check` + Playwright E2E）と
  `storybook axe` がすべて success。`pnpm run test`（vitest workerd
  pool）は **238 files / 3798 tests passed**（1 expected fail,
  1 skipped、355.5s）、Playwright E2E は **203 passed**。
- release-0-13-0 への push run `45045215790`（validate:fast +
  cf-typegen:check）も同 SHA `90bc3bc4` で success。
- 本記録のコミット自体は freeze 対象 SHA に含まれない docs-only の
  追記であり、attestation の対象は引き続き `90bc3bc4` である。

## 4. ローカル `validate:release` の未完走について（正直な記録）

owner の指示（2026-11-23）により、ローカル環境固有の負荷を理由に
`pnpm run validate:release` の再試行は打ち切り、**本候補に限る検証
経路の例外**として記録する。**PASS とは記録しない。**

観測した事実:

- `node scripts/run-quality-gates.mjs release` を **3 回**実行
  （既定 jobs、`QUALITY_GATES_JOBS=2` を含む）。いずれもゲート
  `[43/85] pnpm run test` で停止。失敗は `test/integration/*` の
  workerd リクエストが vitest 既定の 5 秒 timeout を超過するもので、
  cold start が 10〜40 秒に達していた。対象は cors /
  security-headers / seo-head / seo-status-contract /
  public-internal-identifier-surface / ogp-card /
  request-anomaly-monitor / admin-step-up-auth 等、今回の変更と
  無関係な既存テスト。
- `pnpm run test` **単独実行でも同じく失敗**（16 件）。ゲート並列
  実行が原因ではない。
- 対照実験: `test/integration/security-headers.test.ts` を単独実行
  すると **20/20 PASS**（wall 78.5s、transform 47s / setup 40s）。
- 環境負荷: 実行時の load average は **15〜18**（10 コア機）。
  他プロジェクトの常駐 dev server / workerd プロセスが CPU を占有
  しており、owner の指示によりこれらは停止していない。
- ローカルで PASS を確認した範囲: ゲート 1–42 と 44–71（format /
  lint / architecture / 各種 check / asset-license / issue-closure
  等）。ゲート 72–85（build:production / bundle / cloudflare
  contract / attestation / cf-typegen）と test ゲートはローカルでは
  未完走。

CI 側の対応関係（同一 SHA `90bc3bc4` で実施済み）:

| ローカル未完走分 | CI freeze run 45050144861 での実施 |
| --- | --- |
| `[43/85] pnpm run test` | `validate:integration` 内で実施、**238 files / 3798 tests PASS** |
| `[72/85] pnpm run build:production` 以降 | `validate:integration` の 84 step に build / bundle / secret-scan / contract 系を含み **OK**、`cf-typegen:check` step **success**、attestation manifest 生成・本記録の Phase A で照合 **PASS** |
| 残りの release 固有ゲート | `validate:integration OK — 84 declared step(s)`、`storybook axe` **success** |

結論: ローカル `validate:release` は**未完走**であり、本記録は
その事実をそのまま残す。候補の検証は freeze run
`45050144861`（workflow_dispatch @ `90bc3bc4`、success）を正本と
する。ローカルタイムアウトの恒久的な改善要否は別 Issue での
追跡対象とし、リリース候補の変更は行わない（owner 指示）。
