# GitHub プロフィール共通データ契約

- Status: Accepted (2026-11-26)
- 正本関係: ADR-0027 / visual doc §23 のデータ層実装契約。
  #1244（配信分離）と #1245（集計範囲）が共有する唯一のデータ
  契約 — 変更は必ず本書へ先に反映する。
- 消費者: GitHub README の `/github-profile/*` 画像群、Web サイト
  本体の GitHub STATUS・`/now`・関連エンドポイント、home activity
  投影。**配信面はすべて本契約のスナップショットのみを読む**。

## 1. 原則

1. **画像リクエストは上流 API を呼ばない**。取得・同期・永続化・
   配信を分離し、配信経路は D1 スナップショットの読み出しのみ。
2. **スナップショットはデータ源ごとに独立更新可能**。単一の巨大な
   同期処理・単一巨大ペイロード・単一キャッシュ境界を再構築
   しない。
3. **各指標は `{scope, window}` を宣言する**。指標名だけで期間・
   範囲を推測させない。「all-time」表記は window=allTime の
   指標にのみ使う。
4. **公開境界は維持**: 非公開 repo・Organization 識別情報は既存の
   anonId/HMAC・fail-closed 契約（#932）を継続する。

## 2. リポジトリ発見と帰属（#1245 担当）

### 2.1 帰属クラス（scope）

| scope | 定義 | 発見経路 |
|---|---|---|
| `owned` | 本人が owner の repo（public + token 可視 private） | `GET /users/<login>/repos`（public）+ `/user/repos?affiliation=owner`（private） |
| `org-member` | 本人が member の Organization 配下で**実際にコントリビュートした** repo | `/user/orgs` で org を動的列挙 → `/user/repos?affiliation=organization_member` で repo 候補列挙 → §2.2 の実績計測で絞る |
| `collaborator` | 本人が collaborator として参加する repo | `/user/repos?affiliation=collaborator` |
| `external-public` | 上記 affiliation に含まれない**公開** repo で本人がコントリビュートしたもの | `search/commits?q=author:<login> is:public` / `search/issues?q=author:<login> is:public` の repo 集約で発見 |

**Organization 所属 ≠ コントリビュート**。org member affiliation は
repo 候補の列挙にのみ使い、各 repo の実績（本人 authored の
commit/PR/issue 数）は per-repo search で計測する。実績ゼロの
repo は `participated` 集計に含めない。

### 2.2 本人への帰属（attribution）

- commit: `author:<login>` または `committer:<login>`（co-author は
  対象外 — 本人のコード変更とは別指標）
- PR / issue: `author:<login>`（search/issues, search/pulls 相当）
- review: GraphQL `totalPullRequestReviewContributions`
- 重複排除: repo は `owner/name`（lowercase 正規化）を一意キーと
  し、affiliation 経路が重複しても 1 repo 1 エントリ。

### 2.3 repo ディレクトリ（永続化）

発見結果は D1 に永続化し、増分同期の基盤とする:

- `repo_directory`: `{ fullName, scope, isPrivate(→anon), lastSeenAt,
  affiliationSource[] }` — affiliation で見つかったが実績ゼロの
  repo も「候補」として保持し、実績計測で promoted/demoted する。
- 実績ゼロが継続する repo は participated 集計から除外するが
  ディレクトリからは即削除しない（再コントリビュート検出のため）。

## 3. 指標の意味論（#1245 担当）

各指標は `scope × window` を持つ。表の window: `allTime` /
`y1`（GitHub contributionsCollection の 1 年窓）/ `w30`（snapshot
windowDays=30）。

