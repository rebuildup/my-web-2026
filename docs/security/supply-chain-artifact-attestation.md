# デプロイ artifact の attestation (#476)

> 監査対象: release commit と GitHub Actions が production mode で build した Build Output の対応
> 実装: `scripts/_artifact-attestation.mjs` / `scripts/check-artifact-attestation.mjs`
> gate: `pnpm run artifact:attestation:check`（`validate:integration` の末尾）
> 証跡: [`../verification/supply-chain/artifact-sha-attestation.webp`](../verification/supply-chain/artifact-sha-attestation.webp)

## 1. 何を保証するか

1 つの manifest が、CI が production mode で build した deploy artifact
（GitHub Actions の Build Output）の **byte**・**source commit**・
**依存解決**を同じ時点の事実として記録する。画像ではなく、次の
不変条件を gate が検査する。

| 事実 | 記録 | 検査 |
| --- | --- | --- |
| artifact の byte | 全 file の sha-256 と canonical aggregate digest | 再計算した digest と一致するか |
| artifact の形 | file 数 / 合計 byte 数 | 記録と一致するか。空 artifact は FAIL |
| source | 生成時は `git rev-parse HEAD`。検証時は `--source-sha` / `WORKERS_CI_COMMIT_SHA` / HEAD の順で期待 commit を決める。branch、tree 状態も記録する | 期待 commit と一致するか。生成時の `--source-sha` は拒否する。dirty tree は FAIL |
| release tag | `--release-tag=v<version>`（検証時のみ）。tag が解決する commit と、tag 名が宣言する version | manifest の `source.commit` と tag の commit、manifest の `project.version` と tag の version がそれぞれ一致するか。tag が解決できない / `v<version>` 形式でない場合は exit 2 |
| release version | `package.json#version` | 記録と一致するか |
| 依存範囲 | `package.json` の dependencies / devDependencies / optionalDependencies | 記録と一致するか |
| 依存解決 | `pnpm-lock.yaml` の sha-256 と解決 package 数 | 記録と一致するか |
| toolchain | `package.json#packageManager` | 記録と一致するか |
| Worker | canonical な `my-web-2026` | 記録と一致するか |
| Cloudflare identity | build UUID / deploy id（取得できた場合のみ） | 型だけ検査。値の真正性は検証しない |
| 署名 | **unsigned** であること | 存在しない署名を表示しない |

manifest は timestamp を持たない。同じ artifact bytes・commit・依存入力
からは常に同じ文書が生成されるので、「release の manifest と手元の
artifact を比べる」が build の揺らぎの diff にならない。

## 2. 何を保証しないか

- **署名ではない。** この repository に signing key は無い。manifest は
  `signature.status = "unsigned"`、`algorithm` / `key_id` / `value` は
  すべて `null` と明記する。署名を名乗る文書は
  `SIGNATURE_UNSUPPORTED` で FAIL する。
- **deploy id の真正性は検証しない。** `--deploy-id` で渡された値を
  そのまま記録するだけであり、Cloudflare API は呼ばない。値を取得
  できないときは `null` のままにする（推測値を作らない）。
- **Cloudflare が deploy した artifact の byte は照合しない。** CI manifest は
  GitHub Actions の `validate` job が production mode で build した
  `.cloudflare/output/v0` を記述する。Cloudflare Workers Builds が
  別に build / deploy する artifact の byte を hash し、その digest を
  manifest と比べる経路は未配線である（§8-3）。一方、「公開 release が
  tag で名指しする commit が manifest の source commit である」ことは
  `--release-tag` で fail-closed に検査できる（§4）。GitHub Release への
  添付は human-gated な release 操作であり、この tool は publish しない。
- **secret を読まない。** Infisical / Worker secret / `.dev.vars` /
  Cloudflare token のいずれにも触れない。入力は build output と
  tracked file（`package.json` / `pnpm-lock.yaml`）だけである。

## 3. manifest schema

`my-web-2026/artifact-attestation/v1`。

```json
{
  "schema": "my-web-2026/artifact-attestation/v1",
  "project": { "name": "my-web-2026", "version": "<package.json#version>" },
  "source": {
    "repository": "https://github.com/rebuildup/my-web-2026",
    "commit": "<40-char git sha>",
    "branch": "<branch or null>",
    "tree": "clean"
  },
  "dependencies": {
    "package_manager": "pnpm@<version>",
    "lockfile": {
      "path": "pnpm-lock.yaml",
      "sha256": "<lockfile digest>",
      "packages": 0
    },
    "declared": {
      "dependencies": {},
      "devDependencies": {},
      "optionalDependencies": {}
    }
  },
  "subject": {
    "kind": "cloudflare-build-output",
    "root": ".cloudflare/output/v0",
    "digest": { "algorithm": "sha-256", "value": "<aggregate digest>" },
    "file_count": 0,
    "total_bytes": 0,
    "files": [{ "path": "...", "kind": "file", "bytes": 0, "sha256": "..." }]
  },
  "cloudflare": {
    "provider": "cloudflare-workers-builds",
    "worker": "my-web-2026",
    "build_uuid": null,
    "deploy_id": null
  },
  "signature": {
    "status": "unsigned",
    "algorithm": null,
    "key_id": null,
    "value": null
  }
}
```

