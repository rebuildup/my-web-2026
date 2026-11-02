# attestation の byte 照合 — v0.8.0 の未実行と、0.8.1 以降の実行可能性

- 対象: `v0.8.0` の release attestation（Issue #476 / #816）
- 状態: **v0.8.0 の byte は取得不能**。照合は「未実行」のまま。0.8.1 以降は
  CI が byte を保持するので実行できる
- 実装: `.github/workflows/ci.yml`（upload step）、
  `docs/release.md` step 9、`docs/security/supply-chain-artifact-attestation.md` §4 / §7

## 1. 「未実行」の中身

v0.8.0 は公開済みである。release 時点で byte 照合が実行されず、
release 報告にも「未実行」と記録された。本記録は、その未実行が
**何を意味し、どこで詰まっているか**を実測で確定する。

### 1.1 実行できた部分（v0.8.0）

公開 manifest（GitHub Release の添付 `artifact-attestation.json`）に対する
**内部整合**の検査は、byte 無しでも実行できる。本 Issue で
`scripts/check-attestation-manifest-integrity.mjs` を追加した
（offline / status-only。`scripts/check-attestation-manifest-integrity.test.mjs`
が 15 件で固定している）。

```text
$ node scripts/check-attestation-manifest-integrity.mjs \
    --manifest=<published-manifest.json>
manifest: <published-manifest.json>
  PASS  Schema: my-web-2026/artifact-attestation/v1
  PASS  Digest algorithm: sha-256
  PASS  Subject files: 214 well-formed per-file records
  PASS  File count: 214
  PASS  Total bytes: 20463789
  PASS  Aggregate digest: ca4d922c223eaa21f357dc4c9178fd44bf4f4998fb9c901f7651ad569f8abedc
PASS  the manifest is internally consistent
bytes_verified=false  this check compares no bytes; only check-artifact-attestation.mjs --artifact-dir does
exit=0
```

この check は**release を通さない**。`bytes_verified=false` を常に出力する
のは、PASS が「byte を照合した」と読まれないためである。byte を比較する
のは `scripts/check-artifact-attestation.mjs --artifact-dir` だけであり、
その入力が存在しない v0.8.0 では未実行のままになる。

```text
$ git rev-parse 'v0.8.0^{commit}'
93b999dd4562a1a8f61f6a73d1e9510f08ede075
$ node -p "require('./<published-manifest.json>').source.commit"
93b999dd4562a1a8f61f6a73d1e9510f08ede075
```

つまり v0.8.0 について、次の 3 点は**確認済み**である。

| 事実 | 結果 |
| --- | --- |
| manifest の per-file 記録と aggregate digest が整合する | 一致（214 file / 20,463,789 byte） |
| manifest の `source.commit` が release tag `v0.8.0` の commit と一致する | 一致（`93b999dd`） |
| manifest の `project.version` が tag 名の version と一致する | 一致（`0.8.0`） |
| manifest が署名を名乗っていない | `unsigned` |
| manifest が deploy 済み byte を attest したと名乗っていない | `deployed_bytes_attested: false` |

### 1.2 実行できなかった部分（v0.8.0）

**manifest が記述する byte が 1 byte も残っていない。**

```text
$ gh api repos/rebuildup/my-web-2026/actions/runs/41302500102/artifacts \
    --jq '.artifacts[] | "\(.name) \(.size_in_bytes)B"'
dependency-advisory-report-93b999dd… 2080B
artifact-attestation-93b999dd…     13311B
sbom-93b999dd…                    111329B
```

release run（push, `93b999dd`）の artifact は 3 件で、Build Output は無い。
原因は `.github/workflows/ci.yml` の upload step が
`path: dist-cloudflare/` を指していたことにある。その directory を
作る build は存在しない（`build:production` は
`.cloudflare/output/v0` を書く）。`actions/upload-artifact` は
「一致 0 件」を成功として扱うので、step は緑のまま**空の artifact** を
作っていた。結果として、公開 manifest は
**手元に byte の無い文書**になっていた。

