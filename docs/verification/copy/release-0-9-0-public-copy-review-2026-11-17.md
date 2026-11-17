# v0.9.0 公開日本語 copy — owner 一括レビュー資料（PR #926）

> これは **レビュー資料** であり、承認記録ではない。gate (`scripts/check-copy-editorial-approval.mjs`) の
> 出力を人間が一括確認できる形に整理したもの。承認・却下の判断は owner が行い、
> 手順は [`docs/runbook/copy-editorial-approval.md`](../../runbook/copy-editorial-approval.md) §4.5。

## 1. 対象と識別情報

| 項目 | 値 |
| --- | --- |
| 対象 PR | [#926](https://github.com/rebuildup/my-web-2026/pull/926) `release-0-9-0` → `main` |
| base | `origin/main` = `2ce6f87e`（merge-base と同一。main は cut 以降未更新） |
| head（資料作成時） | `59ae16f2`（privacy entry 公開 + stale-review record 追加を含む） |
| 変更された公開日本語 segment | **180**（added 160 / removed 20、生の gate 単位） |
| 重複を畳んだ承認対象 | **160 行**（added の一意 `(path, after)` 140 + removed 20） |
| release 変更集合 fingerprint | `sha256:dca17a5986715878faf9d0c9e11ad6bd09a822b847e403a4bd460f6f5820d7e2` |
| gate verdict | **NEEDS REVIEW** — この変更集合を覆う approval record は存在しない（owner 判断後に `pr-926` record を追加） |
| 再現 | `node scripts/check-copy-editorial-approval.mjs --base=origin/main`（release head で実行） |

fingerprint は「変更後の文面」全体に紐づく。**承認は文面に結び付く**ため、
merge 前に copy が 1 文字でも変われば fingerprint が変わり、記録は stale になる（runbook §5）。

## 2. 既存の承認 record との対応

`quality/copy-editorial-approvals.json` の **9 record はすべて `decision: "pending"`**
（owner の判断はどれも未記録。`reviewer: null`、provenance は `agent-recorded / unconfirmed`）。
そのうち **本リリース差分に関係するのは 2 件だけ**で、どちらも **PR 単位の変更集合**の
fingerprint であり、release 全体の変更集合（上記 fingerprint）は覆わない。

| record | PR | base | fingerprint | comparisons | 今回の差分との関係 |
| --- | --- | --- | --- | --- | --- |
| `pr-943` | #943 | `release-0-9-0` | `sha256:ecaac7de…` | 22 | GitHub 活動カード 12・snapshot.ts 2・composer 2・guide/ledger 6（ledger 6 件は PR 内の format 差分で release 差分とは別単位）をカバー。**pending** |
| `pr-960` | #960 | `release-0-9-0` | `sha256:5bd9859d…` | 1 | composer.tsx の GitHub 活動説明文の before/after をカバー。**pending** |
| その他 7 件 | #661/#655/#644/#663/#667/#619/#819 | 旧 release / `main` | — | — | **本差分に非該当**（v0.7.0 / v0.8.x 時点の変更集合。すでに main に公開済み） |

**release 用の record（`pr-926` 相当・`base: "main"`）はまだ存在しない。**
v0.7.0 では release PR #619 用に同じ手順で record が作られた（commit `54a7d97f`）。
owner 判断（2026-11-17、PR #926 での明示承認）を provenance に記録した record を追加する。

## 3. 承認対象の一覧（ファイル別・重複畳み）

gate の 180 単位のうち、同一 `(path, after)` の反復を 1 行に畳んだ。**`×N` は同じ文面が N 箇所に
現れることを示す**。record の comparisons は gate 単位で書く必要がある点に注意
（pr-619 の先例では gate 単位 120 件分を記録した）。

表の「既存 record の対応」は **同一文面を comparisons に含む record** を示すだけで、
release の fingerprint `sha256:dca17a59…` を覆う record は存在しない（§2）。

### 集計

- added の一意 `(path, after)` ペア: **140**（gate 単位 160 から反復を畳んだもの）
- removed: **20**
- ファイル数: **12**

### `src/home/activity/GitHubActivityCard.tsx` — トップ「現在地」GitHub 活動カード（観測状態・件数・出所表示）

| # | before | after | 出現 | 既存 record の対応 |
| --- | --- | --- | --- | --- |
| 1 | — | `観測中` |  L51 | pr-943（pending） |
| 2 | — | `未接続` |  L52 | pr-943（pending） |
| 3 | — | `取得失敗` |  L53 | pr-943（pending） |
| 4 | — | `GitHub 活動スナップショットを読み込めませんでした。` |  L64 | pr-943（pending） |
| 5 | — | `不明` | ×2 L68,69 | pr-943（pending） |
| 6 | — | `公開ソース: {publicState} / 非公開ソース（名称非表示）: {privateState} ・ 観測日{' '}` |  L76 | pr-943（pending） |
| 7 | — | `<span className={monoClassName}>{activity.generatedOn}</span> ・ 直近 {activity.windowDays}{' '}` |  L77 | pr-943（pending） |
| 8 | — | `日のイベント` |  L78 | pr-943（pending） |
| 9 | — | `<p className={mutedClassName}>直近の公開イベントはありません。</p>` |  L81 | pr-943（pending） |
| 10 | — | `観測された公開リポジトリ {activity.repoCount.public} 件 ・ 非公開（名称非表示）{' '}` |  L94 | pr-943（pending） |
| 11 | — | `{activity.repoCount.private} 件` |  L95 | pr-943（pending） |

### `src/home/activity/github-activity.json` — 同カードの committed fallback スナップショット（9 プロジェクト分の表示名）

| # | before | after | 出現 | 既存 record の対応 |
| --- | --- | --- | --- | --- |
| 1 | — | `非公開プロジェクト` | ×9 L355,365,375 | — |

### `src/home/activity/snapshot.ts` — fallback スナップショットの説明文（カード内リストの見出し説明）

| # | before | after | 出現 | 既存 record の対応 |
| --- | --- | --- | --- | --- |
| 1 | — | `GitHub 上で活動が観測された公開リポジトリ。` |  L130 | pr-943（pending） |
| 2 | — | `GitHub 上で活動が観測された非公開リポジトリ（名称・URL は非表示）。` |  L131 | pr-943（pending） |

### `src/home/ads/placements.tsx` — トップの広告プレースメント（広告クリエイティブの見出し・説明・CTA・alt 文）

| # | before | after | 出現 | 既存 record の対応 |
| --- | --- | --- | --- | --- |
| 1 | — | `Mic Level の画面。マイク入力レベルの目盛り表示。` |  L62 | — |
| 2 | — | `マイクの音量、もう勘で合わせていませんか？` |  L63 | — |
| 3 | — | `OBS と同じ目盛り。適正ゲインをその場で提案。` |  L64 | — |
| 4 | — | `レベルを確認` |  L65 | — |
| 5 | — | `URL を送るたび、QR を作り直していませんか？` |  L79 | — |
| 6 | — | `QR Generator — ブラウザで作る QR コード` |  L81 | — |
| 7 | — | `テキストや URL から QR コードを生成。` |  L82 | — |
| 8 | — | `QR Generator の画面。入力設定と生成結果パネルが並ぶ。` |  L84 | — |
| 9 | — | `QR を作る` |  L86 | — |
| 10 | — | `Pomodoro の画面。カウントダウンと作業・休憩スケジュール。` |  L101 | — |
| 11 | — | `Pomodoro — 作業と休憩のタイマー` |  L102 | — |
| 12 | — | `History Quiz の画面。空欄入りの歴史クイズ。` |  L108 | — |
| 13 | — | `History Quiz — 歴史の穴埋めクイズ` |  L109 | — |
| 14 | — | `Code Type p5 の画面。コードが打たれていくアニメーション。` |  L115 | — |
| 15 | — | `Code Type p5 — タイプ演出メーカー` |  L116 | — |
| 16 | — | `ProtoType のタイトル画面。Game Start とメニューが並ぶ。` | ×2 L139,172 | — |
| 17 | — | `3 分で始まる、ブラウザのタイピングゲーム` | ×2 L140,173 | — |
| 18 | — | `今すぐプレイ` |  L141 | — |
| 19 | — | `Pi Memory Game — プレイアブル広告` |  L155 | — |
| 20 | — | `フル画面で遊ぶ` |  L158 | — |
| 21 | — | `プレイする` |  L174 | — |
| 22 | — | `作品を見る` | ×2 L187,237 | — |
| 23 | — | `SVG to TSX の画面。SVG 入力と TSX 出力ペイン。` |  L201 | — |
| 24 | — | `SVG を React コンポーネントに変換。` |  L203 | — |
| 25 | — | `変換する` |  L204 | — |
| 26 | — | `Fillgen の画面。穴埋めプリントのエディタと出力欄。` |  L219 | — |
| 27 | — | `Fillgen — 穴埋め教材ページ生成ツール` |  L220 | — |
| 28 | — | `Markdown 風テキストから穴埋め教材を生成。` |  L221 | — |
| 29 | — | `教材を生成` |  L223 | — |
| 30 | — | `readmark のライブラリ画面。` |  L251 | — |
| 31 | — | `PDF を、アプリなしで読む。` |  L252 | — |
| 32 | — | `ローカルファースト。文書は外へ出ません。` |  L253 | — |
| 33 | — | `Text Counter の画面。入力テキストと文字数の計測結果。` |  L266 | — |
| 34 | — | `テキストの文字数、秒で数えられます。` |  L267 | — |
| 35 | — | `文字数・バイト数・行数をブラウザだけで計測。` |  L268 | — |

### `src/home/ads/units.tsx` — 広告ユニット共通の表示ラベル（「広告」「スポンサー広告」等の開示表記）

| # | before | after | 出現 | 既存 record の対応 |
| --- | --- | --- | --- | --- |
| 1 | — | `広告` | ×5 L297,544,666 | — |
| 2 | — | `スポンサー広告` | ×2 L487,1310 | — |
| 3 | — | `‹ スワイプ ›` |  L926 | — |
| 4 | — | `広告カルーセル` |  L934 | — |
| 5 | — | `プレイアブル広告` |  L1070 | — |
| 6 | — | `その場でプレイ` |  L1113 | — |
| 7 | — | `${headline} — タップしてその場でプレイ` |  L1132 | — |
| 8 | — | `タップしてその場でプレイ` |  L1183 | — |

### `src/home/composer.tsx` — トップページ構成（セクション見出し・説明文・リンクラベル）

| # | before | after | 出現 | 既存 record の対応 |
| --- | --- | --- | --- | --- |
| 1 | — | `サイトの状態` |  L354 | 移動（removed と同一文面） |
| 2 | — | `このサイトが今動いているか。binding の到達性、ページビュー、訪問者の反応を 1 つの面にまとめています。` |  L356 | 移動（removed と同一文面） |
| 3 | — | `プラットフォームの状態 / Platform health` |  L368 | 移動（removed と同一文面） |
| 4 | — | `GitHub の活動 / GitHub activity` |  L382 | pr-943（pending） |
| 5 | — | `から観測して保存した公開アクティビティのスナップショット。観測日とソース状態を併記します。` |  L386 | pr-960（pending） |
| 6 | — | `rebuildup の GitHub 統計カード (コミット・PR・スター数など)` |  L399 | — |
| 7 | — | `みんなの反応 / Reactions` |  L412 | 移動（removed と同一文面） |
| 8 | — | `リアクションは mw_actor_id Cookie で同じブラウザを区別します (Cookie` |  L415 | 移動（removed と同一文面） + pr-619（別 fingerprint） |
| 9 | — | `を消すと別の訪問者として数えられます)。保存される項目と保持期間はページ下部の「データと保持期間」に記載しています。` |  L416 | 移動（removed と同一文面） + pr-619（別 fingerprint） |
| 10 | — | `ページビュー / Page views` |  L422 | 移動（removed と同一文面） |
| 11 | — | `各リクエストは短時間ウィンドウ内で重複加算されません。` |  L425 | 移動（removed と同一文面） |
| 12 | — | `Discord プレゼンス / Discord Presence` |  L431 | — |
| 13 | — | `Contact / お問い合わせ` |  L469 | 移動（removed と同一文面） |
| 14 | — | `現在 re-verified されている contact channel だけを掲載しています。Channel には用途別の説明が添えてあります。` |  L470 | 移動（removed と同一文面） |
| 15 | — | `<span lang="ja">Contact を見る</span>` |  L505 | 移動（removed と同一文面） |

### `src/home/guide/GuideSection.tsx` — サイト内案内セクションの UI 文言（見出し・説明・バッジ・展開ラベル）

| # | before | after | 出現 | 既存 record の対応 |
| --- | --- | --- | --- | --- |
| 1 | — | `サイト内案内` |  L194 | — |
| 2 | — | `このサイトに何があり、どう辿るか。主要ページは同列の施設として、必要なときだけ下の階層まで開けます。` |  L196 | — |
| 3 | — | `{featured ? <span className={featuredBadgeClassName}>注目</span> : null}` |  L216 | — |
| 4 | — | `<span className={externalMarkClassName}>外部 ↗</span>` |  L218 | — |
| 5 | — | `下の階層を見る ({entry.children.length})` |  L225 | — |

### `src/home/guide/VisitTrail.tsx` — 訪問者トレイル（client-local）の UI 文言

| # | before | after | 出現 | 既存 record の対応 |
| --- | --- | --- | --- | --- |
| 1 | — | `このブラウザで見たページ` |  L81 | — |
| 2 | — | `<p className={trailLabelClassName}>このブラウザで見たページ</p>` |  L82 | — |
| 3 | — | `この一覧はあなたのブラウザの中だけに保存され、サーバーには送信されません。` |  L93 | — |

### `src/home/guide/ledger.ts` — サイト案内 ledger（主要ページ・外部拠点の表示名と説明文）

| # | before | after | 出現 | 既存 record の対応 |
| --- | --- | --- | --- | --- |
| 1 | — | `About — この人について` |  L72 | — |
| 2 | — | `運営者の経歴・考え方・活動の背景。サイト全体の文脈を知りたいときの入口。` |  L73 | pr-943（pending） |
| 3 | — | `Portfolio — 作品` |  L79 | — |
| 4 | — | `公開している制作物の一覧。個別の作品ページへはここから辿る。` |  L80 | pr-943（pending） |
| 5 | — | `作品一覧` |  L85 | — |
| 6 | — | `公開作品の一覧と絞り込み。` |  L86 | — |
| 7 | — | `Dotfiles — 開発環境の設計図` |  L94 | — |
| 8 | — | `日々の開発環境を構成する設定群の紹介。実際のリポジトリと同期して更新される。` |  L95 | pr-943（pending） |
| 9 | — | `Tools — ブラウザで使える小物` |  L101 | — |
| 10 | — | `インストール不要のブラウザツール集。QR 生成・タイマー・変換器など。` |  L102 | pr-943（pending） |
| 11 | — | `Keyboard — キーボードレイアウト` |  L108 | — |
| 12 | — | `現在使っているキーボード配列の一覧と、その配置を確認するリファレンス。` |  L109 | pr-943（pending） |
| 13 | — | `Contact — 連絡先` |  L115 | — |
| 14 | — | `re-verified 済みの連絡手段だけを掲載している窓口。` |  L116 | — |
| 15 | — | `GitHub — ソースと活動` |  L122 | — |
| 16 | — | `リポジトリとコミット履歴の一次情報。サイト内の「現在地」はここから要約している。` |  L123 | pr-943（pending） |

### `src/home/hero.tsx` — ヒーローセクション（キャッチコピー・導入文・リンクラベル）

| # | before | after | 出現 | 既存 record の対応 |
| --- | --- | --- | --- | --- |
| 1 | — | `現在地 / Where I am now` |  L41 | — |
| 2 | — | `個人の Web プラットフォームを、毎日作り直している。` |  L62 | — |
| 3 | — | `完成していないから、毎日更新されている。開発・制作・活動の記録と、公開中のツール、移行中の制作物をこのページに集約しています。` |  L77 | — |

### `src/home/presence/PresenceCard.tsx` — Discord プレゼンスカード（状態・鮮度・未取得表示）

| # | before | after | 出現 | 既存 record の対応 |
| --- | --- | --- | --- | --- |
| 1 | — | `Discordの本人プレゼンス / アクティビティ / リッチプレゼンス / カスタムステータス。運営者が実行するスクリプトで生成された確定スナップショットのみを表示。スナップショットが存在しない / 期限切れ / 検証失敗の場合は「未取得」として安全にデグレードします。` |  L53 | — |
| 2 | — | `<span>Discordプレゼンス: 未取得 (スナップショットが存在しないか、期限切れ/検証失敗)</span>` |  L230 | — |
| 3 | — | `Discord プレゼンス` | ×4 L244,272,400 | — |
| 4 | — | `· ライブ接続` |  L371 | — |
| 5 | — | `· 古いスナップショット` |  L372 | — |

### `src/privacy/data-lifecycle.ts` — 公開データライフサイクル台帳（privacy notice の本文ソース。v0.9.0 で全 11 entry が approved）

| # | before | after | 出現 | 既存 record の対応 |
| --- | --- | --- | --- | --- |
| 1 | — | `Issue #316 で追加した訪問者端末側の保存項目。owner が公開 wording を承認したため公開する。` |  L699 | — |
| 2 | — | `サイト内案内の訪問先一覧（ブラウザの localStorage `mw_home_visit_trail_v1`）` |  L707 | — |
| 3 | — | `このブラウザがこのサイト内で訪れた公開ページのパスを、新しい順に最大 5 件。パス以外の情報（識別子・時刻・検索語・参照元・端末情報）は含みません。`/admin` と `/api` は記録しません。` |  L711 | — |
| 4 | — | `自動失効はありません。キーは訪問者のブラウザにだけ残り、サイトデータを消すまで残ります。サーバーには複製されません。` |  L717 | — |
| 5 | — | `ブラウザのサイトデータ削除で消えます。値は訪問のたびに上書きされるだけなので、削除しなくても表示が壊れることはありません。` |  L724 | — |
| 6 | — | `このキーの値はサーバーへ送信されません。読み書きはブラウザ内で完結します。` |  L731 | — |
| 7 | — | `訪問者本人のブラウザにだけ表示される一覧で、公開ページの SSR 出力にも公開 API にも現れません。` |  L737 | — |
| 8 | — | `src/home/guide/trail.ts (キー名・保存する項目・除外パス・失敗時挙動)` |  L741 | — |
| 9 | — | `src/home/guide/VisitTrailRecorder.tsx (記録は公開ルートのみ・pathname のみ)` |  L742 | — |
| 10 | — | `src/home/guide/VisitTrail.tsx (SSR/初回/ストレージ不可では何も描画しない)` |  L743 | — |
| 11 | — | `src/home/guide/trail.test.ts (正規化・上限・重複・除外の規則)` |  L744 | — |
| 12 | — | `Issue #936 で追加した訪問者端末側の保存項目。owner が公開 wording を承認したため公開する。` |  L749 | — |
| 13 | — | `Discord プレゼンススナップショット（D1 `discord_presence_snapshot`、単一行）` |  L757 | — |
| 14 | — | `運営者本人の Discord アカウントの最新プレゼンス 1 件分:ステータス（online/idle/dnd/offline/unknown）、カスタムステータスの本文と絵文字、アクティビティ/リッチプレゼンスの名前・詳細・状態・時刻・画像キー・パーティ情報、クライアント種別。メッセージ本文・他のギルド参加者のプレゼンス・トークンは含まれません。` |  L761 | — |
| 15 | — | `単一行を最新スナップショットで上書きします。フィードが止まっても行は残り、公開側は `generatedAt` の鮮度チェックで「不明」表示に落ちます。行の削除は運営者の手作業です。` |  L767 | — |
| 16 | — | `公開面から消すには運営者が D1 の行を削除します。訪問者が自分で削除する経路はありません（本人のデータではないため）。` |  L774 | — |
| 17 | — | `保存された値がこのプラットフォームの外へ送信されることはありません。Discord から運営者側スクリプトへの取得は本人のボット連携であり、このデータベースから第三者への送信はありません。` |  L781 | — |
| 18 | — | `ホームのステータス欄に、本人が公開を意図した範囲で表示されます（ステータス・カスタムステータス・アクティビティ名など）。API キーやトークン、他者の情報は公開されません。` |  L787 | — |
| 19 | — | `migrations/0011_discord_presence.sql (単一行テーブル)` |  L791 | — |
| 20 | — | `src/http/presence/schema.ts (受理するフィールドの allowlist)` |  L792 | — |
| 21 | — | `src/http/presence/store.ts (upsert のみ・追記しない)` |  L793 | — |
| 22 | — | `src/home/presence/reader.ts (公開側の再検証と鮮度チェック)` |  L794 | — |
| 23 | — | `scripts/sync-discord-presence.mjs (本人のみ追跡・他者プレゼンスを読まない)` |  L795 | — |
| 24 | — | `Issue #320 で追加した運営者本人のプレゼンス保存項目。owner が公開 wording を承認したため公開する。` |  L800 | — |
| 25 | — | `GitHub アクティビティスナップショット（D1 `github_activity_snapshot`、単一行）` |  L808 | — |
| 26 | — | `運営者の GitHub アクティビティの最新スナップショット 1 件分:公開リポジトリの名前・URL・直近の活動集計とフィード項目、非公開リポジトリは `private-` に続く12桁の16進文字列による安定 ID（名称は公開しません）と集計値のみ（実名・URL・owner・ブランチ・コミットメッセージ・Issue 本文・ハッシュは含まれません）。訪問者の識別子は含まれません。` |  L812 | — |
| 27 | — | `単一行を最新スナップショットで上書きします。同期ジョブが止まっても行は残り、公開側はコミット済みスナップショット（レビュー済みのフォールバック）へ切り替わるか、観測日時の比較で新しい方を表示します。行の削除は運営者の手作業です。` |  L818 | — |
| 28 | — | `公開面から消すには運営者が D1 の行を削除します（削除後はコミット済みスナップショットが表示されます）。訪問者が自分で削除する経路はありません。` |  L825 | — |
| 29 | — | `保存された値がこのプラットフォームの外へ送信されることはありません。GitHub から運営者側スクリプトへの取得は公開 API と運営者自身のトークンによるもので、このデータベースから第三者への送信はありません。` |  L832 | — |
| 30 | — | `ホームの「現在地」セクションに、公開を意図した範囲で表示されます（公開リポジトリの活動と、非公開リポジトリの名称非公開 ID・集計値）。API キー・トークン・非公開リポジトリの実名は公開されません。` |  L838 | — |
| 31 | — | `Rendered on the home “現在地” section within the scope the owner intends to publish (public-repository activity and private-repository name-hidden ids / aggregates). API keys, tokens and private repository names are never published.` |  L839 | — |
| 32 | — | `migrations/0012_github_activity.sql (単一行テーブル)` |  L842 | — |
| 33 | — | `src/http/activity/schema.ts (受理するフィールドの allowlist・private 仮名契約)` |  L843 | — |
| 34 | — | `src/http/activity/store.ts (upsert のみ・追記しない)` |  L844 | — |
| 35 | — | `src/home/activity/live.ts (公開側の再検証と鮮度による選択)` |  L845 | — |
| 36 | — | `scripts/sync-github-activity.mjs (仮名化はシリアライズ前・ソルト未設定は fail-closed)` |  L846 | — |

### removed セグメント（全件）

composer.tsx の 11 件はセクション再構成に伴う**移動**（同一文面が added 側に存在）。
hero.tsx の 7 件はヒーロー文言の**書き換え**。

| path | before | 移動先/性質 |
| --- | --- | --- |
| `src/home/composer.tsx` | `サイトの状態` | 移動（added に同一文面あり） |
| `src/home/composer.tsx` | `このサイトが今動いているか。binding の到達性、ページビュー、訪問者の反応を 1 つの面にまとめています。` | 移動（added に同一文面あり） |
| `src/home/composer.tsx` | `プラットフォームの状態 / Platform health` | 移動（added に同一文面あり） |
| `src/home/composer.tsx` | `みんなの反応 / Reactions` | 移動（added に同一文面あり） |
| `src/home/composer.tsx` | `リアクションは mw_actor_id Cookie で同じブラウザを区別します (Cookie` | 移動（added に同一文面あり） |
| `src/home/composer.tsx` | `を消すと別の訪問者として数えられます)。保存される項目と保持期間はページ下部の「データと保持期間」に記載しています。` | 移動（added に同一文面あり） |
| `src/home/composer.tsx` | `ページビュー / Page views` | 移動（added に同一文面あり） |
| `src/home/composer.tsx` | `各リクエストは短時間ウィンドウ内で重複加算されません。` | 移動（added に同一文面あり） |
| `src/home/composer.tsx` | `Contact / お問い合わせ` | 移動（added に同一文面あり） |
| `src/home/composer.tsx` | `現在 re-verified されている contact channel だけを掲載しています。Channel には用途別の説明が添えてあります。` | 移動（added に同一文面あり） |
| `src/home/composer.tsx` | `<span lang="ja">Contact を見る</span>` | 移動（added に同一文面あり） |
| `src/home/hero.tsx` | `開発・制作・活動をまとめる次の Personal Web Platform を構築しています。Portfolio /` | 削除/書き換え |
| `src/home/hero.tsx` | `content / activity を段階的に移行中です。` | 削除/書き換え |
| `src/home/hero.tsx` | `この 2026 edition は移行途中の public preview` | 削除/書き換え |
| `src/home/hero.tsx` | `です。コンテンツは段階的に公開していきます。` | 削除/書き換え |
| `src/home/hero.tsx` | `<span>About me / 自己紹介</span>` | 削除/書き換え |
| `src/home/hero.tsx` | `<span lang="en">Portfolio</span> を見る` | 削除/書き換え |
| `src/home/hero.tsx` | `<span lang="en">GitHub</span> でソースを見る` | 削除/書き換え |
| `src/privacy/data-lifecycle.ts` | `owner が公開 wording を承認するまで描画しない。事実はここに記録して失わない。` | 削除/書き換え |
| `src/privacy/data-lifecycle.ts` | `Issue #316 で追加した訪問者端末側の保存項目。公開文の承認はまだ受けていないため、レンダリングはしない。` | 削除/書き換え |

## 4. owner が判断するときの確認観点（事実のみ・評価ではない）

- **広告 copy（`src/home/ads/*`）**: Issue #925 系の広告クリエイティブ。公開面の日本語なので gate 対象。
- **privacy 台帳（`src/privacy/data-lifecycle.ts`）**: owner 判断（2026-11-17）で全 11 entry が
  `approved` になり、privacy notice に新たに 5 entry 分の文面が描画される。
  `github-activity-snapshot` は公開前に「匿名 ID」→「名称非公開 ID / name-hidden ids」へ修正済み
  （`UNSUPPORTED_PUBLIC_CLAIMS` の「匿名」禁止と出荷済みカードの「名称非表示」表記に合わせた）。
- **`github-activity.json` の `非公開プロジェクト` ×9**: committed fallback の表示名。
- **composer.tsx**: ほぼ全て移動。新規は GitHub 活動・Discord プレゼンスの見出しと説明。
- **hero.tsx**: キャッチコピー全面書き換え（「構築/移行中」→「作り直し/更新」系）。
- **guide / VisitTrail**: サイト案内・訪問者トレイルの新規 UI 文言。
  「この一覧はあなたのブラウザの中だけに保存され、サーバーには送信されません」は
  client-local 実装（localStorage）と一致。

## 5. この資料の限界

- gate は文字列の機械抽出であり、JSX 式・テンプレートの意味までは見ない。
- `×N` の反復は同一文面の別箇所出現であり、文脈は行番号を参照。
- record の `comparisons` は gate 単位で書く必要がある（pr-619 先例: 120 件）。
- 本資料は承認を推定しない。owner の明示判断と traceable artefact が record の前提。
