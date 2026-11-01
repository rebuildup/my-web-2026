# Melty スプライトアトラスの権利レビュー — 記録案 (#274)

> Status: **Draft / owner 判断待ち（記録は未追加）**
> Visibility: public (MIT)
> Audience: owner, reviewer, future-self
> Issue: #274
> 契約: `src/legal/contract.ts`（Issue #497）
> gate: `pnpm run assets:license:check`

## 0. この文書の立ち位置

`quality/asset-license-inventory.json` には**まだ 1 件も追加していない**。
理由は単純で、記録は「このリポジトリが実際に配布しているバイト」を対象に作るものであり、
現時点でこのリポジトリは Melty のバイトを 1 つも配布していないためである。

この文書は、**配布判断が出たときに追加する記録の中身**と、
その記録から `src/legal/contract.ts` が何を導出するかを先に固定しておくためのものである。
先に固定するのは、実装者が「動くようにするために」記録を緩めるのを防ぐため。

## 1. 素材の出所（事実）

| 項目 | 値 |
| --- | --- |
| 名称 | `Melty` |
| stable pet ID | `pet_6ac5adc2388481919ad57cc91ead3f51` |
| 生成日時 | 2026-10-07T02:17:33Z（`pet_request.json#created_at`） |
| 生成手段 | ChatGPT / Codex デスクトップの `work-pets` プラグイン経由の OpenAI 画像生成（`pet_request.json#primary_generation_skill: "$imagegen"`） |
| 依頼者 | このリポジトリの owner（`rebuildup`） |
| 依頼文 | `pet_request.json#pet_notes` — 「yellow #FFD24D melted blob, low spreading base, black circular eyes, asymmetric white patch around viewer-right eye curving inward. Soft matte clay. No accessories.」 |
| 外部素材の取り込み | **なし**（`references: []`、`brand_sources: []`。既存画像を入力にしていない） |
| 実体 | 1536 × 2288 PNG、1,546,230 B、sha256 `78aa007c7d183e6087593463d77297bb0c707368f9c05cd871145281bbf63902` |

確認した事実の範囲では、**第三者の既存著作物を入力にしていない**。
これは「権利が clearing された」ことを意味しない。生成モデルの出力に
どのような条件が付くかは、このリポジトリがオフラインで読める情報ではない。

## 2. リポジトリが持っている証拠と、持っていない証拠

| 区分 | 内容 |
| --- | --- |
| 持っている | 生成の依頼文、生成日時、生成手段、生成されたバイトとその digest、検証レポート |
| 持っている | 依頼者が owner 本人であること（ローカルの `~/.codex/config.toml` の `selected-avatar-id` と `pet-record.json` が一致） |
| 持っていない | 提供者（OpenAI）の利用条件の本文。このリポジトリは取得しない（`validate:fast` はオフライン契約） |
| 持っていない | 「このバイトを MIT で再配布してよい」と owner が明示した記録 |

`src/legal/contract.ts` の語彙で言えば、`verification.method` は **`none`** が正直な値である。
`none` は失敗ではなく「未検証を未検証として記録する」ための第一級の値で、
この状態では判定が `hold` になる。

## 3. 記録案（JSON）

追加先: `quality/asset-license-inventory.json#assets`

```json
{
  "id": "pet-melty-sprites",
  "kind": "artwork",
  "title": "Melty — ペットのスプライトアトラス（Web 用ストリップ）",
  "summary": "owner の依頼文から OpenAI の画像生成で作られた 1536x2288 (v2) アトラスを、scripts/ で状態ごとの WebP ストリップへ変換したもの。第三者の既存素材は入力にしていない。",
  "covers": ["public/pets/melty/**"],
  "publicPaths": ["/pets/melty/idle-rest.webp", "/pets/melty/waving.webp"],
  "origin": "third-party-bundled",
  "rightsHolder": "rebuildup",
  "license": {
    "spdx": "NOASSERTION",
    "redistribution": "bundled",
    "attributionRequired": false,
    "attributionText": null,
    "attributionDeliveredAt": null,
    "conditions": [
      "生成モデル提供者の条件は、このリポジトリでは読まない（オフライン契約）。",
      "元アトラスの sha256 を docs/domain/pet-companion.md に記録し、変換はそのバイトからのみ行う。"
    ]
  },
  "verification": {
    "method": "none",
    "checkedOn": null,
    "note": "提供者条件も再配布許諾も、このリポジトリには記録されていない。"
  },
  "evidence": [
    { "kind": "repository-file", "path": "docs/domain/pet-companion.md" }
  ],
  "publication": "hold",
  "externalHosts": []
}
```