同じ理由で、Cloudflare が deploy した byte も引き続き対象外である
（owner 決定 2026-10-19、`coverage.deployed_bytes_attested: false`）。
本記録はその決定を変更しない。

再 build で代用できない理由: manifest は「ある 1 回の build の byte」を
記述する。同じ commit からの再 build が同一 byte になる保証は無く
（file 名に content hash が入り、toolchain / OS が違えば digest も違う）、
別 commit からの再 build はそもそも何も証明しない。

## 2. 何を埋めたか（0.8.1 以降に実行可能にする部分）

1. **CI が attested byte を保持する。**
   `.github/workflows/ci.yml` の upload step を
   `path: .cloudflare/output/v0/`（= `artifact:attestation:check` が
   hash したのと同じ directory）に直し、artifact 名を
   `cf-build-output-<sha>`、保持を 90 日（manifest と同じ）にした。
   `if-no-files-found: error` を付け、将来 path がずれた場合は
   空 artifact の成功ではなく赤になる。
2. **照合手順を文書にした。**
   `docs/release.md` step 9 と
   `docs/security/supply-chain-artifact-attestation.md` §4 / §7 に、
   `gh run download <run-id> -n cf-build-output-<sha> -D <dir>` →
   `pnpm run artifact:attestation:check -- --manifest=<path>
   --artifact-dir=<dir> --release-tag="v<version>"` を明記した。
   既存の tool がそのまま使える（新しい照合器は作っていない）。
   出力は status-only で、credential も file 内容も表示しない。

これにより 0.8.1 の release では、公開 manifest と attest された byte の
照合が **実際に実行できる**状態になる。

## 3. 埋められないもの（owner / human の操作が要る）

| 項目 | なぜ埋められないか | 誰が |
| --- | --- | --- |
| v0.8.0 の byte 照合そのもの | 当時の run が byte を保持していない。遡って取得する経路が無い | 不可能。**未実行のまま記録する**（PASS と呼ばない） |
| 0.8.1 の byte 照合の実行 | release owner が release tag を作り、CI artifact を取得し、manifest を Release に添付する操作の一部 | release owner（`AGENTS.md` §6 human gate） |
| deploy 済み byte の attestation | 現行 tool が back できない範囲。owner 決定 2026-10-19 で本 Issue の外 | owner 判断（別 Issue） |

v0.8.0 の記録は次の 1 文に尽きる: **manifest は tag と整合し内部的にも
整合しているが、それが記述する byte は残っておらず、公開物との byte 一致は
確認していない。**

## 4. 再現

```bash
# v0.8.0 の公開 manifest を取得する（status のみ、値は表示しない）
gh release download v0.8.0 --pattern artifact-attestation.json --dir .tmp/v080

# 内部整合（per-file 記録 vs aggregate digest）。byte は照合しない
node scripts/check-attestation-manifest-integrity.mjs --manifest=.tmp/v080/artifact-attestation.json

# tag との一致
git rev-parse 'v0.8.0^{commit}'

# release run が保持していた artifact
gh api repos/rebuildup/my-web-2026/actions/runs/41302500102/artifacts \
  --jq '.artifacts[] | "\(.name) \(.size_in_bytes)B"'
```

0.8.1 以降:

```bash
gh run download <run-id> -n cf-build-output-<sha> -D .tmp/release-bytes/<sha>
pnpm run artifact:attestation:check -- \
  --manifest=<published-manifest.json> \
  --artifact-dir=.tmp/release-bytes/<sha> \
  --release-tag="v<version>"
```

## 5. 残るリスク

1. **byte の保持は CI run に依存する。** 90 日を過ぎた run の artifact は
   消える。release 直後に照合する運用が前提であり、期限を過ぎたら
   「未実行」に戻る。
2. **Cloudflare が deploy した byte は依然として対象外**である。CI の
   Build Output と Workers Builds の artifact は別物であり、本記録は
   その差を埋めていない（owner 決定のまま）。
3. **upload step の修正は「次の run」から効く。** 既存 run の artifact は
   遡って増えない。0.8.0 の byte が取り戻せないのはこの理由である。
