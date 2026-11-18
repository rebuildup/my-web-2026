# 作品公開進捗の正本（Issue #835）

- 状態: **agent 記録の設計決定**（owner 決定ではない。公開 copy の文言は
  copy-editorial 承認ゲートの対象で、別途 owner レビューを要する）
- 記録日: 2026-11-18
- 関係: Issue #835（O-5: GitHub Releases は作品公開進捗の代替ではない）
  / Issue #766・#811（移行台帳）/ `src/portfolio/components/EmptyState.tsx`

## 決定

「作品公開の進捗」の正本は **portfolio obligation が公開面へ出す作品集合そのもの**
とする。具体的には:

1. **公開面の正本**: `src/portfolio` が D1 の `public` + published 行から
   射影する `/portfolio` 一覧と、トップページの現在地セクション
   （`src/home/`）。訪問者が「進捗」を確かめる面はこの 2 面であり、
   ここに出ているものが公開済み作品の全てである。
2. **移行期の作業台帳**: `docs/migration/portfolio-2025-to-2026-publication.json`
   （151 行）が「旧サイト 151 件のうち何が公開面に載ったか」の記録正本。
   公開面が 0 件の間はこの台帳が進捗の実体を持つ。
3. **GitHub Releases は正本ではない**: Releases はプラットフォーム自身の
   site update history（Issue #336）であり、作品の公開進捗ではない。
   `/portfolio` の空状態が Releases を既定の導線にしていたのは O-5 が
   否定した構造であり、取り除く。

## 空状態の契約

- `PortfolioEmptyState` は「公開できる entry が 0 件」のときだけ描画される。
  その場合の実際の進捗は「公開済み 0 件 / 移行対象は台帳のとおり」であり、
  表示はそれを誇張しない短い文と、進捗が見える面（`/portfolio` と
  トップページの現在地セクション）への導線だけを持つ。
- Issue #811 の全件移行が完了して空状態自体が消えた場合、本契約は
  no-op として失効する（表示対象が無くなるため）。
- 表示文言の変更は公開日本語 copy であり、`quality/copy-editorial-approvals.json`
  の pending 記録を経て owner レビューを受ける。agent は承認済みにしない。

## 検証

- 正本（公開 portfolio 行）と空状態表示の乖離が起きないことは、
  空状態が「0 件のときだけ出る」条件自体が portfolio loader の
  published 集合に bind されていることで保証される
  （`src/routes/portfolio*.tsx` の loader → `PortfolioEmptyState`）。
- copy の owner 承認状態は copy gate（`scripts/check-copy-editorial-approval.mjs`）
  が fingerprint 単位で報告する。
