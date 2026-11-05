# cf-build-output の upload が隠しファイルを落とす — 実測と修正（Issue #906）

- 日付: 2026-11-05
- 対象 run: push run `41953079799`
  （commit `75069da509b2c796006e3b87b471667106e03fa2`、`release-0-8-1`）
- 状態: **byte 照合の FAIL を実測**。修正と再発防止はこのブランチ（`906`）に含む。
- **修正後の run での PASS は本ファイルでは未記録である。** 照合の PASS は
  release step 9.1 の記録
  `docs/verification/supply-chain/attestation-byte-comparison-<date>.md`
  （この系列の先行記録は
  [`attestation-byte-comparison-2026-11-02.md`](attestation-byte-comparison-2026-11-02.md)）
  で release owner が示す。本ファイルは PASS を名乗らない。

## 1. 実測した事実

### 1.1 run と artifact

run `41953079799` は**緑**（conclusion `success`）で、次の artifact を保持している。

| artifact 名（head） | 保持 byte |
| --- | ---: |
| `artifact-attestation-75069da5…` | 27,606 B |
| `cf-build-output-75069da5…` | 18,420,827 B |
| `sbom-75069da5…` | 129,031 B |
| `dependency-advisory-report-75069da5…` | 2,080 B |

（artifact 一覧と byte は `gh api repos/rebuildup/my-web-2026/actions/runs/41953079799/artifacts`
で 2026-11-05 に実測。）

### 1.2 release step 9.1 の照合 — 2 件とも FAIL

release step 9.1 の byte 照合
（[`scripts/check-build-output-artifact.mjs`](../../../scripts/check-build-output-artifact.mjs)）
を run `41953079799` の pair に対して実行すると:

```text
FAIL  Artifact digest: artifact is b64242566a5cb4c75f017f0ff3137252744f8096d7b91e95a1732cf793b896ff,
                         manifest records 8aa400adffa029de72db9423fa883b46ff8a2c6530516aa9418ed02839f6546b
FAIL  Manifest file list: manifest carries 492 file record(s), artifact has 491
```

### 1.3 一覧の実 diff — 欠落は 1 件だけ

```text
MISSING_FROM_ARTIFACT: [ 'workers/default/bundle/.vite/manifest.json' ]
EXTRA_IN_ARTIFACT: []
```

### 1.4 本番 build output の隠しファイルはその 1 件のみ

本番 build output の隠しファイルは **`.vite/manifest.json` の 1 件だけ**である。
`find .cloudflare/output/v0 -name '.*'` の結果は
`workers/default/bundle/.vite/` の隠しディレクトリ 1 つだけで、
中身は `manifest.json` の 1 ファイルである
（`.vite/` 以外に隠しファイル・隠しディレクトリは無い）。

本 worktree でも 2026-11-05 に `pnpm run build:production` 後で再確認した:

```text
$ find .cloudflare/output/v0 -name '.*'
.cloudflare/output/v0/workers/default/bundle/.vite
$ ls .cloudflare/output/v0/workers/default/bundle/.vite/
manifest.json
$ find .cloudflare/output/v0 -type f | wc -l
492
```

ローカル build の 492 ファイルは manifest の 492 record と一致し、
CI artifact の 491 はそこに `.vite/manifest.json` の 1 件が欠けた数である。

## 2. 原因

- [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) の
  `Upload Cloudflare Build Output (attested bytes)` step が
  `actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02`（v4.6.2）を
  **`include-hidden-files` 指定なし**で呼んでいた。
- v4.4 以降の既定は `false`（v4.6.2 の `action.yml` も
  `include-hidden-files: … default: 'false'`）。実装は
  `@actions/glob@0.5.0` の `internal-globber.js` で、
  `excludeHiddenFiles` のとき basename が `.` で始まる item を除外する。
  だから `.vite` ディレクトリ自体が列挙から落ち、その下の
  `manifest.json` も拾われない。探索 root の `.cloudflare/` は
  pattern の literal 段なので影響せず、artifact は 491 ファイルで
  「成功」してしまう。
- 一方、attestation 側
  （[`scripts/check-artifact-attestation.mjs`](../../../scripts/check-artifact-attestation.mjs) が
  [`DEFAULT_ARTIFACT_DIR`](../../../scripts/_artifact-attestation.mjs)
  = `.cloudflare/output/v0` を hash）は**隠しファイル込み**で digest を作る。

したがって **attestation が「CI が保持しない byte」を記録していた**。
run 自体は緑でも、その pair では照合が成り立たなかった。

## 3. 修正

