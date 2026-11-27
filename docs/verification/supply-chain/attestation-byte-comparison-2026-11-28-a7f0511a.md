# attestation と build output byte の照合記録（v0.16.0 Phase A / run 46046285117 / commit a7f0511a）

`docs/release.md` §9.1 の **Phase A（freeze 対象候補 commit の freeze run
に対する照合）** の実行記録。

## 1. 対象

| 項目 | 値 |
| --- | --- |
| 対象 release | v0.16.0 |
| 候補 commit（freeze SHA） | `a7f0511abedb061678a8f2e53abba9ab7c2b56d0`（release-0-16-0 head、#1276 merge 後） |
| 対象 manifest | `.tmp/release-manifest/a7f0511a…/0.16.0/artifact-attestation.json` |
| 対象 bytes | `.tmp/release-bytes/a7f0511a…/` |
| **照合した run** | [46046285117](https://github.com/rebuildup/my-web-2026/actions/runs/46046285117)（`event=workflow_dispatch`、branch `release-0-16-0`、conclusion `success`） |

## 2. 手順と結果

```bash
SHA=a7f0511abedb061678a8f2e53abba9ab7c2b56d0
RUN=46046285117
gh run download $RUN -n artifact-attestation-$SHA -D .tmp/release-manifest/$SHA
gh run download $RUN -n cf-build-output-$SHA -D .tmp/release-bytes/$SHA

pnpm run artifact:attestation:check -- \
  --manifest=.tmp/release-manifest/$SHA/0.16.0/artifact-attestation.json \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --source-sha=$SHA

pnpm run artifact:bytes:check -- \
  --artifact-dir=.tmp/release-bytes/$SHA \
  --manifest=.tmp/release-manifest/$SHA/0.16.0/artifact-attestation.json
```

freeze run `46046285117` の `validate` job（`validate:integration` +
attestation 生成）と `storybook axe` job ともに success。両 artifact が
同 run から取得できたことを確認した。

照合は worktree の checkout HEAD（`942d2da9`、別 ticket branch）が
freeze SHA と異なるため、`docs/release.md` §9.1 の規定どおり
`--source-sha=$SHA` を付与した。初回の `--source-sha` 無し実行は
`SOURCE_COMMIT_MISMATCH`（期待値=checkout HEAD）で FAIL — 契約どおりの
fail-closed であり、artifact 側の記録（`a7f0511a`）は正しかった。

### 2.1 attestation check

```text
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 631 file record(s) agree with the aggregate
PASS  Source commit: a7f0511abedb061678a8f2e53abba9ab7c2b56d0
PASS  Source tree: clean
PASS  Project: my-web-2026@0.16.0
PASS  Artifact digest: sha-256:c430b35f9183565481f37a1b045ea098632cc586bc59bfea4a80352b2baea13e (631 file(s), 48430047 bytes)

status: PASS
```

（中間の PASS 行は v0.15.2 記録と同一構成: lockfile digest・依存範囲・
package manager・Worker identity・attested scope・signature・deploy id）

### 2.2 bytes check

```text
[build-output-artifact] BYTES    match — 631 file(s), 48430047 byte(s), aggregate sha256 c430b35f9183565481f37a1b045ea098632cc586bc59bfea4a80352b2baea13e
[build-output-artifact] SECRETS  clean — 193 file(s) scanned, 438 skipped as non-text or oversized
[build-output-artifact] PASS
```

v0.15.2 Phase A（digest `20fa2cb1…`、631 files / 48,433,839 bytes）との差分は
#1262/#1264/#1268/#1286/#1284 の github-profile 配信再構成と #1254 監視系の
bundle 差 — file 数は同一、bytes は -33,792。

## 3. 残存注意

- freeze SHA `a7f0511a` は #1276 merge 直後の head。本記録 commit および
  step-9 記録 commit は freeze 後の docs-only commit であり、v0.15.1 と
  同じ運用（freeze SHA を候補として保持、head の docs 差分は attestation
  対象外）に従う。
- 並行 ticket PR #1282 / #1285 が release-0-16-0 に残っている（いずれも
  validate 失敗中・別セッション作業中）。これらが merge された場合、
  release head が freeze SHA から更に進むため、最終候補の確定時に
  freeze の再実行が必要になる可能性がある。
