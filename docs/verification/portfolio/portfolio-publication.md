# 旧サイト移植作品 60 件の公開 — 検証記録（Issue #811）

> local 環境で実測した値だけを書いた記録である。**production の D1 / R2 /
> Notion への書き込みは 1 件も行っていない**（§7）。
> **本番への適用は 2026-11-05 に別途実施された。** 適用後の実測は
> [`production-publication-2026-11-05.md`](production-publication-2026-11-05.md)
> にある（本書は local 検証の記録であり、本番適用の記録ではない）。
> 決定の根拠: [`docs/domain/portfolio-migration-decisions.md`](../../domain/portfolio-migration-decisions.md)
> 本番手順: [`docs/runbook/portfolio-publication.md`](../../runbook/portfolio-publication.md)
> 検証画像: `portfolio-publication-811.webp`（詳細ページ）/
> `portfolio-publication-list-811.webp`（一覧）

## 1. 151 件の分解（実測）

`docs/migration/portfolio-2025-to-2026-classification.json`（旧 151 DB の
機械分類）と、移行台帳
`docs/migration/portfolio-2025-to-2026-publication.json`（151 行の全状態）の
実測値:

| 区分 | 件数 | 内訳 |
| --- | --- | --- |
| **公開（作品）** | **60** | `eligible` 48 + `rewrite_required` 12 |
| 作品でない（not-a-work） | 91 | メディア足場行 80 / テスト用フィクスチャ 9 / プレースホルダ 2 |
| 旧 151 件の合計 | **151** | |
| 移行後に追加する候補（対象外） | 8 | `new_candidate`（旧 151 件に含まれない） |

内訳の根拠（機械的）:

- 足場行 80 件: legacy id が `media-list-*` / `media-rt-*` で始まる
  （`scripts/classify-portfolio-from-2025.mjs` の `isMediaScaffold`）。
- テスト用 9 件: legacy id が `test-*` で始まる。
- プレースホルダ 2 件: `draft` かつリンク 0 件・本文 0 件（`mawaru-pv` /
  `procon-pv`）。

> **監督メモとの差分（訂正）**: 監督メモは「91 件が `media-list-*` の足場行」
> と書いていた。実測は足場行 **80 件**で、残り 11 件は `test-*` 9 件と
> プレースホルダ 2 件である。合計 91 は変わらないが、内訳は実測値を採用した。

## 2. slug 衝突の解消（実測）

D1 が既に同 slug を持っていた行は、**削除せず retire** した
（`status='archived'`, `visibility='draft'`, slug は `<slug>-retired` へ退避）。
旧サイトの slug が正である（ADR-0019 §2.6 / owner 決定）。

| 実測項目 | 値 |
| --- | --- |
| local D1 を作り直した後の衝突 fixture（本番が持っていた 3 slug の再現） | 3 行 |
| 移行後に retire された行 | 3 行（`aulymo-v01-retired` / `aulymo-v02-retired` / `multislicer-retired`） |
| 移行を**再実行**した後の衝突 | 0（conflict 判定なし。retire 済みの行は migration 自身の行として扱う） |
| 公開行の slug | 60 件すべて旧サイトの slug（`legacy_*` の id 規則） |
| 移行前の local D1 | 0 行（migration 0001–0010 だけを作り直した状態） |

local D1 は `scripts/d1.mjs apply --target=local` で 0001–0010 を適用して
作り直した。`portfolio_project` は 63 行 = 公開 60 + retire 3。

## 3. 公開面（local preview の実測）

### 3.1 再現可能な手順（何を、どの状態で動かしたか）

