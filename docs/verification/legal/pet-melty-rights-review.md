# Melty の権利記録 — owner attestation (#274)

> Status: **recorded（owner attestation, 2026-11-01）**
> Visibility: public (MIT)
> Audience: owner, reviewer, future-self
> Issue: #274
> 契約: `src/legal/contract.ts`（Issue #497）
> 記録: `quality/asset-license-inventory.json#assets[pet-melty-sprites]`
> gate: `pnpm run assets:license:check`

## 0. この文書の役割

この文書は、`quality/asset-license-inventory.json` の `pet-melty-sprites`
レコードが**何を根拠にしているか**を固定するために存在する。レコードは
「owner がそう申告した」という事実を記録するものであって、agent が
権利を判定した結果ではない。

2026-11-01 の owner 指示を受けて、以前の「Draft / hold」版
（`third-party-bundled` + `NOASSERTION` + `method: none` → `hold`）を
置き換えた。何が変わったのか、何が変わっていないのかを §4 と §5 に分けて
書いてある。

## 1. owner attestation（申告の内容と出典）

| 項目 | 値 |
| --- | --- |
| 申告日 | 2026-11-01 |
| 伝達経路 | 総合監督 → 実装担当（`.tmp/supervisor/pet/OWNER-2026-11-01.md`） |
| 申告の内容 | 「Melty は owner のオリジナルキャラクターで、owner のアイコンでもある」 |
| 申告された権利状態 | owner がオリジナルとして作成・所有している |
| 公開可否 | 公開可 |
| 表示場所 | Home と `/about` |
| 併記された制約 | agent は licence や第三者許諾を捏造しない。未確認の項目は未確認のまま残す |

**この文書が記録するのはこの申告そのものである。**
「owner がこのバイトの権利者である」という主張の出所は owner であり、
agent の分析ではない。第三者がこの申告を検証した記録は無い（§5）。

`.tmp/` は gitignore された作業領域なので、恒久的な出典はこの文書と
`docs/domain/pet-companion.md` の 2 ファイルである。この文書の sha256 は
レコードの `evidence[].sha256` に固定してあり、内容が変われば gate が
`L005`（レビュー後に変更された）で落ちる — 申告の記録を作り直すときは
必ずレコードのダイジェストも更新する。

## 2. バイトの実体（検証済みの事実）

元アトラス（リポジトリ外。`~/Documents/Codex/2026-10-07/pets-plugin-work-pets-openai-curated/`）:

| 項目 | 値 |
| --- | --- |
| ファイル | `final/spritesheet-extended.png`（v2） |
| 寸法 | 1536 × 2288（8 列 × 11 行、セル 192 × 208） |
| バイト数 | 1,546,230 |
| sha256 | `78aa007c7d183e6087593463d77297bb0c707368f9c05cd871145281bbf63902` |
| 検証記録 | `final/validation-extended.json` = `ok: true`, errors 0, warnings 0 |

リポジトリに置いた配信物（`scripts/build-pet-sprites.mjs` が上記アトラスから生成）:

| ファイル | 寸法 | バイト | sha256 |
| --- | --- | ---: | --- |
| `public/pets/melty/idle-rest.webp` | 192 × 208（1 フレーム） | 4,568 | `c23a6880f255fe2bdf2c271e96f3e2b064e1dd4460fbdeb24582b7397efc956f` |
| `public/pets/melty/waving.webp` | 768 × 208（4 フレーム） | 15,644 | `3b345de39791bebc15e499f012da3d77c7b978946496a1ec68e44f35bdd401df` |

アトラスそのものは**リポジトリに入れていない**。2 フレームのために
1.5 MB を git 履歴と公開ツリーに置く代償が大きいため、代わりに
sha256 で固定し、生成スクリプトが**その digest と一致しないアトラスを拒否する**。
再生成の再現性は「記録された digest と一致すること」で担保する。

## 3. 記録（`quality/asset-license-inventory.json` に追加した内容）

