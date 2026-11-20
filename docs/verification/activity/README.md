# GitHub アクティビティカード — 検証記録 (Issue #334)

> Issue #334「公開 Issue/PR の動きを読み取り専用で可視化」の**実描画の検証記録**。
> 対象は Home `/` のステータス領域に載る `GitHubActivityCard`
> (`src/home/activity/GitHubActivityCard.tsx`)。データの正本は
> コミット済みスナップショット
> [`../../../src/home/activity/github-activity.json`](../../../src/home/activity/github-activity.json)
> で、ページ描画は GitHub を呼ばない。公開 feed の `IssuesEvent` /
> `PullRequestEvent` が日本語ラベル (Issue / PR)・イベント種別ごとの
> state ラベル (オープン / クローズ / マージ済み)・観測日・対象
> Issue/PR へのパーマリンク (`#<number>`; `ref` を持たないイベントは
> リポジトリの元リンク) 付きで列挙される (Issue #334 residual)。

## 画像

| ファイル | 状態 | 内容 |
| --- | --- | --- |
| `github-prs.png` | データあり | コミット済みスナップショットをそのまま投影したカード。feed 先頭 8 件に Issue / PR イベントが混在し、イベント種別ラベル・state ラベル・日付 (`YYYY-MM-DD`)・`#<number>` の Issue/PR パーマリンクが見える。上部には測定値ブロック (期間内コミット / PR 件数・上位リポジトリ) とソース状態・観測日が出る。 |
| `github-empty.png` | 空 (0 件) | 同じスナップショット文書の `repos` / `feed` を空にして**リーダーに通した**射影。カードは観測日・ソース状態・リポジトリ件数 (0 件) を保ち、feed の位置に「直近の公開イベントはありません。」を出す。捏造したイベントは無い。 |

## データソース

- どちらの画像も **コミット済みスナップショット** (`github-activity.json`) 由来。
  `pnpm run dev` で配信されるカードと同じデータ経路
  (`readGitHubActivitySnapshot` → `publicGitHubActivity` → カード) を通る。
- `github-empty.png` はスナップショット文書の `repos` / `feed` を空にした
  亜種を**同じ fail-closed リーダー**に通したもので、空状態はコンポーネントの
  実レンダリング (`feed.length === 0` → 「直近の公開イベントはありません。」)。
  DOM の書き換えやモック差し替えはしていない。

## 再現手順

```sh
pnpm run capture:activity-334   # node scripts/capture-activity-334.mjs
```

スクリプトは `.tmp/activity-334/` に Vite ハーネスを生成し、出荷済み story
(`src/home/activity/GitHubActivityCard.stories.tsx` の `Populated` / `Empty`)
の `render()` 出力をそのまま描画する。`pnpm run build-storybook` は
manager-only の静的ビルド (`iframe.html` 無し) のため、Storybook ギャラリー
ではなく story モジュールを import するハーネス方式を取る
(`scripts/capture-home-current-projects.mjs` と同じ規約)。

撮影前に `[data-testid="github-activity-card"]` の出現・`document.fonts.ready`・
800ms の settle を待ち、次を検査してから書き出す (満たさなければ非 0 終了):

- unavailable 状態 (「読み込めませんでした」) を撮っていないこと
- `github-prs.png` に `Issue` / `PR` / `観測日` が含まれること
- `github-empty.png` に「直近の公開イベントはありません。」/ `観測日` が
  含まれること

関連: サービス経由の実描画は `scripts/capture-github-activity.mjs` が
`docs/verification/home/github-activity{,-mobile}.png` に撮っている
(Issue #319)。

# 活動タイムライン — 検証記録 (Issue #352)

> Issue #352「release・記事・制作物を統合する活動タイムライン」の
> **コンポーネント単体の検証記録**。対象は
> `ActivityTimelineView` (`src/activity/Timeline.tsx`)。データは
> コミット済み fixture (`src/activity/fixtures.ts`) — 合成の検証用
> データであり、実際の公開実績を主張するものではない。`/activity`
> route と Home 導線は後続統合 (2026-10-17 補足の standalone 範囲)。

## 画像

| ファイル | 状態 | 内容 |
| --- | --- | --- |
| `timeline-desktop.png` | データあり (fixture) | `Populated` story を 1440px viewport で撮影。日付降順に リリース×2 (GitHub)・記事×1 (Content)・作品×3 (Portfolio、`periodLabel` の authored 日付表示) が並び、各行に種別バッジ・出典・日付・詳細リンクが見える。上部にソース別状態 (観測中) と観測日。 |
| `timeline-mobile.png` | データあり (fixture) | 同じ `Populated` story を 390px viewport で撮影。折り返しレイアウトで同一内容が読める。 |

## データソースと正直さの境界

- 画像は **コミット済み fixture** 由来。実データ経路
  (`sources.ts` の `githubReleaseItems` / `portfolioWorkItems` →
  `merge.ts` の `sortActivityTimelineItems`) は unit test
  (`src/activity/*.test.ts`) が pin する。
- 実ソースの現状 (2026-11 時点): GitHub Release は events feed の
  `ReleaseEvent` のみ (専用 releases source は Issue #336)、記事は
  content モデル未実装 (Issue #323)、作品は portfolio の
  `published` + `public` 行で日付は authored `periodStart` /
  `periodLabel` — `created_at` は seed/migration 時刻であり公開日
  ではないため採用しない。「未知の日付を補間しない」Issue 要件に
  従い、portfolio に publication-date 欄が無い以上、作品項目は
  公開日を主張しない。

## 再現手順

```sh
pnpm run capture:activity-timeline   # node scripts/capture-activity-timeline.mjs
```

`capture-activity-334.mjs` と同じ規約: `.tmp/activity-timeline/` に
Vite ハーネスを生成し、出荷済み story
(`src/activity/Timeline.stories.tsx` の `Populated`) の `render()`
出力をそのまま描画する。撮影前に
`[data-testid="activity-timeline"]` の出現・`document.fonts.ready`・
800ms の settle を待ち、`リリース` / `記事` / `作品` / `GitHub` /
`観測日` の含有と unavailable 文言の非含有を検査してから書き出す
(満たさなければ非 0 終了)。