| 項目 | 値 |
| --- | --- |
| D1 の persist 先 | `.tmp/d1state`（`scripts/_cloudflare-identity.mjs#LOCAL_STATE_DIR`。preview の `persistState` と同じ場所） |
| migration | `node scripts/d1.mjs apply --target=local`（0001–0010 を適用） |
| テキスト移行 | `MY_WEB_2025_REF=<旧 corpus> node scripts/migrate-portfolio-from-2025.mjs --apply --target=local --ledger=docs/migration/portfolio-2025-to-2026-publication.json` |
| メディア移行 | `node scripts/migrate-legacy-media.mjs --apply --target=local`（Issue #850 の script。base 26476862 で入庫済み） |
| build | `pnpm run build` → `node scripts/sync-cf-build-output.mjs` |
| preview | `./node_modules/.bin/vite preview --port 4188 --host 127.0.0.1`（built 出力。`.tmp/d1state` を読む） |
| 旧 corpus の場所 | `.reference/my-web-2025`（無ければ `MY_WEB_2025_REF` で指定） |

### 3.2 DOM から数えた件数（推測ではない）

`/portfolio` を Chromium で開き、DOM を数えた値:

| 実測項目（DOM） | 値 |
| --- | --- |
| `document.querySelectorAll('#portfolio-list li').length` | **60** |
| `document.querySelectorAll('#portfolio-list article').length` | **60** |
| `document.querySelectorAll('#portfolio-list a[href^="/portfolio/"]').length` | **60** |
| 異なる href の数 | **60** |
| 高さが 0 でない card の数（= 実際に描画されている） | **60** |
| 先頭の 3 件のタイトル | 「アイコン 手書きアニメーション」「SNSアイコン」「Aeプラグイン FoldLayers」 |

SSR（`domcontentloaded` 直後）と hydration 後（`networkidle` 直後）で
同じ 60 だった。**数え方は上のとおりで、「写っている枚数」ではなく DOM の
要素数**である。

### 3.3 その他の実測

| 実測項目 | 値 |
| --- | --- |
| `GET /portfolio` | 200 |
| `GET /portfolio/propose` | 200 |
| 詳細ページの未レビュー表示 | `document.querySelectorAll('[data-evidence-status="unreviewed"]').length` = **1**、表示文言「RIGHTS REVIEW: UNREVIEWED / 権利レビュー未実施」 |
| 詳細ページの `<img>` | `naturalWidth=1080` / `naturalHeight=1920`（**デコード済み**。壊れた画像ではない） |
| `GET /media/portfolio/propose/propose/media_…png`（local origin） | 200 / `image/png` |
| D1 の内訳 | `portfolio_project` 63 / 公開 60 / retire 3、`portfolio_link` 103、`portfolio_media` 130（cover 23、media を持つ project 23） |

スクリーンショットは WebP（PNG は保存していない）:

- `portfolio-publication-list-811.webp` — `/portfolio` の一覧上部（**カードが
  写っている**: 3 件の card とその画像）
- `portfolio-publication-811.webp` — `/portfolio/propose` の詳細（移行した画像
  と未レビュー表示）

検証のために canonical production origin の media URL を local origin へ
向け替えて採取した（production にはこの key が無いため）。一覧は
`#portfolio-list` へスクロールしてから採取している（**先ほどの版の
スクリーンショットは一覧の領域を写しておらず、/cards が 1 枚も無い
—was。** この節の DOM 実測値とスクリーンショットで置き換えた）。

## 4. 「加していない」ことの機械的確認（実測）

`scripts/check-portfolio-summary.mjs`（Issue #811 新規）。

| 実測項目 | 値 |
| --- | --- |
| 検査した移行行 | 60 |
| 元の文がそのまま写っている（逐語） | **60 / 60** |
| 元に無い文を追加した行 | **0** |
| 元に無い数値を追加した行 | **0** |
| 判定できなかった行 | **0** |

**検査が加筆を検出できること**（空振りでないことの確認）: 1 行に
「この作品は受賞しました。2024年に制作されました。」を注入した状態で
再実行すると、`ADDITION FOUND`（追加文 1 件・追加数値 1 件、`2024`）を報告
し、exit code **1** を返した。inject を戻すと 60/60 逐語に戻った。

検査の単位は**節**（行 / `。`/`！`/`？` 終端の文）。受理する形は 3 つ:
元の一節 / 元の連続した節の連接 / 元の順序を保つ部分列。いずれも
「元の語を元の順に並べたもの」であり、元の無い語・並び替えは通らない。

