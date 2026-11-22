# attestation と build output byte の照合記録（v0.12.0 Phase A / run 45031883949 / commit b7ec6e39）

`docs/release.md` §9.1 の **Phase A（release candidate freeze run に対する
照合）** の実行記録。Phase B（tag 対象 commit の `main` push run）は
merge 後に別記録として残す。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.12.0 |
| 対象 candidate | `b7ec6e39f1a3285eaa9e5a969b0e87dae272161d`（release-0-12-0 head、freeze 時点） |
| 対象 manifest | `.tmp/release-manifest/b7ec6e39…/0.12.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/b7ec6e39-v2/` |
| **照合した run** | [45031883949](https://github.com/rebuildup/my-web-2026/actions/runs/45031883949)（`event=workflow_dispatch`、branch `release-0-12-0`、conclusion `success`） |

## 2. 手順と結果

```bash
SHA=b7ec6e39f1a3285eaa9e5a969b0e87dae272161d
RUN=45031883949
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/b7ec6e39-v2

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/$SHA/0.12.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/b7ec6e39-v2

pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/b7ec6e39-v2 \
  --manifest=.tmp/release-manifest/$SHA/0.12.0/artifact-attestation.json
```

`--source-sha` は渡していない: checkout の HEAD が freeze 対象
`b7ec6e39`（release-0-12-0 head）そのものであり、manifest の
`source.commit` と一致するため既定の比較で十分である。

### 2.1 attestation check

```text
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

## 3. 補足

- freeze run `45031883949` は `workflow_dispatch` で release-0-12-0 head
  `b7ec6e39` に対して実行され、`validate` job（validate:fast +
  validate:integration + dependency advisory + issue-closure audit +
  SBOM + attestation + Playwright E2E）と `storybook axe` がすべて
  success。
- release-0-12-0 への push run `45021624036`（validate:fast +
  cf-typegen:check）も同 SHA で success。
- 本記録のコミット自体は freeze 対象 SHA に含まれない docs-only の
  追記であり、attestation の対象は引き続き `b7ec6e39` である。
