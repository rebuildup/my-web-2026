# attestation の byte 照合 — v0.8.1（release step 9.1）

- 日付: 2026-11-05
- 対象: `v0.8.1` の release attestation（Issue #476 / #816 / #906）
- 状態: **PASS**（attestation 照合 / byte 照合の 2 件とも）
- 前提: 先行する v0.8.0 の記録
  [`attestation-byte-comparison-2026-11-02.md`](attestation-byte-comparison-2026-11-02.md)
  は「未実行」であり、本記録は 0.8.1 以降で必須になった最初の実行である。
- 欠陥の実測と修正: [`build-output-retention-hidden-files-2026-11-05.md`](build-output-retention-hidden-files-2026-11-05.md)（Issue #906）

## 1. 照合した run と byte

| 項目 | 値 |
| --- | --- |
| workflow | `.github/workflows/ci.yml`（`CI`） |
| event | `push` |
| branch | `906` |
| run id | `41958112190` |
| commit | `c6d778c4978ad51491facd9be10b8d94c9df00e2` |
| manifest artifact | `artifact-attestation-c6d778c4…`（27,600 B） |
| byte artifact | `cf-build-output-c6d778c4…`（18,424,234 B） |
| 保持期間 | 90 日 |

取得は release step 9.1 の手順どおり:

```bash
gh run download 41958112190 -n artifact-attestation-c6d778c4… -D .tmp/release-manifest/c6d778c4…
gh run download 41958112190 -n cf-build-output-c6d778c4…   -D .tmp/release-bytes/c6d778c4…
```

## 2. verdict（2 件とも PASS）

### 2.1 `pnpm run artifact:attestation:check`

```text
$ pnpm run artifact:attestation:check -- \
    --manifest=.tmp/release-manifest/c6d778c4…/0.8.1/artifact-attestation.json \
    --artifact-dir=.tmp/release-bytes/c6d778c4… \
    --source-sha=c6d778c4978ad51491facd9be10b8d94c9df00e2
PASS  Schema: my-web-2026/artifact-attestation/v1
PASS  Manifest file list: 492 file record(s) agree with the aggregate
PASS  Source commit: c6d778c4978ad51491facd9be10b8d94c9df00e2
PASS  Source tree: clean
PASS  Project: my-web-2026@0.8.1
PASS  Lockfile digest: 4635fcb3e218c93ccfab77e020702ef10ead849c0898e6c70406aa53bb8b2302 (907 resolved package version(s))
PASS  Declared dependencies: package.json dependency ranges agree
PASS  Package manager: pnpm@12.3.4
PASS  Worker identity: my-web-2026
PASS  Attested scope: github-actions-production-build-output hashed; Cloudflare-deployed bytes NOT attested
PASS  Signature: unsigned (no signature claimed)
PASS  Cloudflare deploy id: not provided (no id invented)
PASS  Artifact digest: sha-256:8aa400adffa029de72db9423fa883b46ff8a2c6530516aa9418ed02839f6546b (492 file(s), 31314893 bytes)

status: PASS
```

### 2.2 `pnpm run artifact:bytes:check`

```text
$ pnpm run artifact:bytes:check -- \
    --artifact-dir=.tmp/release-bytes/c6d778c4… \
    --manifest=.tmp/release-manifest/c6d778c4…/0.8.1/artifact-attestation.json
[build-output-artifact] BYTES    match — 492 file(s), 31314893 byte(s), aggregate sha256 8aa400adffa029de72db9423fa883b46ff8a2c6530516aa9418ed02839f6546b
[build-output-artifact] SECRETS  clean — 161 file(s) scanned, 331 skipped as non-text or oversized
[build-output-artifact] PASS
```

## 3. 修正前との比較（同じ digest であることの意味）

修正前の pair（run `41953079799`、`75069da5…`）は **FAIL** だった:

```text
FAIL  Manifest file list: manifest carries 492 file record(s), artifact has 491
missing: workers/default/bundle/.vite/manifest.json
```

修正前 manifest の集約 digest は `8aa400adffa029de72db9423fa883b46ff8a2c6530516aa9418ed02839f6546b` で、
**修正後 manifest の digest と同一**である。`ci.yml` は build input ではないので build output の byte は変わらず、
変わったのは「CI がそのうち何 byte を保持したか」だけである。したがって本 PASS は
「別 build が偶然一致した」ではなく、**同じ byte 集合が同じ digest で照合された**ことを意味する。

## 4. 実行手順の注意（`--source-sha`）

release step 9.1 のコマンド例は、release ブランチの head をそのまま checkout して実行する前提になっている。
本記録のように**別 commit の run を照合する**場合、`check-artifact-attestation.mjs` の
`Source commit` 検査は checkout の HEAD と manifest の `source.commit` を比較するため、
`--source-sha=<run の commit>` を渡さないと `SOURCE_COMMIT_MISMATCH` で落ちる（byte は一致していても FAIL になる）。
`docs/release.md` step 9.1 にこの 1 行を追記した。

## 5. 範囲外（本記録が名乗らないこと）

1. **Cloudflare が deploy した byte は attest していない。** manifest の
   `coverage` は `github-actions-production-build-output hashed; Cloudflare-deployed
   bytes NOT attested` で、これは owner 決定 2026-10-19 のまま変わっていない。
2. **署名はしていない**（`unsigned`）。本記録は署名の代わりにならない。
3. **byte の保持は CI run の保持期間に依存する。** 90 日を過ぎると artifact は消え、
   この照合は再現できなくなる（manifest の記録は残るが byte は残らない）。
4. **release ブランチの merge commit での再確認は release report（PR #763）に記す。**
   本記録の対象は上表の run / commit であり、それ以外の commit の byte を
   名乗るものではない。