### 3.1 この記録から導出される判定

`evaluateAssetLicense` をこの記録に通すと:

| コード | 重大度 | 内容 |
| --- | --- | --- |
| `L017` | info | 検証方法が未検証。権利・出典・ライセンスの証拠がこのリポジトリにない |
| `L018` | info | 第三者を同梱しているのにライセンスが記録されていない（`NOASSERTION`） |

`hold` が立つので **decision = `hold`**。
`publication` も `hold` なので `L010`（保留なのに公開中と宣言）は出ない。
`covers` に一致するファイルが 0 件の状態で記録だけ追加すると `L009`（warn）が出るため、
**記録の追加とバイトの commit は同じ PR で行う**。

### 3.2 なぜ `repository-generated` ではないのか

`repository-generated` は「このリポジトリのスクリプトがそのファイルを導出した」という
証明可能な主張である（`src/legal/contract.ts` の語彙定義）。
Melty のバイトは OpenAI の生成モデルが作り、このリポジトリは**保存しただけ**である。
`repository-generated` と書けば gate は通りやすいが、それは記録の意味を壊す。
このリポジトリが導出したのは WebP ストリップ（`scripts/`）で、
その上流は `third-party-bundled` のままである。

### 3.3 なぜ `provider-terms` を使えないのか

`provider-terms` は「このリポジトリがコピーを配布せず、訪問者が提供者から取得する」場合の
状態である。Melty は**同梱して配布する**ので、この状態には当たらない。

## 4. owner の判断が必要な点

`hold` を `publishable` に変えるには、記録の中身を次のいずれかにする必要がある。
どちらも**法的判断**であり、agent が代行できない。

| 案 | 記録 | 導出 | 意味 |
| --- | --- | --- | --- |
| **A** | 上記のまま（`NOASSERTION` / `hold`） | `hold` | 公開しない。設計だけ残す。現状 |
| **B** | `spdx: "MIT"`、`verification.method: "repository-evidence"`、`checkedOn` を記録 | `publishable` | owner が「自分がこの出力の権利者であり、MIT で再配布してよい」と判断したことを、このリポジトリのファイルに記録する |
| **C** | 別の SPDX / 別の扱い | 場合による | 例: CC BY でクレジット表示、等 |

案 B を選ぶ場合でも、**OpenAI の条件をこのリポジトリが読んだことにはならない**。
`verification.note` にはその事実を残す（「owner の判断であり、提供者条件の本文は未取得」）。
審査者を装わないことがこの契約の目的である。

## 5. このレビューで見つかった gate の隙間（別 Issue 候補）

`scripts/check-asset-licenses.mjs` の監査対象は `AUDITED_ROOTS = ['public']` である。
Vite が `src/**` から取り込んで `/assets/` として配信するバイト
（例: `src/home/digits/*.webp`）は、この gate から見えない。

Melty を素直に実装すると `src/home/pet/assets/*.webp` を import する形になり、
**権利記録なしで公開される経路**が開く。本設計はそれを避けて `public/pets/melty/` を
指定しているが、規則ではなく**設計時の心がけ**でしかない。

この repo の規約（fail-closed、判断は記録に残す）から見ると、
`AUDITED_ROOTS` に配信対象の `src/**` アセットを含めるか、
「Vite が取り込む静的アセット」の別 audit を持つかは、owner 判断が必要な欠落として報告する。
（この文書では Issue を作らない。dashboard の起案は総合監督の権限。）

## 6. 参照

- 素材の実体・アトラス契約・統合設計: [`docs/domain/pet-companion.md`](../domain/pet-companion.md)
- 権利契約: `src/legal/contract.ts`
- 権利 gate: `scripts/check-asset-licenses.mjs`
- 記録: `quality/asset-license-inventory.json`
