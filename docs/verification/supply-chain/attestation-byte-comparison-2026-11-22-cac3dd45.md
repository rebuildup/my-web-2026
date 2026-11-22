# attestation と build output byte の照合記録（v0.11.3 Phase B / run 45018793625 / commit cac3dd45）

`docs/release.md` §9.1 の **Phase B（tag 対象 commit の `main` push run に
対する照合）** の実行記録。Phase A（候補 `739cc29a` / run 45015844125）は
`attestation-byte-comparison-2026-11-22-739cc29a.md` を参照。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.11.3 |
| tag | `v0.11.3` → `cac3dd4523b1843f1358d1588aead6bb464fb252`（release-0-11-3 → main の merge commit） |
| 対象 manifest | `.tmp/release-manifest/cac3dd45…/0.11.3/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/cac3dd45…/` |
| **照合した run** | [45018793625](https://github.com/rebuildup/my-web-2026/actions/runs/45018793625)（`event=push`、branch `main`、conclusion `success`） |

## 2. 手順と結果

```bash
SHA=cac3dd4523b1843f1358d1588aead6bb464fb252
RUN=45018793625
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA
git fetch --tags

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/$SHA/0.11.3/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA --release-tag=v0.11.3

pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-manifest/$SHA/0.11.3/artifact-attestation.json
```

### 2.1 attestation check

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 545 file record(s) agree with the aggregate
PASS  Source commit: cac3dd4523b1843f1358d1588aead6bb464fb252
PASS  Release tag: v0.11.3 -> cac3dd4523b1843f1358d1588aead6bb464fb252
PASS  Release tag version: v0.11.3 declares 0.11.3
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

Phase A と同一の aggregate digest（`1ab66313…`）— merge commit の build
output は候補 freeze run のものと byte 一致。

## 3. 公開・事後確認

- GitHub Release `v0.11.3` を tag `v0.11.3` に発行し、
  `sbom.cdx.json`（938 components）と本 phase の
  `artifact-attestation.json` を添付済み。
- 本番 deploy: Workers Builds が `cac3dd45` を配信。`/api/v1/github-profile/card`
  は 200 / 1,232,011 bytes / 実カバー4枚の `data:` URI 埋め込み SVG を返す
  ことを実測済み。
- `github.com/rebuildup` でカード画像が Camo 経由で描画されることを
  Playwright で確認（`naturalWidth=1280`、complete）。
