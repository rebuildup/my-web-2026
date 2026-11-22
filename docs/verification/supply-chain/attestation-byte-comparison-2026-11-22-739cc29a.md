# attestation と build output byte の照合記録（v0.11.3 Phase A / run 45015844125 / commit 739cc29a）

`docs/release.md` §9.1 の **Phase A（release candidate freeze run に対する
照合）** の実行記録。Phase B（tag 対象 commit の `main` push run）は
merge 後に別記録として残す。

前回候補 `f0bb9b61` はプロフィールカードの外部 `<image href>` 不具合
（`<img>` 経由 SVG は外部サブリソースを読み込まない）とステータス
パネルの座標不具合の指摘により差し戻され、修正（PR #1186、
`data:` URI 埋め込み + パネル配置是正）を統合した本 SHA が新しい
リリース候補である。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.11.3 |
| 対象 candidate | `739cc29a90a4cee5cfddec52dcf8bf44a8e25068`（release-0-11-3 head、freeze 時点） |
| 対象 manifest | `.tmp/release-manifest/739cc29a…/0.11.3/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/739cc29a…/` |
| **照合した run** | [45015844125](https://github.com/rebuildup/my-web-2026/actions/runs/45015844125)（`event=workflow_dispatch`、branch `release-0-11-3`、conclusion `success`） |

## 2. 手順と結果

```bash
SHA=739cc29a90a4cee5cfddec52dcf8bf44a8e25068
RUN=45015844125
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/$SHA/0.11.3/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA --source-sha=$SHA

pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-manifest/$SHA/0.11.3/artifact-attestation.json
```

### 2.1 attestation check

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 545 file record(s) agree with the aggregate
PASS  Source commit: 739cc29a90a4cee5cfddec52dcf8bf44a8e25068
PASS  Source tree: clean
PASS  Project: my-web-2026@0.11.3
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:1ab66313673183ec5206bc4e1d7af33d9ec9bb826c7e3deddef28f6bc75897f4 (545 file(s), 37562813 bytes)

status: PASS
```

### 2.2 bytes check

```text
[build-output-artifact] BYTES    match — 545 file(s), 37562813 byte(s), aggregate sha256 1ab66313673183ec5206bc4e1d7af33d9ec9bb826c7e3deddef28f6bc75897f4
[build-output-artifact] SECRETS  clean — 191 file(s) scanned, 354 skipped as non-text or oversized
[build-output-artifact] PASS
```

## 3. 補足

- `pnpm run validate:release` は同 SHA で 85/85 ゲート PASS
  （ローカル実行、production build・attestation 生成を含む）。
- 本記録のコミット自体は freeze 対象 SHA に含まれない docs-only の
  追記であり、attestation の対象は引き続き `739cc29a` である。
