# attestation と build output byte の照合記録（v0.13.0 Phase B / run 45104095624 / commit 4355747a）

`docs/release.md` §9.1 の **Phase B（tag 対象 commit の `main` push run に
対する照合）** の実行記録。Phase A（候補 `90bc3bc4` / run 45050144861）は
`attestation-byte-comparison-2026-11-23-90bc3bc4.md` を参照。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.13.0 |
| tag | `v0.13.0` → `4355747ad0572f4540862a99305cdd86787985a6`（release-0-13-0 → main の merge commit） |
| 対象 manifest | `.tmp/release-manifest/4355747a…/0.13.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/4355747a…/` |
| **照合した run** | [45104095624](https://github.com/rebuildup/my-web-2026/actions/runs/45104095624)（`event=push`、branch `main`、conclusion `success`） |

## 2. 手順と結果

```bash
SHA=4355747ad0572f4540862a99305cdd86787985a6
RUN=45104095624
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA
git fetch --tags

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/$SHA/0.13.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA --release-tag=v0.13.0

pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-manifest/$SHA/0.13.0/artifact-attestation.json
```

Phase A の成果物は流用せず、tag 対象 commit の `main` push run
`45104095624` から取得した manifest と build bytes のみを使用した。

### 2.1 attestation check

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 556 file record(s) agree with the aggregate
PASS  Source commit: 4355747ad0572f4540862a99305cdd86787985a6
PASS  Release tag: v0.13.0 -> 4355747ad0572f4540862a99305cdd86787985a6
PASS  Release tag version: v0.13.0 declares 0.13.0
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

Phase A と同一の aggregate digest（`f9d96f34…`）— merge commit の build
output は候補 freeze run のものと byte 一致（freeze 後の差分は docs-only
の記録コミットのみで、build 対象に影響しない）。

## 3. 公開・事後確認

- `v0.13.0` tag を merge commit `4355747a` に作成・push 済み
  （`git ls-remote --tags` で tag → commit の一致を確認）。
- GitHub Release `v0.13.0` を発行済み（`isDraft: false`）。添付 asset:
  `sbom.cdx.json`（938 components）と本 phase の
  `artifact-attestation.json`。
- 本番 deploy: Workers Builds が `4355747a` を配信。
  `GET https://rebuildup.dev/api/v1/github-profile/status` が 200 /
  `image/svg+xml` を返すこと、`/github-profile/works/*.webp` 5 点が
  200 / `image/webp` を返すことを実測済み。
- GitHub プロフィール README（rebuildup/rebuildup#6、merge commit
  `1fc2c7c`）の全 6 画像が camo 経由で配信されることを
  desktop / mobile・light / dark の実画面で確認済み。
- 同一 `main` push run の companion checks: viewport regression
  `45104095669` success、browser compat `45104095597` success。