`subject.files` は path 順に並び、aggregate digest は
`kind \t path \t bytes \t sha256` の行を改行で連結した文字列の
sha-256 である。Build Output に symlink が現れた場合は FAIL し、
target 文字列だけを記録して link 先の byte を未 hash のまま残さない。
検証側も `kind` は `"file"` だけを受け付ける（生成器が出さない
entry 形を manifest が主張しないため、`"symlink"` を含む entry は
`MANIFEST_FILES_INVALID` になる）。

## 4. コマンド

```bash
# CI / release branch: Build Output から生成し、同じ artifact に対して検証する
pnpm run artifact:attestation:check

# 公開済み manifest を手元の artifact と照合する
pnpm run artifact:attestation:check -- \
  --manifest=release-assets/supply-chain/<version>/artifact-attestation.json

# release tag の commit と照合する（tag は release owner の操作で作られる）
pnpm run artifact:attestation:check -- \
  --manifest=release-assets/supply-chain/<version>/artifact-attestation.json \
  --release-tag="v$(node -p "require('./package.json').version")"

# 検証画像を再生成する（documentation tool。validate:* では走らない）
pnpm run artifact:attestation:report
```

| option | 意味 |
| --- | --- |
| `--artifact-dir=<dir>` | hash する artifact（既定 `.cloudflare/output/v0`） |
| `--manifest=<path>` | 生成せず既存 manifest を検証する |
| `--out=<path>` | 生成物の出力先（既定 `release-assets/supply-chain/<version>/artifact-attestation.json`） |
| `--source-sha=<sha>` | `--manifest` 検証時の期待 source commit。未指定時は `WORKERS_CI_COMMIT_SHA`、次に `git rev-parse HEAD`。生成時は checked-out HEAD のみを使い、この option を指定すると exit 2 |
| `--release-tag=<name>` | `--manifest` 検証時に release tag を名指しする。tag が解決する commit が manifest の `source.commit`、tag 名の version が manifest の `project.version` と一致することを要求する。tag が無い / `v<version>` 形式でない / `--source-sha` と矛盾する場合は exit 2。生成時は exit 2 |
| `--branch=<name>` | manifest に記録する branch |
| `--build-uuid=<id>` | 取得済みの Cloudflare Workers Builds UUID |
| `--deploy-id=<id>` | 取得済みの Cloudflare deploy id。無い場合は指定しない |
| `--allow-dirty` | dirty tree からの**ローカル観測専用**。CI では使わない |

exit code: `0` = PASS、`1` = mismatch / finding、`2` = 入力不正。
出力は status-only で、artifact の内容や secret 値は表示しない。

## 5. 正常 / 異常の観測

`pnpm run artifact:attestation:report` は同じ関数から次の 2 状態を
描画する。画像は証跡の一部であり、証明ではない。挙動は
`scripts/check-artifact-attestation.test.mjs` が assertion する。

### 正常

- fixture Build Output の digest、fixture source commit、lockfile digest、
  project version が一致する。
- `signature: unsigned (no signature claimed)`。
- `deploy id: not provided (no id invented)`。

### 異常

| scenario | mutation | finding |
| --- | --- | --- |
| tampered artifact | `workers/default/bundle/worker.js` に 1 byte 追加 | `ARTIFACT_DIGEST_MISMATCH` |
| wrong source | 期待 commit を別 SHA にする | `SOURCE_COMMIT_MISMATCH` |
| release tag drift | release tag が manifest の `source.commit` 以外の commit を指す | `RELEASE_TAG_COMMIT_MISMATCH` |
| release tag version drift | tag 名が manifest の `project.version` 以外の version を宣言する | `RELEASE_TAG_VERSION_MISMATCH` |
| lockfile drift | manifest 生成後に `pnpm-lock.yaml` を変更 | `LOCKFILE_DIGEST_MISMATCH` |
| fabricated signature | `status: "unsigned"` のまま signature field を埋める | `SIGNATURE_INCONSISTENT` |

## 6. 修復手順