| 指標 | scope | window | 取得経路 | 備考 |
|---|---|---|---|---|
| streak.current / longest | user（全 attribution） | allTime | GraphQL contributionCalendar（年別） | 既存 fetchStreak と同等・変更なし |
| contributions.total | user | y1 | GraphQL totalCommitContributions 等 | 表示名に期間を明示 |
| commits.authored | user | allTime | `search/commits?q=author:<login>` total_count | org/external を含む。**公開 search 面のため private repo の commit は含まない** — 「公開面で検証可能な全期間の authored commit 数」として扱う |
| commits.windowed | repo 別 | w30 | per-repo `search/commits` | REPO OUTPUT 用・既存踏襲 |
| prs.authored / issues.authored | user | allTime | `search/issues?q=author:<login> type:pr|issue` | 同上・公開面 |
| prs.opened / issues.opened | user | allTime | GraphQL `pullRequests`/`issues` totalCount | token 可視の全 repo（private 含む）を数える GitHub 側の値 — search 系とは母集団が異なるため併記し混同しない |
| reviews.count | user | y1 | GraphQL totalPullRequestReviewContributions | 1 年窓であることを明示 |
| stars.owned | owned repo | allTime | repo stargazerCount 合計 | private repo は実質 0（他者は star 不可） |
| stars.participated | participated repo | allTime | 同上・非 owned の**公開** repo のみ | private 参加 repo は集計に入れない |
| languages.ownedBytes | owned **公開** repo | — | repo languages byte 合計（fork 除外） | v0.14.0 までは private owned repo も含んでいた — 公開境界（§4）に合わせ公開のみに統一 |
| languages.participatedBytes | participated **公開** repo | — | 同上・非 owned + external-public | 「参加 repo の言語構成」 |
| repos.ownedCount / repos.participatedCount / repos.contributedToCount | — | allTime | discovery + 実績 | contributedTo は既存 GraphQL 値と整合確認。participatedCount は directory ページング上限時に下限値になり得る — snapshot の `repos.complete` で明示 |
| followers | user | allTime | GraphQL | 変更なし |
| rank | 合成 | — | §3.1 | 入力指標を明示 |

### 3.1 Rank

**決定（2026-11-27 実装時）**: rank 入力は以下で固定する。

- `commits` = `commits.authored`（search/commits allTime・公開面）、
  `all_commits=true`（weight 10 経路 — 真の全期間なので upstream の
  all-commits 重みを使う）
- `prs` / `issues` = `prs.authored` / `issues.authored`
  （search/issues allTime・公開面）
- `reviews` = `reviews.count`（y1 窓のまま — 窓は入力宣言に明記）
- `repos` = `repos.ownedCount`、`stars` = `stars.owned` —
  **owned スコープを維持**（v1）。participated の repo/star は別指標
  として公開し、rank に混ぜない — vendored 式が tuning された母集団
  （owned repo）との整合を保ち、恣意的な上方修正を避ける。
- `followers` = GraphQL allTime

snapshot は同一入力で `rank.current`（vendored calculateRank）と
`rank.legacy`（旧 anuraghazra/github-readme-stats 式 —
`repos` 未使用・median/weight が異なる）の両方を保持し、旧新比較を
データとして残す。いずれかの入力が未計測（null）の場合 rank 全体を
`null` とし、欠損を 0 として計算しない。

**表示採用（2026-11-27 決定、Issue #1262、2026-11-27 精査で再確認）**:
surface が表示するのは `rank.current` のみ。採用基準は新旧ではなく
**評価指標としての妥当性と実態への適合性**: (1) 入力が all-time
authored commits（`all_commits=true` の weight-10 経路）で、legacy 式は
repos 入力を使わず median 中心の旧重み付けのため、同じ実態を測っても
系統的に上位（実測: current B+ 40.1% vs legacy A+ 10.2%）を返す —
percentile の意味が実態から乖離する。(2) vendored `calculateRank` は
upstream が維持する現行式で、owned スコープ入力・all-time 窓との
整合が契約で固定済み。`rank.legacy` は snapshot に残し、乖離の
監視用データとして扱う（表示面には出さない）。

- 検証証跡: `scripts/sync-github-stats.test.mjs` が同一入力での
  両式出力と null 伝播を固定。実データでの新旧差分は初回 sync 後の
  snapshot 値で確認する（`docs/verification/` に記録予定）。

### 3.2 participated スコープの表示意味論（Issue #1262）

`languages.*` / `stars.*` / `repos.*` は **リポジトリ単位の集計**
であり、本人のコード変更量ではない。表示面はこの区別を保つ:

- `/vitals`: account/owned 指標を意味グループ（consistency:
  streak/contributions → output: commits/PRs/issues/stars）に分けた
  2 行 strip とし、PARTICIPATED スコープ（参加プロジェクト数
  `repos.participated`・参加 repo の stars）はその下に 1 行の
  muted テキストとして従属表示する。参加指標を owned 指標へ
  合算・混在させず、別 metric row も立てない（高さ抑制）。
  - **冗長排除（2026-11-27 精査）**: `repos.participated`（実績計測:
    直近窓の commit/PR 実績が確認できた repo）と
    `metrics.contributedTo`（GraphQL `repositoriesContributedTo`
    affiliation 数）は**定義の異なる別集計**であり、実データで
    件数が一致（ともに 28）しても母集団の同一性は証明されない
    — affiliation は貢献実績ゼロの repo も含み得る。表示には
    実績計測値 `repos.participated` のみを使い、affiliation 値は
    snapshot に残すが表示しない。
