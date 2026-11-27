# attestation と build output byte の照合記録（v0.14.0 Phase B / run 45835127646 / commit e37983d7）

`docs/release.md` §9.1 の **Phase B（tag 対象 commit の `main` push run に
対する照合）** の実行記録。Phase A（候補 `21cc3c8a` / run 45817045977）は
`attestation-byte-comparison-2026-11-26-21cc3c8a.md` を参照。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.14.0 |
| tag | `v0.14.0` → `e37983d79a1abe170d7b7dccc9f4b27a9b759d17`（release-0-14-0 → main の merge commit、PR #1238） |
| 対象 manifest | `.tmp/release-manifest/e37983d7…/0.14.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/e37983d7…/` |
| **照合した run** | [45835127646](https://github.com/rebuildup/my-web-2026/actions/runs/45835127646)（`event=push`、branch `main`、conclusion `success`） |

## 2. 手順と結果

```bash
SHA=e37983d79a1abe170d7b7dccc9f4b27a9b759d17
RUN=45835127646
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA
git fetch --tags

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/$SHA/0.14.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA --release-tag=v0.14.0

pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-manifest/$SHA/0.14.0/artifact-attestation.json
```

Phase A の成果物は流用せず、tag 対象 commit の `main` push run
`45835127646` から取得した manifest と build bytes のみを使用した。

### 2.1 attestation check

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 630 file record(s) agree with the aggregate
PASS  Source commit: e37983d79a1abe170d7b7dccc9f4b27a9b759d17
PASS  Release tag: v0.14.0 -> e37983d79a1abe170d7b7dccc9f4b27a9b759d17
PASS  Release tag version: v0.14.0 declares 0.14.0
PASS  Source tree: clean
PASS  Project: my-web-2026@0.14.0
PASS  Lockfile digest: eb5f3c172835ad6e98db4ec1e80d764955912e49bfb0fecfb42cad486ddae406 (923 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:4e9a78f1c9becf6c938408c9fbe95dc70aad9ba832588e1b5546a42cc564969e (630 file(s), 43685417 bytes)

status: PASS
```

### 2.2 bytes check

```text
[build-output-artifact] BYTES    match — 630 file(s), 43685417 byte(s), aggregate sha256 4e9a78f1c9becf6c938408c9fbe95dc70aad9ba832588e1b5546a42cc564969e
[build-output-artifact] SECRETS  clean — 193 file(s) scanned, 437 skipped as non-text or oversized
[build-output-artifact] PASS
```

Phase A と同一の aggregate digest（`4e9a78f1…`）— merge commit の build
output は候補 freeze run のものと byte 一致（freeze 後の差分は docs-only
の記録コミットのみで、build 対象に影響しない）。

## 3. 公開・事後確認

- `v0.14.0` tag を merge commit `e37983d7` に作成・push 済み
  （annotated tag object `5d0df2e3`、`git ls-remote --tags` で確認）。
- GitHub Release `v0.14.0` を発行済み（`isDraft: false`）。添付 asset:
  `sbom.cdx.json`（938 components、同 run の SBOM artifact）と本 phase の
  `artifact-attestation.json`。
- 本番 deploy: Cloudflare Workers Builds が `e37983d7` を配信。
  post-deploy smoke（canonical origin `https://rebuildup.dev`）:
  `/` `/about` `/portfolio` `/tools` `/admin/login` `/api/v1/health`
  すべて 200。`GET /api/v1/github-profile/profile?theme=light` は
  200 / `image/svg+xml` / 188,311 bytes、新構成のセクション
  （VITALS / GITHUB ACTIVITY / RECENT EVENTS）と観測時刻
  `Nov 26 · 09:00 JST` を確認。`?theme=dark&layout=mobile` も 200。
  `/github-profile/showcase.webp` は 200 / `image/webp` / 4,638,668 bytes。
- GitHub プロフィール README（rebuildup/rebuildup#10、merge 済み）:
  `https://github.com/rebuildup?tab=readme` が camo 経由で新 README を
  配信。4 バリアント（desktop dark/light・mobile dark/light）の
  `/profile` SVG と `showcase.webp` が camo で 200 を確認
  （mobile 初回 fetch で camo 504 → 再試行で 200、origin は常時 200
  のため camo コールドフェッチの一過性タイムアウト）。SVG 内に
  SMIL `animateTransform` 2 件（Stack 2 レーンのマーキー）を確認。
- 同一 `main` push run の companion checks: browser compat
  `45835127714` success、viewport regression `45835127676` success。