| finding | 意味 | 修復 |
| --- | --- | --- |
| `ARTIFACT_DIGEST_MISMATCH` / `ARTIFACT_SHAPE_MISMATCH` | 手元の byte が記録した build と違う | 記録された commit から rebuild する。drift した artifact を deploy / publish しない |
| `ARTIFACT_EMPTY` | hash 対象が空 | Build Output を生成してから再実行する |
| `SOURCE_COMMIT_MISMATCH` | release / workflow の commit と artifact の source が違う | release を止め、記録された commit を checkout して rebuild する |
| `RELEASE_TAG_COMMIT_MISMATCH` | 公開する release tag が manifest の source commit を指していない | manifest を release に添付しない。tag が指す commit で checkout して rebuild し、manifest を再生成する |
| `RELEASE_TAG_VERSION_MISMATCH` | tag 名が別の release version を宣言している | 正しい release の tag を使う。別 version の manifest を添付しない |
| `SOURCE_TREE_DIRTY` / `WORKTREE_DIRTY` | dirty tree は commit を記述しない | commit / stash して rebuild し、manifest を再生成する |
| `LOCKFILE_DIGEST_MISMATCH` / `LOCKFILE_INVENTORY_MISMATCH` | 依存解決が記録と違う | lockfile を戻すか、再生成して差分を review する |
| `DECLARED_DEPENDENCIES_MISMATCH` | `package.json` の範囲が記録と違う | release commit から再生成する |
| `PACKAGE_MANAGER_MISMATCH` | toolchain が記録と違う | 同じ package manager で rebuild する |
| `PROJECT_VERSION_MISMATCH` / `PROJECT_IDENTITY_MISMATCH` | 別 release の manifest | release commit で再生成する |
| `WORKER_IDENTITY_MISMATCH` | 別 Worker の manifest | この repository で再生成する |
| `SIGNATURE_UNSUPPORTED` / `SIGNATURE_INCONSISTENT` | この repo が検証できない署名を名乗っている | 署名 field を消して unsigned にする。本物の署名 authority を追加するまで署名を表示しない |
| `SCHEMA_UNSUPPORTED` | 未知の schema | 現行 tool で再生成する |
| `DIGEST_ALGORITHM_UNSUPPORTED` | sha-256 以外の digest | 現行 tool で再生成する |
| `MANIFEST_FILES_INVALID` / `MANIFEST_FILE_DIGEST_MISMATCH` | per-file 記録が aggregate と一致しない（手編集を含む） | 手で編集せず再生成する |
| `CLOUDFLARE_IDENTITY_INVALID` | id が空文字など | 実際に取得した id だけを記録し、無ければ `null` にする |
| `MANIFEST_UNREADABLE` | JSON として読めない | 再生成する |

## 7. CI / release integration

- `validate:integration` の最後（最終 `build:cf:production` の後）に
  `pnpm run artifact:attestation:check` を置く。CI の `validate` job は
  この中で manifest を生成し、GitHub Actions が build した
  `.cloudflare/output/v0` に対して直ちに検証する。Cloudflare Workers
  Builds の production artifact はこの gate の対象外である（§8-3）。
- workflow は `artifact-attestation-<sha>` として 90 日保持する
  （`.github/workflows/ci.yml`）。
- release では GitHub Release への添付を release owner の判断で行う。
  添付の前に `docs/release.md` step 9 / §8 の手順どおり
  `--release-tag="v<version>"` で manifest を tag と照合する。CI
  (`ci.yml`) は tag push を trigger しないので、この照合は
  release owner が tag を fetch した checkout で実行する。tag push を
  CI trigger にして gate を自動化するか（含意する runner 時間の
  増分）は owner 判断として未決のまま扱う。
  `AGENTS.md §6` の release PR merge human gate は変更しない。
- CI の pull_request run は `actions/checkout` の merge commit を
  build するため、manifest の `source.commit` もその merge commit に
  なる。release branch への push では release commit そのものになる。
- secret SoT（Infisical）・Cloudflare Workers Builds の deploy 権限・
  release 承認のいずれも変更しない。

## 8. 既知の制約と未決事項

1. **署名は無い。** signing key / attestation service の導入は owner
   判断であり、この Issue では実装しない。導入するまで manifest は
   `unsigned` を明示する。
2. **deploy id の取得は呼び出し側の責任。** Workers Builds の deploy
   id は deploy 後にしか確定しない。`--deploy-id` で渡された値は
   status record であり、Cloudflare API で照合しない。`WORKERS_CI_BUILD_UUID`
   が環境にある場合は build UUID として記録する。
3. **Cloudflare が実際に deploy した byte は照合しない（open decision）。**
   現在の CI 生成は GitHub Actions の Build Output を対象とする。
   release tag との照合（tag の commit と tag 名が宣言する version が
   manifest の `source.commit` / `project.version` と一致すること）は
   `--release-tag` として実装済みで fail-closed だが、Cloudflare Workers
   Builds が build / deploy した artifact の digest 自体を照合する経路は
   無い。Cloudflare の production build が GitHub Actions の build と
   異なる場合（toolchain / cache / build input の drift）、CI gate は
   PASS のまま deploy 済み byte は未 attestation のまま残る。この半分の
   実装（build/deploy phase での manifest 生成、または deployed
   artifact の hash と release tag の自動照合）は deploy 経路の変更を
   要するため owner 判断とし、この Issue では実装しない。
4. **GitHub Release への添付は自動化しない。** release PR merge / tag /
   Release publish と同じ human gate の下に置く。
