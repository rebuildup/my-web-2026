# portfolio 制作史タイムライン要素の実描画証跡 (Issue #518)

対象は `src/portfolio/components/PortfolioProjectHistory.tsx` — 公開済み
作品 1 件の**制作開始 / 改版 / 公開**イベントを日付順に並べ、各イベントに
出典を添えて表示する要素。個人の経歴 (#389) やサイトの release 履歴
(#336) ではなく、作品自身の年表であり、「記録」と「記憶」を別の軸として
区別することが要件。

## 1. 何を撮ったか

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/portfolio/components/PortfolioProjectHistory.stories.tsx` の `Default` story（story 自身の `render()` 出力） |
| fixture | `src/portfolio/fixtures/project-history.ts` — `my-web-2026` 自身。repository が公開済みの作品で、未公開素材は使っていない |
| capture 手段 | `node scripts/capture-project-history.mjs`（`.tmp/` に Vite harness を生成 → loopback 配信 → Playwright Chromium → PNG） |
| viewport / DPR | story: 1440 x 900 / 1、mobile: 390 x 844 / 1、いずれも `fullPage` |
| 成果物 | `docs/verification/portfolio/project-history-story.png`（337,752 bytes）/ `docs/verification/portfolio/project-history-mobile.png`（310,730 bytes） |
| 出力形式 | Issue が `project-history-*.png` を名指しするため PNG |
| 再現性 | harness build は決定的。ブラウザ撮影は byte 再現ではない |
| 本番非破壊 | 外部通信なし。loopback 配信のみ。deploy / binding / secret の読み出しは無い |

`build-storybook` がこの repository では manager-only の静的ビルドに
なるため（`scripts/capture-error-state-gallery.mjs` 参照）、capture は
story module を直接 import する harness で行う。撮影されるのは
Storybook surface と同一の `render()` 出力であり、乖離しない。

## 2. 画面が示しているもの

- 作品タイトル・期間（`2025-09 - present`）・要約の header。
- 凡例 `読み方 / How to read` — epistemic axis の 2 区分
  （記録 / Record、記憶 / Recollection）の定義。chronology axis
  （制作開始 / 改版 / 公開 / 補足）は各イベントの badge が担う。
- 7 イベントの年表。各イベントは日付（記録の粒度どおり:
  `2025-09` は「（月まで）」付き、`2026-09-11` 等は日付）、kind badge、
  basis mark（実円 / リング）+ basis 語、タイトル、本文、出典一覧を持つ。
- `記憶` イベント（開始時点の移行見積もり）は「計画上の推定であり
  実績ではない」と明示したまま残り、事実には書き換えられていない
  （Issue の「制作の記憶を事実でない言葉に置き換えない」）。
- 画像は 1 件も無い — `seed.ts` の `media: []` どおり公開画像が存在
  しないため、全イベントが文章のみで描画される。これは fallback では
  なく fixture の実際の状態であり、capture script は `<img>` が 1 つでも
  描画されたら fail する。

## 3. 機械で検証した項目

capture script は撮影に先立ち、描画された DOM を読み戻して以下を
assert する。1 つでも欠ければ非 zero で終了する
（`evaluateObservation`、`scripts/capture-project-history.test.mjs`
が pure 部分を単体テストする）。

| 項目 | 判定 |
| --- | --- |
| 凡例 | `読み方 / How to read` が描画されている |
| 出典ラベル | `出典 / Sources` が描画されている |
| kind 網羅 | start / revision / publication の 3 種が描画されている |
| basis | 全イベントが `record` / `recollection` の既知の値を持つ |
| 出典 | 全イベントが 1 件以上の出典を描画する |
| イベント数 | 描画数が fixture のイベント数と一致 |
| text-only | `<img>` が 0 件（公開画像が無い作品の fallback が既定状態） |
| 月精度 | fixture の month イベント数と `（月まで）` marker 数が一致 |
| 横スクロール | `scrollWidth <= clientWidth`（WCAG 2.2 SC 1.4.10）、desktop / mobile の両方 |

さらに `scripts/check-project-history-provenance.test.mjs` が
fixture を repo に対して検査する: 全イベントの出典 path が実在する、
`dateLabel` が `precision` と整合する、kind / basis が component の
語彙内、release version の literal を含まない（`package.json#version`
が唯一の版の出所、AGENTS.md §1）、recollection イベントが 1 件以上ある。

## 4. 典拠（content provenance）

fixture の各イベントの根拠（出典はイベントごとに画面にも表示される）:

- `制作開始 2025-09` — `src/portfolio/seed.ts` の `periodStart`
  （`Date.UTC(2025, 8, 1)`、コメント `// 2025-09`）と `periodLabel`。
  `docs/personal/domain.md` §9 の再構築方針。粒度は月までで、日は
  記録に無いため補わない。
- `記憶 2025-09` — `src/portfolio/fixtures/case-study.ts`（Issue #519）
  の `period-estimate` 記述。「移行範囲と完了時期は仮の見積もり」
  「完了目標 2026-10 は計画上の推定であり実績ではない」を、確度を
  落とさず記憶として保持する。
- `Foundation / Public Preview / Editorial Reactions`（2026-09-11 /
  -19 / -20）— `docs/release.md` の release 記録。版番号は
  `package.json#version` が唯一の出所なので codename と日付で示す。
- `旧サイト作品 60 件の production 公開 2026-11-05` —
  `docs/verification/portfolio/production-publication-2026-11-05.md`
  の実測記録と `docs/migration/portfolio-2025-to-2026-publication.json`。
  権利レビュー未実施（`evidence_status=unreviewed`）は
  `docs/adr/ADR-0019-publication-authority-and-unreviewed-assets.md`
  の決定どおりの状態として明記した。
- `移行は継続中 2026-11` — 同上 2 fixture / 検証記録の
  `current-evaluation` / 未了項目。完了を装わない。

採用 / 保留の判断: 本 Issue は要素と fixture・Storybook・証跡の
実装まで。作品詳細ページへの組込みは Issue が別途許容する optional
範囲であり、本 PR では行わない（ページ構成の変更を伴わない）。
D1 schema への制作史フィールド追加と実 project への適用も、公開 copy
の owner 承認と schema 変更を伴うため範囲外。実 project への展開は
別 Issue で判断する。

## 5. 再現手順

```bash
node scripts/capture-project-history.mjs
# → docs/verification/portfolio/project-history-story.png  (1440px)
# → docs/verification/portfolio/project-history-mobile.png (390px)
# → .tmp/project-history/report.json（観測値と判定）
```

option は `--only=story|mobile` / `--json-out=` / `--no-build` /
`--no-capture`。

## 6. 機械で検証していない項目（人手での判断）

- fixture の日本語の文言が読みやすいか・「記録 / 記憶」の線引きが
  妥当か（mechanically には「2 basis が描画され区別できる」こと
  しか確認していない）。
- 採用 / 保留の判断が妥当か（owner 判断）。