```json
{
  "id": "pet-melty-sprites",
  "kind": "artwork",
  "title": "Melty — 相棒キャラクターのスプライト（Web 配信用ストリップ）",
  "summary": "owner のオリジナルキャラクター Melty。元アトラスは owner の依頼文から画像生成モデルが描画した 1536x2288 の 1 点物で、scripts/build-pet-sprites.mjs がそのバイトから 2 ファイルを導出する。",
  "covers": ["public/pets/melty/**"],
  "publicPaths": ["/pets/melty/idle-rest.webp", "/pets/melty/waving.webp"],
  "origin": "repository-authored",
  "rightsHolder": "rebuildup",
  "license": {
    "spdx": "NOASSERTION",
    "redistribution": "bundled",
    "attributionRequired": false,
    "attributionText": null,
    "attributionDeliveredAt": null,
    "conditions": [
      "owner は 2026-11-01 に、Melty を自身のオリジナルキャラクターとして作成・所有していると申告した（owner attestation）。",
      "資産単位のライセンス識別子は主張しない（NOASSERTION）。リポジトリ全体の LICENSE が適用される範囲はその文書の記述に従う。",
      "生成モデル提供者の条件の本文はこのリポジトリでは取得していない（validate:fast はオフライン契約）。"
    ]
  },
  "verification": {
    "method": "repository-evidence",
    "checkedOn": "2026-11-01",
    "note": "根拠はこの文書の §1 owner attestation。提供者条件の本文は未取得のままで、確認したことにはしない。"
  },
  "evidence": [
    { "kind": "repository-file", "path": "docs/verification/legal/pet-melty-rights-review.md", "sha256": "…" },
    { "kind": "repository-file", "path": "docs/domain/pet-companion.md" },
    { "kind": "repository-file", "path": "scripts/build-pet-sprites.mjs" }
  ],
  "publication": "published",
  "externalHosts": []
}
```

### 3.1 この記録から導出される判定

`evaluateAssetLicense` は **findings 0 件 / decision `publishable`** を返す。

| 検査 | 結果 | 理由 |
| --- | --- | --- |
| `L003`（未知の SPDX） | 出ない | `NOASSERTION` は許可された値 |
| `L004` / `L005`（根拠ファイル不在・ダイジェスト不一致） | 出ない | 3 ファイルとも存在し、固定した sha256 と一致 |
| `L006`（根拠ゼロ） | 出ない | 根拠 3 件 |
| `L017`（未検証） | 出ない | `method` が `none` ではない |
| `L018`（第三者を同梱 + NOASSERTION） | 出ない | **`origin` が repository 系のため対象外** |
| `L010`（保留なのに公開中） | 出ない | decision が `hold` ではない |

**`L018` が出ないのは判定の要**である。§4 の origin 判断が変われば
`L018` が復活して `hold` になる。

## 4. 変わった点：`third-party-bundled` → `repository-authored`

以前の案は、バイトが生成モデル由来であることを根拠に
`third-party-bundled` としていた。owner の申告（§1）はこれと両立しない。
Melty は owner のオリジナルであり、owner のアイコンでもあると明言されている。
第三者の素材を同梱している、という記述は**事実に反する**ので採らない。

一方で、生成手段を隠すこともしない。`summary` に「owner の依頼文から
画像生成モデルが描画した」と明記してある。`repository-authored` は
「このリポジトリの主体が著作者である」という主張であり、その主張の
出所が owner の申告であることは §1 に書いてある。

## 5. 未確認のまま残した項目

| 項目 | 状態 | 扱い |
| --- | --- | --- |
| 生成モデル提供者の利用条件の本文 | **未取得** | 取得しない（オフライン契約）。取得したことにしない |
| 資産単位の SPDX 識別子 | **未主張** | `NOASSERTION` のまま。owner が決めれば書き換える |
| 「owner が権利者である」ことの第三者確認 | **無い** | owner attestation のみ。審査者を装わない |
| アトラスの将来の再生成 | **不確定** | 生成は非決定的。digest 固定で代替する |

これらは `hold` の理由ではない。`hold` を解いたのは owner の公開判断
（§1）であって、未確認項目が確認済みになったからではない。

## 6. gate の隙間（Issue #780 として起票）

`scripts/check-asset-licenses.mjs` の監査対象は `AUDITED_ROOTS = ['public']` である。
Vite が `src/**` から取り込んで `/assets/<hash>` として配信するバイト
（例: `src/home/digits/*.webp`）はこの gate から見えない。

Melty は `src/home/pet/assets/*.webp` を import する素直な実装を避け、
`public/pets/melty/**` に置くことで既存の監査対象に入れている。
ただしこれは**規則ではなく設計判断**なので、総合監督の判断により
欠落そのものを Issue #780（target 0.9.0, 種別 audit）として起票した。
0.8.1 のスコープは広げない。

## 7. 参照

- 素材の実体・アトラス契約・統合設計: [`docs/domain/pet-companion.md`](../../domain/pet-companion.md)
- 権利契約: `src/legal/contract.ts`
- 記録: [`quality/asset-license-inventory.json`](../../../quality/asset-license-inventory.json)
- 生成: `scripts/build-pet-sprites.mjs`
- 監査範囲の欠落: Issue #780
