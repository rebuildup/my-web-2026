# ADR-0024 — GitHub プロフィールカード画像の生成・配信契約

- Status: **Proposed** — Issue #1170 の設計正本。実装は同 Issue の ticket PR で行う
- Date: 2026-11-22
- Ticket: Issue #1170（my-web-2026 側）/ rebuildup/rebuildup#3（README 側）
- Target release: `release-0-12-0`

## 1. Context

`github.com/rebuildup` のプロフィール README を「名刺」として再構成する
（rebuildup/rebuildup#3）。主役は my-web-2026 が配信する **1 枚のメイン画像**
で、実際の制作物と現在の活動状況を一目で伝える。

このリポジトリには既に次の資産がある。

- `src/http/github-readme-stats/` — ベンダーの readme-stats カードを
  `/api/v1/github-readme-stats/*` で SVG 配信（Issue #933 / #969 / #1164、
  本番稼働中）。
- `src/http/activity/` + `src/home/activity/` — GitHub activity スナップ
  ショットの ingest（D1 `github_activity_snapshot`）と fail-closed
  reader。公開射影は private を匿名化済み。
- `src/http/presence/` + `src/home/presence/` — Discord presence
  スナップショット（D1 `discord_presence_snapshot`、15 分鮮度窓）。
- `src/portfolio/notion/reader.ts` — コミット済み Notion スナップショット
  から `PortfolioProject[]` を同期的に得る（ランタイム fetch なし）。
  `media[]` の `isCover` + `r2Key` が実制作物画像で、公開可否は
  `isPublicMediaKey`（Issue #634 の公開境界）が fail-closed に判定する。
- `src/http/middleware/cache-policy.ts` — `/api/v1/*` の shared-cache
  opt-in（`public` + 正の freshness lifetime）。

新規に必要なのは「これらを 1 枚の画像に合成して配信する」契約だけである。

## 2. Decision

### 2.1 形式は SVG（生成時点の比較結論）

| 候補 | 判定 | 理由 |
| --- | --- | --- |
| **SVG** | **採用** | Worker 上で文字列生成するだけで完結し、ラスタライズ基盤が要らない。解像度非依存でモバイルの高 DPI でも劣化しない。GitHub/Camo は SVG を `image/svg+xml` としてそのまま中継する（readme-stats 系カードの実績あり）。**ただし `<img>` 経由の SVG は外部サブリソースを読み込まない**（後述 §2.3a）ため、実制作物画像は `data:` URI として SVG 内に埋め込む。発行バイト数は埋め込み予算（§2.3a）で頭打ちにする。 |
| PNG / WebP | 不採用 | Worker で SVG→ラスタ変換するには Cloudflare Browser Rendering 等の新規サービスが必要で、AGENTS.md §4 の「追加サービスは ticket + ADR」対象になる。得られるのはラスタ化だけで、カードの内容・鮮度契約は SVG と同一。コストに見合わない。ラスタ化しても外部画像の埋め込み問題は残るため、SVG + data URI の方が単純。 |

SVG の制約として、画像内部のリンクは Camo 経由では機能しない
（GitHub が画像をプロキシするため）。したがってカード内に疑似ボタン・
リンク要素を置かず、README 側は画像全体を `<a>` で囲むかテキストリンクで
導線を張る（rebuildup/rebuildup#3 の要求と一致）。

**外部 `<image href>` は使えない（レビュー指摘による設計修正）**:
GitHub は README 中の画像を `<img>`（Camo プロキシ経由）として描画する。
`<img>` で読み込まれた SVG は「secure animated mode」に相当し、外部
URL を参照する `<image href="https://…">` は **一切フェッチされず空白に
なる**。SVG 自体は 200 で配信されても作品画像だけが欠落するため、
文字列検査や HTTP 200 では検出できない。したがって実制作物カバーは
`media-embed.ts` がリクエスト時に R2 から読み、`data:image/…;base64,…`
として SVG 内に埋め込む（§2.3a）。

### 2.2 配信面は `GET /api/v1/github-profile/card`

- `src/http/github-profile/` を新設し、`externalBoundary` に
  `/api/v1/github-profile` として mount する。
- 認証不要（anonymous）。カードが参照する全データは公開面が既に
  公開している射影だけで構成する。
- `GET` のみ。他メソッドは 405。

### 2.3 データ境界 — `http` は `home` を import しない

`forbiddenOwnerDependencies` は `http → home` を禁じている。カードが必要
とする検証は **HTTP boundary 自身が既に持つ ingest スキーマ**
（`src/http/activity/schema.ts` の `GitHubActivitySnapshotBody`、
`src/http/presence/schema.ts` の `PresenceSnapshotBody`）で行う。
D1 の `payload` 列は ingest 時に同スキーマを通過した文書なので、読み側で
同じ契約を `safeParse` すれば「write が保証した形」と「read が再確認する
形」が一致する。`src/home/**` の reader は SSR 表示用の射影を持つが、
カードはそこに依存しない。

- **GitHub activity**: D1 `github_activity_snapshot` の payload を読む。
  行が無い・検証失敗の場合は「未観測」として描く（コミット済み
  `github-activity.json` へのフォールバックは `src/home/` 配下の資産で
  あり、`http` からは import できないため使わない。D1 が唯一のソースで、
  無ければ正直に unavailable を描く）。
- **Discord presence**: D1 `discord_presence_snapshot` の payload を読み、
  `env.DISCORD_PRESENCE_USER_ID`（runtime secret）と `userId` を照合する。
  `generatedAt` が鮮度窓（15 分、home/presence と同じ値を本モジュールに
  明記）を超えたら「stale」として描く。未取得・stale・不一致は全て
  unavailable 系の表示で、正常状態を偽装しない。
