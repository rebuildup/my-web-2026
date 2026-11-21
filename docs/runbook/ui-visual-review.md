# UI 実画面レビュー runbook (Issue #1105, Epic #1104)

> デザインの良否をコードや axe の結果だけで判定しないための手順。
> `src/editorial/layout-system.md`（構成契約）と対になる運用正本。
> ADR-0022 §5.2 の実装。

**原則**: レンダリングされた画面を desktop/mobile × light/dark で
実際に見て、余白・整列・近接・対比・反復・視線誘導・情報密度・
色面構成を評価する。`pnpm run validate:fast` や axe が PASS でも
デザイン品質は何も保証されない — 逆に、このレビューで問題が
見つかればコードがどれだけ正しくても差し戻す。

---

## 1. いつ実行するか

- **各 ticket PR のマージ前**: 変更が visible UI に触れる場合、
  変更範囲の画面について最低 1 回実施する（desktop + mobile、
  light または dark の少なくとも一方）。全面 4 象限は変更が
  面構造・色面・タイポグラフィに及ぶ場合に行う。
- **freeze 候補の確定前**: 対象 route 全件 × 4 象限を実施し、
  結果を `docs/verification/design/` に証拠として残す。
- **新しい tone / primitive / grid preset を追加したとき**: その
  variant を使う最小の画面で 4 象限を確認する。

重い包括検証を各 ticket PR に要求しない。開発途中は対象画面の
高速プレビュー（`pnpm run dev` + 該当 route、または Storybook）で
局所確認し、包括検証は freeze 後に集約する（Epic #1104 の進め方）。

## 2. キャプチャの取得

```bash
pnpm run dev   # 別 terminal で dev server を起動
```

`scripts/capture-design-matrix.mjs`（Issue #1110 で実装予定）が
route × viewport × appearance の matrix を `.tmp/` に生成する。
実装前は既存の capture 系 script または Playwright で同等物を取得
する:

- viewport: desktop `1440×900` / mobile `390×844`
- appearance: `reducedMotion: 'reduce'` + `colorScheme: 'light'|'dark'`
  （Panda の `dark` condition は `prefers-color-scheme` なので
  `page.emulateMedia({ colorScheme })` で切り替わる）
- fullPage screenshot。長いページは分割して全体を確認する
  （`docs/verification/design/887-current/` の `--partN` 方式）。

## 3. チェックリスト

各 capture について以下を評価する。1 つでも「No」なら差し戻し。

### 構造・リズム

- [ ] セクションの縦リズムが役割（hero/body/closing）どおりで、
      隣接セクションが同一 tone・同一密度で単調になっていない。
- [ ] 余白が「関連情報のまとまり」と「異なる情報の分離」を
      表現している。全 gap が同じ値の均等割りになっていない。
- [ ] 広い viewport で「大きな空白 + 細長い一覧」の共存がない。
      コンテンツカラム（≤960px）が意図した読み幅を保っている。

### グリッド・整列

- [ ] セクション見出しとコンテンツが共有の左 key line / 右
      content column に揃っている（`boundingBox` で確認してよい）。
- [ ] グリッドの列数・比率が情報の関連性と読み順に対応している
      （単に列を増やしていない）。
- [ ] mobile で 1 カラムに自然に落ち、水平 overflow がない
      （`scrollWidth <= clientWidth`）。

### 色面・階層

- [ ] 色面（tone / field / inverse）がセクションの情報分類か
      強調の度を表しており、装飾的な色面がない。
- [ ] 同一 tone が隣接セクションで繰り返されていない。
- [ ] `inverse` がページの転換点（CTA/closing）に限定されている。
- [ ] 本文・リンク・操作が彩色で塗られていない（色は面と
      マークの役割）。
- [ ] light/dark 両方で ink/面のコントラストが保たれている
      （contrast gate の対象外の組み合わせがないか目視確認）。

### 情報密度・開示

- [ ] HOME がキュレーションされた入口であり、全データの
      表示先になっていない（C-8）。全件への導線がある。
- [ ] 一覧が無制限に展開されていない。代表数件 + 導線、または
      専用 index route へのリンクがある。
- [ ] 情報の優先順位が視覚的重み（型サイズ・面積・tone）と
      一致している。重要な情報が muted な二次情報に埋もれていない。

### 反復・一貫性

- [ ] 同じ役割の要素（カード・行・ボタン・リンク）が同じ
      primitive / variant で描かれている。見た目の再実装がない。
- [ ] ページ内で「カードの囲み」「余白」「文字サイズ」の
      バラつきが構造的理由を持っている（偶然の不統一でない）。

## 4. diff 限定レビュー（3 問）

PR レビューでは変更行だけを見て次の 3 問に答える
（T3 Code `.macroscope/check-run-agents/ui-consistency.md` と同じ
方式。finding がなければ指摘しない）:

1. **プリミティブ迂回**: 変更が `Button`/`TextLink`/`Panel`/
   `Grid`/`Stack`/`RecordList` 等の既存プリミティブを迂回して
   生要素をスタイルしていないか。同じ見た目が他で必要なら
   variant/slot の追加を提案する。
2. **契約外スタイル**: `quality/ui-contract.json` の C-1〜C-8 に
   触れる変更（section 級 padding・raw color・独自 grid・
   `<li>` box・手書き control・3 ファイル目の重複 literal・
   無制限一覧）がないか。allowlist 追加は理由の記載を要求する。
3. **composition 違反**: `PageSection`/`SectionHeading`/`Grid`
   preset の組合せとして不自然な構成（tone の無意味な連続、
   heading と content の分断、密度の局所逸脱）がないか。

## 5. 証拠の残し方

- 開発途中の確認: `.tmp/`（gitignore 済み）に置き、commit しない。
- freeze / 受入の証拠: `docs/verification/design/` に route 名・
  viewport・appearance が分かるファイル名で昇格する
  （既存 `887-current/`・`928-home-*` の命名に倣う）。
- 計測値（chromatic share 等）は `scripts/measure-chromatic-share.mjs`
  （Issue #1110）の**観測値**として記録する。閾値判定はしない —
  良否はこのチェックリストのレビューが決める。

## 6. 判定の記録

- 問題が見つかった場合: 具体的な観点（どの capture のどこが、
  どの条文/原則に反するか）を Issue または PR コメントに記録し、
  実装 loop へ戻す。「だいたい良い」で完了にしない。
- 問題がない場合: 実施した route × viewport × appearance の
  一覧と、確認した観点を verification 文書に記録する。
  「確認した」と書くだけで capture への参照がない記録は証拠に
  ならない（AGENTS.md §6 Issue closure requires evidence）。
