# GitHub アクティビティカード — 検証記録 (Issue #334)

> Issue #334「公開 Issue/PR の動きを読み取り専用で可視化」の**実描画の検証記録**。
> 対象は Home `/` のステータス領域に載る `GitHubActivityCard`
> (`src/home/activity/GitHubActivityCard.tsx`)。データの正本は
> コミット済みスナップショット
> [`../../../src/home/activity/github-activity.json`](../../../src/home/activity/github-activity.json)
> で、ページ描画は GitHub を呼ばない。公開 feed の `IssuesEvent` /
> `PullRequestEvent` が日本語ラベル (Issue / PR)・観測日・リポジトリへの
> 元リンク付きで列挙される。

## 画像

| ファイル | 状態 | 内容 |
| --- | --- | --- |
| `github-prs.png` | データあり | コミット済みスナップショットをそのまま投影したカード。feed 先頭 8 件に Issue / PR イベントが混在し、イベント種別ラベル・日付 (`YYYY-MM-DD`)・ソースリポジトリリンクが見える。上部には測定値ブロック (期間内コミット / PR 件数・上位リポジトリ) とソース状態・観測日が出る。 |
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
