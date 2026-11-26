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
| commits.authored | user | allTime | `search/commits?q=author:<login>` total_count | org/external を含む真の全期間 |
| commits.windowed | repo 別 | w30 | per-repo `search/commits` | REPO OUTPUT 用・既存踏襲 |
| prs.authored / issues.authored | user | allTime | `search/issues?q=author:<login> type:pr|issue` | |
| reviews.count | user | y1 | GraphQL totalPullRequestReviewContributions | 1 年窓であることを明示 |
| stars.owned / stars.participated | repo 別合計 | allTime | repo stargazerCount（所有/参加で分離集計） | participated は公開 repo のみ・private は anon |
| languages.ownedBytes | owned repo | — | repo languages byte 合計 | 「所有 repo の言語構成」 |
| languages.authoredBytes | 本人変更量 | — | 取得困難なら**採用しない** — repo 属性と作者属性を混同しない。代替: participated repo の言語構成を別指標として出す場合は `languages.participatedBytes` と命名 |
| repos.ownedCount / repos.participatedCount / repos.contributedToCount | — | allTime | discovery + 実績 | contributedTo は既存 GraphQL 値と整合確認 |
| followers | user | allTime | GraphQL | 変更なし |
| rank | 合成 | — | §3.1 | 入力指標を明示 |

### 3.1 Rank

- 入力は宣言済み指標のみ。`repos`/`stars` は owned と participated
  を分離した値を使うか、意味を明記した単一値にする — 実装時に
  ADR-0027 §2.2 の「実態に合った集計」で決定し本書へ追記する。
- 旧方式（vendored 以前）と現行方式を同一入力で比較した記録を
  検証証跡として残す。恣意的な引き上げ禁止。

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

## 8. 変更管理

- 本契約の変更は ADR-0027 と visual doc §23 へ波及させる。
- snapshot schema の変更は後方互換（optional 追加）を原則とし、
  ingest 側の検証（checkActivitySnapshot 系）を同時更新する。