- `/top-languages`: BOTH scope が計測済みなら **ALL REPOS — OWNED +
  PARTICIPATED** の結合バーを主表示とし、OWNED REPOS /
  PARTICIPATED REPOS を従属ペア（desktop 横並び・mobile 縦積み、
  6px 細バー + top-2 言語凡例）で比較表示する。片 scope のみ計測ならその scope の単独バー。
  各バーは「その scope の repo が持つ言語構成（bytes）」であり、
  本人がその言語で書いた量ではない — キャプションで scope を明示する。
- **本人のコード変更量の言語別計測（調査結果・2026-11-27）**:
  現行データ源では**計測不能**。languages API・commits/issues
  search は repo 単位の集計か件数のみで、作者別 diff bytes を
  返さない。実現には repo clone + `git log --numstat` 相当の
  言語別 attribution が必要で、(a) owned repo のみ clone 可能、
  (b) participated の private repo は不可、(c) co-author 行の
  帰属が曖昧、(d) 新規パイプラインと増分集計基盤が必要 — のため
  現時点では見送り、repo 言語構成の scope 別表示を正とする。
  将来 owned scope 限定の tokei/cloc 系バッチを検討する余地は
  あるが、別 Issue で設計する。
- `/profile`（互換合成）は凍結済みの旧構成を維持し、参加指標を
  追加しない（モバイル高さ予算・README 未参照の legacy 面）。
- participated 集計が未計測（null）の場合、レーン/バー自体を出さ
  ない — 「参加なし」と「未計測」を区別する。
- **stats card の 503 と配信継続**: `/api/v1/github-readme-stats/api`
  は snapshot 不在時に 503 を返すが、`serveCard` の SWR store が
  先に評価されるため、一度でも描画済みのカードは snapshot 障害中も
  stale 配信を継続する（LKG 相当）。503 が出るのは store 未保持の
  初回のみで、upstream 障害時と同じ degraded 契約 — 「HTTP 200 のみを
  もって配信継続とみなさない」運用検証は docs/release.md の
  post-deploy acceptance に従う。

## 4. 公開範囲

- `external-public` / `org-member` の**公開** repo は通常の公開
  repo として表示してよい（repo 名は GitHub 上で既に公開情報）。
- 非公開 repo（owned-private・org-private）は anonId/HMAC で
  `kind:'private'` 集約行にのみ現れる。org 名・所属関係を推測
  させる表示はしない。
- org 自体の識別情報（org 名・member 一覧）は公開しない —
  repo full_name に含まれる org 名は「その repo が公開である」
  ことの範囲でのみ許容。

## 5. データソースと鮮度

| snapshot | 内容 | 生成 | 想定周期 | 消費 surface |
|---|---|---|---|---|
| `github_activity_snapshot`（既存拡張） | repo directory + windowed 実績 + feed72 + sources status | sync job（非同期） | 既存 cadence 維持 | Activity 系・REPO OUTPUT・home activity |
| `github_stats_snapshot`（**新規**） | streak・contributions・commits.authored・prs/issues/reviews・stars 分離・languages 分離・rank 入力 | sync job（非同期・activity と独立） | activity より遅くてよい（日次級） | Vitals・Top Languages・stats card |
| `discord_presence_snapshot`（既存） | presence | 既存 | 15 分 | Presence・masthead |
| 静的資産 | stack icons・works・avatar | コミット/R2 | deploy | Stack・works・avatar（avatar は §5.1） |

### 5.1 avatar

request 時 `github.com/<login>.png` fetch を廃止。avatar は
sync 時に R2 または stats snapshot 内の data URI として永続化
し、鮮度は stats snapshot 周期に従う。取得失敗時は前回値
（LKG）→ 無ければ画像なしの honest 表示。

## 6. 増分同期と部分失敗

- **独立更新**: 各 snapshot は別テーブル/別行で、ある sync の
  失敗が他 snapshot を汚さない。書き込みは検証成功時のみ
  （既存 checkActivitySnapshot パターン踏襲）。