- **制作物**: `notionProjects()`（コミット済みスナップショット、
  `published` + `public` のみ）から掲載作品を選び、`isCover` 優先・
  ラスタ形式（png / jpeg / webp）の media を `r2Key` 候補として保持する。
  公開可否は `src/cloudflare/media-visibility.ts` の `isPublicMediaKey`
  で fail-closed に判定し、D1 の portfolio テーブルは読まない — カードは
  レビュー可能なコミット済み集合だけを使い、実行時に作品集合が動かない。
- **作品の選択**: `FEATURED_SLUGS`（カード所有の authored 選定リスト）を
  優先し、不足分は `periodStart` 降順で決定的に補充する。選定リストに
  あっても公開スナップショットに無い slug は単に出ない（fail-closed）。

### 2.3a メディア埋め込み契約（`media-embed.ts`）

`<img>` 経由 SVG の外部サブリソース禁止（§2.1）を受け、router は
model 合成後に `embedWorkMedia(model.works, env.MEDIA)` を実行する。

- 候補 `r2Key` を順に `MEDIA.head()` / `MEDIA.get()` し、content-type が
  png / jpeg / webp のものだけを `data:` URI 化する。`head` でサイズを
  先に見て、1 枚あたり `MAX_COVER_BYTES`（750KB）と残り総予算を超える
  オブジェクトはダウンロードすらしない。先に成功した候補で確定し、
  失敗・非公開キー・予算超過はその作品をプレースホルダ描画に落とす
  （カード全体は壊さない）。
- **総埋め込み予算 `MAX_TOTAL_MEDIA_BYTES` = 1.5MB**（元バイト基準、
  カード全体で共有）。超過分は埋め込まずプレースホルダにする。
  base64 は約 4/3 に膨らむため応答は最大 ~2MB 強。実カバー 4 枚
  （計 ~920KB）なら全件収まる想定。
- R2 が取れない・オブジェクトが無い場合も同じくプレースホルダで、
  嘘の画像や外部 URL への退避はしない。

新しい依存辺: `http/github-profile → portfolio`（`notionProjects` のみ）、
`http/github-profile → cloudflare`（`isPublicMediaKey` の値 import と
`env.MEDIA` バインディング。`http/media → portfolio` と同じ
「公開判定を portfolio / cloudflare の契約に委ねる」向き）。
AGENTS.md §3 の依存表に追記する。

### 2.4 鮮度とキャッシュ

- 画像内に各データの **観測時刻を必ず描く**（activity は `generatedOn` /
  `sources.*.observedAt`、presence は `generatedAt`）。キャッシュで
  古い画像が配られても、画像自身が「いつの観測か」を名乗るため
  正常状態の偽装にならない。
- `Cache-Control: public, max-age=300, s-maxage=300` —
  `sharedCacheIsolation` の shared-cache opt-in を満たす最小の positive
  lifetime。生成は D1 2 行 + コミット済み JSON の parse + R2 メディア
  読み（最大 4 オブジェクト・計 ~1.5MB 上限）+ 文字列合成で、旧設計の
  「数 KB・fetch なし」よりは重いが、共有キャッシュと Camo のプロキシ
  キャッシュで実リクエストあたりのコストは限定される。Camo のキャッシュ
  特性上、Worker の freshness をこれ以上短くしても閲覧者側の反映は
  Camo 次第になるため、5 分を初期値とし実測で見直す。
- Camo の実測（反映遅延・`no-cache` 系ヘッダの扱い・埋め込み後の
  応答サイズ）は `docs/runbook/github-profile-card.md` に測定手順を
  記録する。最終的な更新特性の検証はリリース候補確定後に実施する
  （AGENTS.md §6）。

### 2.5 テーマ・可読性

カードは不透明なダーク面（サイトの `editorial` トークンに準じた配色）を
持つ固定デザインとし、GitHub のライト/ダーク両テーマで同一の見え方に
する。テーマ追従（`prefers-color-scheme`）は SVG-as-image での挙動が
環境依存なため採用しない。文字サイズは README の表示幅（~800px）で
縮小されても読める下限を意識した構成にし、実画面検証は RC 後に行う。

### 2.6 コピー言語

カード内テキストは **英語** とする。GitHub の国際的な閲覧者向けであり、
公開日本語コピーの editorial 承認ゲート（Issue #506）の対象面を増やさ
ないため。サイト本体の ja/en 方針とは独立の配信物として扱う。

## 3. Consequences

- 新規サービス・binding・migration は **不要**。D1 の既存 2 テーブルと
  コミット済みスナップショットだけを読む。
- `http` が `home` の reader を再利用しないため、presence の
  「primary activity 選定」「15 分窓」などの小さな規則がカード側に
  ミラーされる。値は ADR とコードコメントで対応関係を明記し、
  片方だけ変わる drift は契約テストとレビューで拾う。
- README 側（rebuildup/rebuildup#3）は本エンドポイントの本番 200 応答が
  前提。画像 URL は `https://rebuildup.dev/api/v1/github-profile/card`。
- カードが参照する制作物画像は `data:` URI として SVG 内に埋め込まれる
  ため、閲覧者のブラウザも Camo も外部サブリソースを追加取得しない。
  埋め込みに失敗した作品はテキストのみのタイルに落ちる（画像全体は
  壊れない）。応答サイズは埋め込み量に比例して増えるため、実測値は
  runbook の検証記録で管理する。
