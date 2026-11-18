# #838 移行状態の測定記録（2026-11-18 / release-0-10-0）

「移行中」「public preview」の各主張と、実際の公開状態の突き合わせ。
実装状態の正本は release-0-10-0 のコードと D1/CMS snapshot。

## 測定結果

### `/` の meta / og:description（`src/routes/index.tsx`）

- 旧文言: 「Portfolio / content / activity を段階的に移行中です。
  この 2026 edition は移行途中の public preview です。」
- 実測:
  - **Portfolio**: CMS snapshot + D1 で published+public が 60 件
    公開中（#990/#1008 の verify-portfolio で照合済み）。
    「移行中」は portfolio については事実と異なる。
  - **about**: `/about` は release に統合済み（`ABOUT_DATA` が
    loader から供給され、experienceSlugs が公開作品に解決する）。
  - **content**: `/content` `/articles` 等の公開 route は存在しない
    （`src/routes/` に content 系 route なし）。移行は未完。
  - **activity**: GitHub activity snapshot（#319）と Discord
    presence（#320）は公開中だが、旧サイトの活動面の全面移行は
    未完。
- 結論: 「段階的に移行中」は content / activity については事実。
  「public preview」は 2026 edition が rebuildup.dev で公開運用
  されている現在、preview を名乗る根拠がない → 除去。

### `/portfolio` 空 state（`src/portfolio/components/EmptyState.tsx`）

- 旧文言: 「my-web-2025 から project データを取り込み中のため、
  まだ表示できる entry はありません。順次公開予定なので…」
- 実測: 移行は完了済み（60 件公開）。空 state が出るのは
  「公開作品が 0 件」のときだけで、移行中を理由にする記述は
  事実と異なる。
- 結論: 「取り込み中」を除去し、空の理由を「公開作品がまだ
  ない」に修正。

### `/about` Current（`src/about/data.ts`）

- 旧文言: 「foundation release を 2026-09 に終え、portfolio /
  about を順にこの release へ乗せている。」
- 実測: portfolio / about はこの release に統合済み。content /
  activity が移行中。
- 結論: 「順に乗せている」（進行中）を「統合済み。content /
  activity を順次移行中」に修正。

### `/about` 03 — Experience の空状態（`AboutPage.tsx`）

- 「現在、narrative subset に該当する公開作品はありません。」は
  `experienceSlugs`（aulymo / multi-slicer / my-web-2026）が全て
  未解決のときだけ出る fallback。公開作品が存在する現在は
  描画されない。fallback copy 自体は事実と矛盾しないため変更なし。

## 変更した copy（owner 編集レビュー承認待ち）

公開日本語 copy の変更は copy-editorial 承認ゲート対象
（AGENTS.md §5 / Issue #506）。本 PR の文言は agent による
事実整合の修正案であり、**owner の編集レビュー承認記録は未取得**。
`quality/copy-editorial-approvals.json` への記録は owner が行う。