- **LKG**: sync 失敗時は前回 payload を保持。配信側は payload
  内の `sources.*.status`/`observedAt` で stale を honest 表示
  （既存の sourceWarn パターン）。
- **増分**: repo directory の `lastSeenAt` と windowed 実績は
  差分更新。allTime 指標は search total_count（ページング不要）
  のため毎回全量再計算でよい — ただし rate limit を考慮し
  sync 内で pace する（既存 searchTotalCount のペーシング踏襲）。
- **部分失敗**: per-source status（public/private/org/external）
  を payload に保持し、失敗 source のみ honest unavailable。
  repo 単位の search 失敗は当該指標を absent（0 ではない）に
  する既存契約を継続。
- **重複同期防止**: 同一 sync の多重起動を防ぐ（既存 job の
  排他機構があれば踏襲、なければ実装時に最小のロックを設計）。

## 7. 配信面との対応（#1244 担当）

- `/profile` は互換ラッパ: 分割 surface 群を同一モデルに合成し
  現行と同一 SVG を返す。README 切替まで維持。
- 分割 surface（Identity/Presence/Vitals/TopLangs/Activity/
  Stack）は各 snapshot のみを読み、cache-control は鮮度に応じて
  個別設定。`microCache` は request 経路の上流呼び出しを全廃
  （D1 読み出しの重複排除にも原則不要 — isolate 内で十分軽い）。
- Web 本体の GitHub STATUS・`/now`・home activity 投影も同じ
  snapshot を読む構造へ移行し、指標の意味が面ごとにずれない
  ようにする。

### 7.1 実装マッピング（2026-11-26 時点）

| surface | endpoint | 読む snapshot |
|---|---|---|
| Identity(masthead) | `/identity`（person fragment のみ: avatar+name+tagline+Discord presence。Issue #1286 で vitals/language bar を除去 — 公開 README が `/vitals` `/top-languages` を独立資産として配信するため責務を分離） | activity + presence + stats snapshot は avatar 取得のみに使用 |
| Presence | `/presence` | discord_presence_snapshot |
| Vitals | `/vitals`（新規） | github_stats_snapshot |
| TopLangs | `/top-languages`（新規） | github_stats_snapshot |
| Activity | `/activity-map` | github_activity_snapshot |
| Stack | `/stack` | 静的資産 |
| 互換合成 | `/profile` | 全 snapshot（現行と同一 SVG） |
| `/now` `/status` `/activity` `/current` `/card` | 既存 | 各 snapshot（request 時上流呼出なし） |
| サイト GitHub STATUS カード `/api/v1/github-readme-stats/api{,/top-langs/,/streak}` | 既存 | **github_stats_snapshot**（stats: Issue #1262、top-langs/streak: Issue #1268 で request 時 upstream fetch から移行。top-langs は `languages.owned`（旧 fetchTopLanguages と同一の owned 母集団）、streak は `streak` ブロックをそのまま投影。snapshot 不在・未計測は **200 の未観測 SVG**（Issue #1284 — 「first sync pending」を明示する有効な画像で、store 非永続・60s cache。検知は snapshot-health が担い画像 status code と分離）。その他の上流障害は 503 degraded + SWR stale 配信） |
| サイト pin カード `/api/v1/github-readme-stats/api/pin/?repo=` | 既存 | **request 時 upstream fetch を許容**（Issue #1284 案B — repo 単位の動的データで snapshot 化には対象集合の固定が必要。障害分離: pin の失敗は他カードに波及しない独立 store/refresh。タイムアウト: `fetchRepo` は vendored retry/timeout を継承。キャッシュ: `microCache` 5s + `svgStore` SWR（freshSeconds=10日）で上流障害時も stale 配信） |

`/identity` は person fragment（masthead + Discord presence）に
再定義済み（Issue #1286）。vitals 数値と言語構成は `/vitals`・
`/top-languages` が唯一の描画責務を持ち、README 上で統計情報が
重複しない。互換 `/profile` 合成 SVG は `drawIdentitySection` の
`accountStats` 既定値（true）で従来どおり vitals+langs を内包する。

## 8. 変更管理

- 本契約の変更は ADR-0027 と visual doc §23 へ波及させる。
- snapshot schema の変更は後方互換（optional 追加）を原則とし、
  ingest 側の検証（checkActivitySnapshot 系）を同時更新する。
