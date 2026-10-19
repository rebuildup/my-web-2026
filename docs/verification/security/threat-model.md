# Per-capability threat model ledger (Issue #479)

**判定基準**: 脅威モデルの主張は、すべて repository に実在するものを指していなければならない。
資産は「実在する path か binding の名前」を source として持ち、node は 자신이 주장する file を名指しし、
control と mitigation は「存在する file」または「release が実行する `pnpm run` command」でなければならない。
値（credential / binding 値 / 本番 secret）はこの台帳に現れない。

- manifest: [`quality/threat-model.json`](../../../quality/threat-model.json)（schema v1）
- gate: `pnpm run threat:model:check`（`validate:fast` に結線されるので `validate:release` にも載る）
- report: `pnpm run threat:model:report` → `.tmp/threat-model-report.html`
- screenshot: `pnpm run verify:threat-model-screenshot` → [`threat-model-diagram.webp`](threat-model-diagram.webp)
- fixtures: `quality/fixtures/threat-model/{pass,missing-evidence,unowned-threat,secret-literal}.json`
- tests: `node --test scripts/check-threat-model.test.mjs`
- profile: [`quality/profile.yaml`](../../../quality/profile.yaml) の `threat_model_coverage` block

## なぜこの gate が必要か

`docs/security/*.md` は「control を 1 枚ずつ説明する」。しかし review の質問
「**この control はどの資産を守り、どの境界の上に載っているのか**」に答べるものは
repository に存在しなかった。control は増えても資産も境界も更新されず、図だけが 3 Issue 前の
platform を描き続ける、という drift が静かに起きる。

Issue #479 は同時に「STRIDE を使っても前提のない攻撃面は架空で埋めるな」と規定している。
そのため本台帳は prose を許さない:

- 資産の `source_of_truth` は「存在する path」か「`SCREAMING_SNAKE` の binding 名」だけ
- node の `source` は disk に存在する path だけ
- control / mitigation の `ref` は disk に存在する path か、release が実行する command だけ

これにより「攻撃面の図」は、repository に無い場所を描くことが **gate error** になる。
脅威モデルとして書けるのは、書ける実在のものだけ、という意味である。

## 2 状態

| 状態 | 意味 | gate を止めるか |
| --- | --- | --- |
| `covered` | `implemented` な mitigation が 1 つ以上あり、mitigation の `ref` が全て実在する | — |
| `uncovered` | mitigation が全て `planned`。残る作業は threat の `follow_up` 文として書かれなければならない | `live` capability では**止める**。`planned` / `deferred` では報告のみ |

`uncovered` を `covered` と同じ bucket に入れないことがこの gate の存在理由である。
「検査を実行しなかった」を「検証済み」と読ませないという、同ディレクトリ `release-gate-coverage.md`
と同じ方針を、threat の側で実行する。

## diagram の読み方

report は `manifest.diagram_capability`（Issue #479 の「独立した 1 機能」に相当する
`external-http-boundary`）について、SVG の trust boundary 図を描く。

- **列** = trust zone（`untrusted` → `boundary` → `trusted`）。zone は manifest の宣言で、
  renderer が推測・生成することはない。
- **箱** = node。`source` を持つ node は、その file が disk に存在することを gate が保証している。
- **矢印** = 宣言された trust boundary。1 本の境界は少なくとも 1 端が `boundary` zone の
  node を持ち、そうでなければ `fail`（flow であり trust boundary ではない）。
- **矢印のラベル** = boundary id と、その境界にある control の file 名。

座標は manifest から機械的に決めたグリッドであり、手で置いた位置はない。
同じ manifest からは常に同じ図が出る。

## silent pass を防ぐ構造

1. mitigation / control が disk に無い file を ref にしていれば **error**（`missing-evidence` fixture）。
2. node が実在しない file を `source` として主張すれば **error**。
3. 資産の `source_of_truth` が「実在 path でも `SCREAMING_SNAKE` 名でもない」なら **error**。
   値の printing はない — エラーは rule を名指しする。
4. `live` capability は `uncovered` な threat を持てない。持てば **error**。
5. `planned` な mitigation には threat の `follow_up` 文が要る。無ければ **error**。
6. review item は `?` で終わる問いでなければならない。文で終われば **error**。
7. `control_registry` の claimant 集合は、その gate を引用している capability 集合と
   **双方向に**一致すること。 片方だけの変更は **error**。
8. `protected_capabilities` の行を削除する / `planned`・`deferred` へ落とす → **error**。
   guard を空にすると fail closed。
9. manifest の全文字列を `scripts/_secret-scan.mjs#looksLikeCredentialValue` と
   `NAME = value` 形で走査し、credential 形は **error**。error には JSON pointer しか出さず、
   拒否した値そのものは **絶対に出さない**。
10. manifest object の未知 key は **error**。asset が `value` field を生やす経路を構造的に塞ぐ。
11. release surface が実行する security-family command で、threat が引用していないものは
    `unaccounted` として **warning** に載る（release-gate ledger と同じ扱い）。

## fixture（report の false-green probe）

| fixture | 判定 | 何を示すか |
| --- | --- | --- |
| `pass.json` | PASS | 完全な 1 機能。source / node / mitigation / gate がすべて実在する |
| `missing-evidence.json` | FAIL | mitigation と control が「存在しない file」を ref にした |
| `unowned-threat.json` | FAIL | `live` capability の threat が `planned` だけ、`follow_up` なし |
| `secret-literal.json` | FAIL | 資産の source に credential 形の値を書いた。gate は拒否し、値は出力しない |

画像は evidence であって test の代用ではない。判定は
`node --test scripts/check-threat-model.test.mjs` が同じ fixture で担保する。

## 再現手順

```bash
pnpm run threat:model:check             # 判定 (exit 0 / 1)
pnpm run threat:model:report            # .tmp/threat-model-report.html
pnpm run verify:threat-model-screenshot # docs/verification/security/threat-model-diagram.webp
```

generator は Node のブラウザ・network・Worker・binding・secret を一切触らない
（HTML は text scan のみ）。chromium は E2E suite が既にインストールしているものを使い、
PNG 交所は disk に書かない（Buffer 内で `sharp` が WebP に再エンコードする）。
target が `.webp` 以外なら write を拒否し、300 KB を超える artefact は error。

## 対象外（N/A）と将来の手作業

- **STRIDE の網羅を主張しない。** 6 category を語彙として固定するが、各 capability が
  6 個すべてを持つことを要求しない。「無い threat」を埋めるのはこの gate の目的と
  逆方向であり、Issue #479 の「架空の攻撃面を埋めない」に従う。
- **mitigation が十分かどうかは判定しない。** 各 control script と reviewer の権限。
- **存在するが無効化された control**（コメントアウトされた gate、fixture だけの test）は
  静的な text scan では判定できない。review item として扱う。
- **zone と node label は宣言である。** 図は宣言された zone に node を置くだけで、
  新しい zone を生成しない。
- **対象 capability へのレビュー項目**（open）: `outbound-read` は `deferred` のまま
  route に mount されていない。mount するかどうかの判断は owner decision であり、
  この台帳は判断の代わりに「planned な work が `follow_up` として書かれている」ことだけを強制する。