`Upload Cloudflare Build Output (attested bytes)` step の `with:` に
`include-hidden-files: true` を追加した（このブランチ）。

方向は **upload 側を attest に合わせる** である。attestation 側から
隠しファイルを除外して直すことはできない: `.cloudflare/output/v0/` の
deploy 対象 byte を attest する、という `coverage` の意味に反するため。
attest すべき集合と artifact が保持する集合を、同じ byte に一致させる。

## 4. 再発防止（オフライン test）

[`scripts/ci-upload-hidden-files.test.mjs`](../../../scripts/ci-upload-hidden-files.test.mjs)
を追加した（`node --test`、YAML 依存なし）。`yaml` package は
devDependencies に無く、既存の workflow reader
（[`scripts/check-workflow-pinning.mjs`](../../../scripts/check-workflow-pinning.mjs) の
permissions / trigger、
[`scripts/check-release-gate-coverage.mjs`](../../../scripts/check-release-gate-coverage.mjs) の
`run:` 一覧）は今回の upload step の `with:` を読むものでは無いので、
step block を regex で切って読む。

検査内容:

1. `cf-build-output-` を artifact name に持つ upload step が
   `.github/workflows/ci.yml` に**存在する**;
2. その step が `include-hidden-files: true` を持つ;
3. その step の `path:` が attestation の root
   （`DEFAULT_ARTIFACT_DIR` + `/` = `.cloudflare/output/v0/`）と一致する;
4. 反例で落ちること — `include-hidden-files` を落とした step 断片 / path が
   `dist-cloudflare/` にずれた step 断片 / step 自体が無い YAML の 3 件で、
   それぞれが問題として報告されることを確認している。

`pnpm run test` は `scripts/*.test.mjs` を convention で発見する
（[`scripts/run-script-tests.mjs`](../../../scripts/run-script-tests.mjs)）ので、
この test の追加に `package.json` の変更は不要。

## 5. 同じ upload ファミリの他の step — 実測して触らない

`ci.yml` 内の他の upload step に対象の隠しファイルが有るかを実測し、
無いものを `include-hidden-files` で触らなかった:

| step（artifact name） | 対象 | 判定 | 根拠（2026-11-05 実測） |
| --- | --- | --- | --- |
| `artifact-attestation-…` | `release-assets/supply-chain/<version>/artifact-attestation.json` | 隠しファイル無し | `find release-assets -name '.*'` → 0 件。`<version>` は semver 名（[`scripts/generate-sbom.mjs`](../../../scripts/generate-sbom.mjs)）。run でも 27,606 B 保持を確認 |
| `sbom-…` | `release-assets/supply-chain/<version>/sbom.cdx.json` | 隠しファイル無し | 同上。run でも 129,031 B 保持を確認 |
| `dependency-advisory-report-…` | `.tmp/dependency-audit-report.html` | 隠しファイル無し | literal path で basename は非隠し。run `41953079799` で artifact が 2,080 B で存在 = 実際に upload 済み |
| `japanese-copy-review-report-…` | `.tmp/japanese-copy-review-report.{json,txt}` | 隠しファイル無し | PR event 専用 step。PR run `41951981768` で artifact が 1,935 B で存在 = 同型の `.tmp` literal path が upload 済み |
| `playwright-report-…` | `playwright-report/` | 隠しファイル無し | ci.yml の `pnpm run e2e` は default config（reporter: `github` + `list`）でこの dir を書かない。HTML reporter（compat / viewport config）の出力をローカル生成して `find … -name '.*'` → 0 件（`index.html` のみ） |

## 6. 検証（実行した gate）

- `node --test scripts/ci-upload-hidden-files.test.mjs` → 5 pass / 0 fail
- `pnpm run ci:pins:check` → pass
- `pnpm run format:check` → pass
- `pnpm run lint:check` → pass
- `pnpm run architecture:check` → pass
- `pnpm run content:links:check` → pass
- `pnpm run typecheck` → pass

## 7. 残る項目とリスク

1. **修正後の push run での byte 照合 PASS は未記録**である。条件は
   「この修正を含む commit の push run が緑で、その
   `artifact-attestation-*` / `cf-build-output-*` pair を
   release step 9.1 で照合して PASS すること」であり、記録先は
   release owner が書く `attestation-byte-comparison-<date>.md`。
2. **既存 run の artifact は遡って増えない。** run `41953079799` の
   `cf-build-output` は 491 ファイルのままであり、この修正の効果は
   修正後の run からしか現れない。
3. **upload step の修正は「次の run」から効く**（前項と同じ理由）。
   現在の release-0-8-1 の byte は照合が成り立たないままである。