## 5. legal 判定の組み替え（実測）

`src/legal/**` の判定軸を 2 軸に組み替えた（ADR-0019 §2.2）。`hold` は
廃止し、`evidenceStatus`（`reviewed` / `unreviewed` / `provider-terms` /
`inconsistent`）に置き換えた。

| 実測項目 | 値 |
| --- | --- |
| `pnpm run assets:license:check` | verdict **WARN**（error 0 件。exit 0） |
| 移行 60 行の `evidence_status` | `unreviewed` 60 件 |
| 決定記録（`quality/asset-license-publication-decision.json`） | `ownerConfirmation: "confirmed"` / `publishesUnreviewed: true` / 表示場所と marker を宣言 |
| 表示義務の gate（`L022`） | 決定記録が宣言した `src/portfolio/components/PortfolioEvidenceNotice.tsx` に marker があるため **error 0 件** |
| **未レビューを隠したら赤になることの確認** | marker を消した fixture で gate が **exit 1**（`L022` error）を返すことを確認 |
| 権利記録の捏造 | **していない**。`quality/asset-license-inventory.json` は未変更（`verification.method: 'none'` のまま） |

`L019`（owner 決定の対象外の未レビュー資産が公開されている）は warn のまま
残す。対象は Issue #811 の決定範囲（移行 60 件）であり、それ以外の未レビュー
資産は本次 결정の主題ではないため、赤にはしない（見えることは保つ）。

## 6. Migration 0010 について（実測で分かったこと）

`role` を nullable にするには `portfolio_project` の作り直しが要るが、
**SQLite の `ALTER TABLE ... RENAME TO` は子テーブル（`portfolio_link` /
`portfolio_media`）の外部キー句を書き換える**。local D1 で実測した結果、
`portfolio_link.project_id` が `REFERENCES "portfolio_project_pre_0010"(id)`
になり、以降の `portfolio_link` への INSERT が
`no such table: main.portfolio_project_pre_0010` で失敗した。
migration runner は `PRAGMA legacy_alter_table = ON` を**無視する**
（同じ実測で、ON にしても外部キー句が書き換えられた）。

よって 0010 は**列の追加だけ**にし（`evidence_status`）、`role` は NOT NULL の
まま「記録が無い = 空文字列」、`src/portfolio/schema.ts#rowToProject` が空文字を
`null` に写す契約にした。production で 3 テーブルを作り直す보다 blast radius が
小さく、決定 D4（本文の加筆禁止）にも合う（プレースホルダ文字列を書かない）。

## 7. production への書き込みが無いこと

- production の D1 / R2 / Notion への書き込みは **0 件**。
- 本記録のすべての実測は **local**（`.tmp/d1state`）と local preview で行った。
- production 手順は [`docs/runbook/portfolio-publication.md`](../../runbook/portfolio-publication.md)
  に書き、実行は operator の認可条件つきにした（§2）。
- credential の値は出力していない（名前のみ）。

## 8. 再現手順（local）

```bash
# 1) local D1 を作り直す
node -e "const {rmSync}=require('node:fs');rmSync('.tmp/d1state',{recursive:true,force:true})"
node scripts/d1.mjs apply --target=local

# 2) テキスト移行（60 行を public で）
node scripts/migrate-portfolio-from-2025.mjs --apply --target=local \
  --ledger=docs/migration/portfolio-2025-to-2026-publication.json

# 3) メディア移行（Issue #850 の script）
node scripts/migrate-legacy-media.mjs --apply --target=local

# 4) 加筆検査
node scripts/check-portfolio-summary.mjs

# 5) 権利 gate
pnpm run assets:license:check

# 6) built 出力と preview
pnpm run build && node scripts/sync-cf-build-output.mjs && vite preview
```

## 9. 関連

- [`docs/domain/portfolio-migration-decisions.md`](../../domain/portfolio-migration-decisions.md)
- [`docs/runbook/portfolio-publication.md`](../../runbook/portfolio-publication.md)
- [ADR-0019](../../docs/adr/ADR-0019-publication-authority-and-unreviewed-assets.md)
