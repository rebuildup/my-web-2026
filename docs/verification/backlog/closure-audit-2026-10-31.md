# 2026-10-31 一括クローズ監査（Issue #741）

**監査日**: 2026-11-01
**対象**: 2026-10-31 に `completed` としてクローズされた my-web-2026 の Issue 全件
**台帳**: `quality/issue-closure-ledger.json`
**手順**: `docs/runbook/issue-lifecycle.md`

## 1. 監査母集団と抽出方法

母集団は **132 件** です。GitHub 検索 API で `repo:rebuildup/my-web-2026 is:issue closed:2026-10-31` を実行し、`issueCount` が 132 であること、GraphQL の `pageInfo` で 2 ページ（100 + 32）に分けて **全件** を取得したことで確認しました。10-30 / 11-01 のクローズは 0 件です（`closed:2026-10-30` = 0、`closed:2026-11-01` = 0）。10-31 以外の同日クローズは存在しません。

| 項目 | 実測 |
| --- | --- |
| 母集団 | 132 件 |
| クローズ理由 | 132 件すべて `completed` |
| 同一コメント「回収完了。release-0-8-0統合完了（#679待機中）。」 | **124 件** |
| `closedByPullRequestsReferences` が空の Issue | 131 件 |
| クロellinカされた merged PR が 1 件も無い Issue | **78 件** |
| クローズ実行者 | 132 件すべて `rebuildup`（自動化は owner 資格で実行され、GitHub 上の実行主体と自動判別できない） |

## 2. 判定の基準

各 Issue について、**元の受入条件**と**実際に確認できた成果物**（repository path / PR / commit / URL）を照合し、8 状態の closure vocabulary（`docs/runbook/issue-lifecycle.md` §1）で判定しました。

判定は二段構えです。

1. **機械で集めた証拠**（Issue 本文・全コメント・closing PR 参照・cross-referenced PR・`origin/release-0-8-0` の実ファイル）を集める。
2. **各 Issue を読み、原受入条件と照合して分類する**（分類は Issue 単位で行い、标题からの推測は禁止）。

「PR が merge された」「CI が green」「ドキュメントが書かれた」は、**元の受入条件の達成の証明にはなりません**。逆に「PR が無い」だけでは調査・判断の完了も否定しません。

## 3. 結果

| 状態 | 件数 |
| --- | --- |
| 実装予定・未着手（`planned-unimplemented`） | 86 |
| 実装・実証まで完了（`implemented-and-verified`） | 25 |
| 一部のみ実装済み（`partial`） | 13 |
| 理由を明示して保留（`deferred-with-reason`） | 5 |
| 調査済みで結論あり（`research-complete-with-decision`） | 2 |
| 理由を明示して不採用（`explicitly-rejected-with-reason`） | 1 |

| closure 判定 | 件数 |
| --- | --- |
| クローズは妥当（`supported`） | 28 |
| クローズは不当（`unsupported`） | 93 |
| owner 判断待ち（`awaiting-owner`） | 11 |

**復旧操作**: 102 件を再オープン（うち 11 件は owner 判断待ちとして明示）、30 件はクローズ状態を維持（成果物または後継 Issue で追跡可能）。再オープンした Issue には、元の受入条件・確認できた成果物・不足しているもの・判断が owner 権限であることを書いたコメントを 1 件ずつ付けています。**元の本文と元のクローズコメントは削除していません。**

### 3.1 重点調査対象の結果

| Issue | 状態 | 事実 |
| --- | --- | --- |
| #274 Codex ペット | 実装予定・未着手 | キャラクター素材・アニメーション・表示位置・reduced-motion 対応・権利確認のいずれも未実装。 |
| #315〜#322 「現在地」Home | 実装予定・未着手（#317/#318/#320/#321/#322 は owner 判断待ち） | `origin/release-0-8-0:src/home/composer.tsx` に「現在地」の見出し・区画は存在しない（実測: 一致 0 件）。 |
| #323〜#329 `/content` 一覧・詳細・ミラー・RSS・JSON Feed・Markdown 配信・JSON API | 実装予定・未着手 | `src/routes/` に `/content` 系ルートは存在しない。 |
| #330 / #331 Notion CMS | 実装予定・未着手（owner 判断待ち） | `docs/domain/integrations.md:18` は Notion を **uncommitted**、「current code evidence なし」と明記。 |
| #334 activity（Issue/PR 可視化）/ #352 活動タイムライン | 実装予定・未着手 | 該当する公開面・reader が存在しない。 |
| #512〜#535 制作思想・興味・ Peggycorn 案などの docs 系 | 個別に判定 | #512/#513/#514/#516/#520/#521/#525/#527/#528/#533 は成果物（docs + preview + 検証記録）が存在しクローズ妥当。**#517（見てて楽しいの比較）・#535（制作哲学の編集記事試作）は未実装**。 |

### 3.2 クローズを妥当と判断した主な根拠

- **merge 済み PR が受入条件を満たす**（#392 PR #694 / #408 PR #699 / #515 PR #711 / #527 PR #717 / #700 PR #706 / #709 PR #710 / #730 PR #731 / #726 PR #727 / #728 PR #729 / #734 PR #735 / #737 PR #738 / #704 PR #707 / #724 PR #725 / #402 / #406 / #380 / #669 / #701 / #702）
- **docs 系は成果物が文書として存在する**（#513 `docs/personal/growth-through-making.md`、#516 `docs/vision/audience-purpose-separation.md`、#520 `docs/visual/flat-vs-depth-review.md`、#521 `docs/brand/361do-name-meanings.md`、#525 `docs/influences/music-connections.md`、#528 `docs/influences/tech-interests.md`）
- **判断理由が記録されている**（#254 ローカル workerd -pool 原因特定、#258 診断記録、#424 ADR-0017 で yomiyasu を理由つき却下）
- **後継 Issue が元要求和を追跡**（#62 → #647、#385 → #384、#401 → PR #698）

## 4. 一括クローズの根本原因

**確定した事実**（いずれも API の実測に基づく）:

1. **クローズの理由が「完了」で統一されていた**（132/132 `completed`）。「保留」「不採用」を示す `not planned` は 0 件。
2. **同一テンプレートコメントが 124 件**に付いていた。コメントの主張は「release-0-8-0 統合済み」であり、**Issue 自身の受入条件について述べていない**。
3. **131 件に closing PR 参照がない**。78 件には merged cross-reference PR すら存在しない。つまり統合を根拠にできない Issue が大半であるにもかかわらず、「統合完了」のコメントが書かれていた。
4. **実行者は全件 `rebuildup`**（owner 資格）。自動化が owner 資格で動いていたため、GitHub の履歴上は owner の判断と区別できない。
5. **クローズは 17 時間にわたって続いた**（02:32 UTC 〜 19:48 UTC）。単一の瞬時スクリプトではなく、**回収処理が Issue を 1 件ずつ閉じていた**。

**根本原因（推定ではなく、上の 1〜5 から必然的に導かれるもの）**:

- **運用ルールに「完了」の定義が無く、Issue 単位の受入条件照合の手順が存在しなかった**。その穴を埋めようとしたのが回収スウィープであり、判定基準は「release ブランチに統合されているか」だけになってしまいました。
- そのため **「backlog 回収」と「実装完了」が同一の操作として実行された**。
- 結果として **未実装の構想・研究待ちの構想・採用判断待ちの構想が、完了済みとして管理対象から消えた**。

**運用ルール側の原因（リポジトリ内の記録から確定できるもの）**: 2026-11-01 時点の `skills/github-delivery/SKILL.md` には、sprint cycle の手順 12 として「target release trunkへlandしたticketのlinked Issueを明示的にcloseし、Project statusをDoneへ更新する」と書かれており、一括landing時の指示は「landing後に各Issue/Project stateを明示的にreconcileする」だけでした。Done 条件には「acceptance criteria satisfied」が挙がっていましたが、**それを確認する手順も、その記録を残す場所も定義されていませんでした**。「release trunk へ land した」ことが手元の完了根拠として使える形になっていたため、回収スウィープは**手順に従って動けます**。DRY な言い換えではなく、実行可能で有害な隙間はここにあります。修正は `skills/github-delivery/SKILL.md`（Done 条件・一括landing条項・手順 12）へ入れ、AGENTS.md §10 の fork table にその独自差分として記録しました。

**断定できない部分**: 実行した主体がどのエージェント／手順だったかは、**リポジトリ内に記録が残っていない**ため特定できません（`scripts/` に該当スクリプトなし、10-31 の commit にも回収処理の記録なし）。GH Actions の該当 run もありません。分かるのは「owner 資格で、テンプレートコメントで、17 時間にわたってクローズされた」という事実だけです。

## 5. 再発防止（実装済み）

| 施策 | 中身 | 検証 |
| --- | --- | --- |
| 状態の語彙 | 8 状態の closure vocabulary を `docs/runbook/issue-lifecycle.md` §1 に定義 | `scripts/check-issue-closure.test.mjs` |
| 台帳 | `quality/issue-closure-ledger.json`（132 件の per-Issue 記録） | `pnpm run issue:closure:check` |
| オフライン gate | `scripts/check-issue-closure.mjs`（状態・証拠・判断理由・著作者の整合、テンプレートコメントを証拠として拒否 = E006） | `node --test scripts/check-issue-closure.test.mjs` |
| リモート gate | `scripts/check-issue-closure-remote.mjs`（GitHub の各 Issue の現在状態とクローズ時の追跡を直接読み、台帳と食い違えば R002/R003/R004/R005、**台帳に記録が無くかつ追跡も無い**クローズを R001、**同一テンプレートで一括クローズされた**群を R006 として検出）。R005 は Issue #815 で監査窓の整合（entry が窓に属する・窓の範囲内・frozen 窓の件数一致・窓の非重複）を検査する規則へ再定義された | `node --test scripts/check-issue-closure-remote.test.mjs` |
| プロジェクト契約 | AGENTS.md §6「Issue closure requires evidence」 | `node --test scripts/_quality-gate-plan.test.mjs` |
| 運用手順の修正 | `skills/github-delivery/SKILL.md`（Done 条件・一括landing条項·sprint cycle 手順 12）に「受け入れ条件の証拠を確認・記録してから close する」を追加。回収スウィープが「手順に従って動ける」隙間を塞ぐ | `scripts/check-content-links.mjs` / 手動確認（§4「運用ルール側の原因」） |
| CI | `.github/workflows/ci.yml` に `Issue closure audit` ステップ（network が必要なため CI only。dependency advisory gate と同じ方式） | actionlint / `pnpm run lint:ci` |

**この gate だけでは防げなかったもの**: オフライン gate だけなら 2026-10-31 の sweep は**素通りしていた**（リポジトリに記録を一切書かなかったため）。GitHub 側のクローズ実績と照合するのは、リモート gate 側です。

### 5.1 「追跡」の定義とその実測検証

追跡 = **読者が開ける痕跡**。具体的には (a) 当該 Issue を参照した **commit**、(b) 成果物（PR / commit / URL）を名指しする**コメント**、(c) 保留・重複・却下・延期のような**判断理由が書かれたコメント**。(a) の根拠は Issue の timeline（`ReferencedEvent` / `CrossReferencedEvent`）です。

**参照された PR 、単体では追跡に数えません。** 監査の基準そのもので「PR が merge された」は受入条件の達成の証明にならないからです。この判断は推測ではなく、**2026-10-31 時点の 132 件を再構成して実測**しました（ Issue の timeline / コメントの `createdAt` で 2026-10-31 23:59 UTC 以前を切り、再発防止の判定と一緒に照合）:

| 判定 | ゲートが通過 | ゲートが検出 | 合計 |
| --- | --- | --- | --- |
| クローズ妥当（`supported`） | 25 | 3 | 28 |
| クローズ不当（`unsupported`） | 9 | **84** | 93 |
| owner 判断待ち（`awaiting-owner`） | 3 | **8** | 11 |

- 危害を受ける側（不当 + 判断待ち = 104 件）中 **92 件を検出**（88%）。
- 妥当と監査した 28 件のうち **25 件を通過**（誤検出 3 件 = 11%）。
- 対照実験として「merge 済み PR の参照」を追跡に数えると、132 件中 **57 件**しか検出できません（44%）。これが PR 参照を採らない理由です。

**R006（一括クローズ検出）**: 同じクローズコメントを共有する Issue が 5 件以上まとまり、そのコメントがリリース枝の定型（「回収完了」「統合完了」「一括クローズ」）に一致する場合に検出します。**Issue 単位の証拠が偶然残っていても、一括操作そのものを検出する**ためです。台帳が Issue ごとに記録している場合は該当しません（台帳が per-Issue 記録そのものなので）。

### 5.2 実運用での誤検出（実測）

2026-10-01 以降のクローズ **232 件**をこの定義で走査した結果:

| ウィンドウ | 検出数 | 内容 |
| --- | --- | --- |
| 台帳の監査日以降（CI が使う既定） | **0** | — |
| 2026-10-01 以降（広め） | **1** | #165（2026-10-02 クローズ、PR #217 の merge 4 分後に手動クローズ、**コメントなし**） |

#165 は「誤検出」ではなく、**記録が残っていなかったクローズの正しい指摘**です（クローズ自体は妥当）。監査母集団（2026-10-31 の 132 件）の外側なので台帳には入れておらず、CI の既定ウィンドウでも検出されません。広めのウィンドウを走らせたときだけ現れます。

## 6. Miro 原典について（未達・owner 作業）

Miro ボード `https://miro.com/app/board/uXjVEZdqDp4=/` は**認証なしでは内容を読み取れません**（アプリシェルのみが返る）。本監査では Miro の付箋を一件ずつ確認できていません。

- **実施したこと**: Issue #534（`docs(backlog): Miro付箋とGitHub Issueの対応表・未回収理由を整備`）の受入条件と要求を読み、GitHub 側の母集団（132 件）を全件照合し、#534 が要求する**対応表の成果物がリポジトリに存在しない**ことを確認しました（`docs/verification/backlog/` は本監査で新規作成）。
- **実施できていないこと**: 571 付箋の 1 件ずつの追跡先の特定。**原典にアクセスできない以上、追跡先を確定できません**（推測で埋めることはしません）。
- **必要な owner 作業**: Miro のエクスポート（付箋 + 接続 + 位置）を 1  回共有いただくか、Miro API の読み取り token を許可いただくこと。#534 は **open のまま** 残します（対応表という成果物が必要なため）。
- なお、GitHub 側の 132 件は Miro 由来を含む **追跡可能な保管** であり、本監査の復旧で失われた構想は Issue 上で追跡可能になっています。

## 7. per-Issue 一覧

`closure` 列: `supported` = クローズ妥当、`unsupported` = クローズ不当、`awaiting-owner` = owner 判断待ち。
`action` 列: `kept-closed` = クローズ維持、`reopened` = 再オープン。

| Issue | タイトル | 状態 | closure | action | 根拠（抜粋） |
| --- | --- | --- | --- | --- | --- |
| [#6](https://github.com/rebuildup/my-web-2026/issues/6) | chore: add .env.example stub for Cloudflare bindings | 一部のみ実装済み | unsupported | reopened | `#6`, `#7` |
| [#18](https://github.com/rebuildup/my-web-2026/issues/18) | 依存監視とツールチェーン互換性の保守計画を確定する | 実装予定・未着手 | unsupported | reopened | `dependabot.yml`, `git grep 'dependency-review|dependency_review' .github/ は 0 件（宣言だけの実検査なし）` |
| [#60](https://github.com/rebuildup/my-web-2026/issues/60) | feat(editorial): 361do-axis の precision-first token model を選 | 実装予定・未着手 | unsupported | reopened | `git grep '361do-axis' origin/release-0-8-0 -- . : no hit anywhere in the release tree (no audit record, no adopt/reject/hold list)`, `src/editorial/semantic-tokens.ts` |
| [#61](https://github.com/rebuildup/my-web-2026/issues/61) | feat(brand): 361do-axis の samuido brand assets を personal id | 実装予定・未着手 | awaiting-owner | reopened | `docs/brand/361do-name-meanings.md`, `#61` |
| [#62](https://github.com/rebuildup/my-web-2026/issues/62) | project-init 0.3.0 を適用する | 実装予定・未着手 | unsupported | kept-closed | `#63`, `AGENTS.md` |
| [#70](https://github.com/rebuildup/my-web-2026/issues/70) | infra: ADR-0015 Phase 4 — Cloudflare Workers Builds Infisica | 一部のみ実装済み | unsupported | reopened | `scripts/deploy-with-secrets.mjs`, `scripts/check-cf-secrets.mjs` |
| [#202](https://github.com/rebuildup/my-web-2026/issues/202) | chore(deps): Panda CSS v2へアップグレード | 理由を明示して保留 | awaiting-owner | reopened | `package.json`, `Issue comment 2026-10-19: supervision decision to defer to v0.8.0, with the measured 'presets not auto-injected in v2 ⇒ silent CSS failure' reasoning` |
| [#247](https://github.com/rebuildup/my-web-2026/issues/247) | refactor(cloudflare): Wrangler を全面排除し cf CLI + cloudflare.co | 一部のみ実装済み | unsupported | reopened | `cloudflare.config.ts`, `#247` |
| [#254](https://github.com/rebuildup/my-web-2026/issues/254) | ローカルで vitest の workerd pool が起動しない（CI は green） | 調査済みで結論あり | supported | kept-closed | `issue #254 comments (2026-10-05, 2026-10-08)`, `scripts/_d1.mjs` |
| [#258](https://github.com/rebuildup/my-web-2026/issues/258) | #253 の診断は stale — 実際の release-0-6-0 blocker は E2E の D1 migra | 調査済みで結論あり | supported | kept-closed | `scripts/e2e-local-bootstrap.mjs`, `scripts/_d1.mjs` |
| [#265](https://github.com/rebuildup/my-web-2026/issues/265) | [SECURITY] infisical-bootstrap-cf が部分 bind 環境の再実行ごとに revoke  | 一部のみ実装済み | unsupported | reopened | `scripts/infisical-bootstrap-cf.mjs`, `#265` |
| [#274](https://github.com/rebuildup/my-web-2026/issues/274) | feat: Codex ペットのキャラクターとアニメーションを Web でも再利用する | 実装予定・未着手 | unsupported | reopened | `src/home/composer.tsx`, `portfolio/seed.ts` |
| [#315](https://github.com/rebuildup/my-web-2026/issues/315) | feat(home): 「現在地」を中心にしたトップの情報階層を実装 | 実装予定・未着手 | unsupported | reopened | `src/home/composer.tsx`, `docs/domain/capabilities.md` |
| [#316](https://github.com/rebuildup/my-web-2026/issues/316) | feat(home): 進行中プロジェクトの編集可能なスナップショット表示 | 実装予定・未着手 | unsupported | reopened | `src/home/composer.tsx`, `src/home/capabilities/registry.ts` |
| [#317](https://github.com/rebuildup/my-web-2026/issues/317) | feat(home): 公開予定のカレンダーを現在地エリアに表示 | 実装予定・未着手 | awaiting-owner | reopened | `src/home/composer.tsx`, `git grep -ln "calendar" -- src/ — カレンダー表示や取得処理の該当なし` |
| [#318](https://github.com/rebuildup/my-web-2026/issues/318) | spike(home): 「看板×地図」の位置コンテキスト表示を検証 | 実装予定・未着手 | awaiting-owner | reopened | `src/home/composer.tsx`, `closing PR references: [] / Cross-referenced PRs: []` |
| [#319](https://github.com/rebuildup/my-web-2026/issues/319) | feat(home): GitHubの公開開発ステータスを表示 | 実装予定・未着手 | unsupported | reopened | `src/home/composer.tsx`, `docs/domain/integrations.md` |
| [#320](https://github.com/rebuildup/my-web-2026/issues/320) | spike(home): Discordオンライン表示の許可済みデータ経路を実証 | 実装予定・未着手 | awaiting-owner | reopened | `docs/domain/integrations.md`, `src/http/integrations/boundary.test.ts` |
| [#321](https://github.com/rebuildup/my-web-2026/issues/321) | feat(home): Xの公開投稿を選別して現在地に掲載 | 実装予定・未着手 | awaiting-owner | reopened | `src/home/composer.tsx`, `closing PR references: [] / Cross-referenced PRs: []` |
| [#322](https://github.com/rebuildup/my-web-2026/issues/322) | feat(home): Discordの公開告知を現在地に1件表示 | 実装予定・未着手 | awaiting-owner | reopened | `docs/domain/integrations.md`, `src/home/composer.tsx` |
| [#323](https://github.com/rebuildup/my-web-2026/issues/323) | feat(content): /content に記事一覧と公開状態の表示を実装 | 実装予定・未着手 | unsupported | reopened | `src/routes/ に content 配下のルートが存在しない（ls src/routes/ 19件、content ファイルなし）`, `src/home/capabilities/registry.ts` |
| [#324](https://github.com/rebuildup/my-web-2026/issues/324) | feat(content): Markdown記事詳細と画像パス解決を実装 | 実装予定・未着手 | unsupported | reopened | `src/routes/ に content 配下のルートが存在しない`, `src/content/ ディレクトリが存在しない` |
| [#325](https://github.com/rebuildup/my-web-2026/issues/325) | feat(content): rebuildup/my-blog の公開記事をビルド時自動ミラー | 実装予定・未着手 | unsupported | reopened | `git grep -ln "my-blog" -- src/ scripts/ — 該当なし（ミラー処理・ submodule 定義なし）`, `src/routes/ に content 配下のルートが存在しない` |
| [#326](https://github.com/rebuildup/my-web-2026/issues/326) | feat(content): RSS 2.0フィードを公開 | 実装予定・未着手 | unsupported | reopened | `git grep -ln "feed.xml" -- src/ scripts/ — 該当なし`, `git grep -ln "rss" -- src/ scripts/ — 該当なし` |
| [#327](https://github.com/rebuildup/my-web-2026/issues/327) | feat(content): JSON Feedを公開 | 実装予定・未着手 | unsupported | reopened | `feed.json`, `src/routes/ に feed 系のルートが存在しない` |
| [#328](https://github.com/rebuildup/my-web-2026/issues/328) | feat(content): 公開記事にMarkdown原文の取得リンクを付ける | 実装予定・未着手 | unsupported | reopened | `src/routes/ に content 配下のルートが存在しない（.md 配信ルートの痕跡なし）`, `git grep -ln "text/markdown" -- src/ — 該当なし` |
| [#329](https://github.com/rebuildup/my-web-2026/issues/329) | feat(content): 公開コンテンツのJSON API読み取りエンドポイント | 実装予定・未着手 | unsupported | reopened | `git grep -ln "api/v1/content" -- src/ — 該当なし`, `src/http/ に content 配下のAPIディレクトリが存在しない` |
| [#330](https://github.com/rebuildup/my-web-2026/issues/330) | feat(content): Notionの承認済み1記事をCMSソースとして表示 | 実装予定・未着手 | awaiting-owner | reopened | `docs/domain/integrations.md`, `src/http/integrations/boundary.test.ts` |
| [#331](https://github.com/rebuildup/my-web-2026/issues/331) | feat(content): Notion記事の再同期・差分更新ステータスを表示 | 実装予定・未着手 | awaiting-owner | reopened | `docs/domain/integrations.md`, `git grep -ln "notion" -- src/ — 連携・再同期コードなし` |
| [#332](https://github.com/rebuildup/my-web-2026/issues/332) | feat(projects): pc-setup READMEの公開紹介ページを自動生成 | 実装予定・未着手 | unsupported | reopened | `dotfiles.json`, `projects.pc-setup.tsx` |
| [#333](https://github.com/rebuildup/my-web-2026/issues/333) | feat(projects): project-init READMEの公開紹介ページを自動生成 | 実装予定・未着手 | unsupported | reopened | `src/routes/projects.dotfiles.tsx`, `dotfiles.json` |
| [#334](https://github.com/rebuildup/my-web-2026/issues/334) | feat(activity): 公開Issue/PRの動きを読み取り専用で可視化 | 実装予定・未着手 | unsupported | reopened | `src/ に activity 系の所有者ディレクトリ／モジュールが存在しない（ls src/ に activity なし、src/home/ にも activity なし）`, `src/external-api/ExternalReadCard.tsx` |
| [#335](https://github.com/rebuildup/my-web-2026/issues/335) | feat(design-system): Storybookビルドの公開ショーケース導線 | 実装予定・未着手 | unsupported | reopened | `src/routes/ on origin/release-0-8-0 contains no storybook route (about, admin.*, contact, design-system, index, keyboard, portfolio, projects.dotfiles, tools.* only)`, `check-storybook-ownership.mjs` |
| [#336](https://github.com/rebuildup/my-web-2026/issues/336) | feat(activity): GitHub Releasesからサイト更新履歴を表示 | 実装予定・未着手 | unsupported | reopened | `src/routes/ に activity 系ルートは存在しない (index / about / contact / keyboard / portfolio / projects.dotfiles / tools のみ)`, `git grep -ln "releases-list" → ヒットなし` |
| [#337](https://github.com/rebuildup/my-web-2026/issues/337) | feat(portfolio): 公開済み制作物の無料ダウンロード導線を追加 | 実装予定・未着手 | unsupported | reopened | `PortfolioDetail.tsx`, `PortfolioMedia.tsx` |
| [#338](https://github.com/rebuildup/my-web-2026/issues/338) | feat(i18n): ja/en の言語別ルーティングとHTML langを導入 | 実装予定・未着手 | unsupported | reopened | `src/routes/ に /en 配下のルートが存在しない（git ls-tree origin/release-0-8-0 -- src/routes/ にも locale ルートなし）`, `src/http/seo/README.md` |
| [#339](https://github.com/rebuildup/my-web-2026/issues/339) | feat(i18n): 言語切替UIを追加し同等ページへの導線を維持 | 実装予定・未着手 | unsupported | reopened | `git grep 'LanguageSwitcher|localeSwitch|言語切替' origin/release-0-8-0 -- src/ : no hit`, `copy/resources.json` |
| [#340](https://github.com/rebuildup/my-web-2026/issues/340) | feat(i18n): Home/About の英語コンテンツを実体として追加 | 実装予定・未着手 | unsupported | reopened | `copy/resources.json`, `src/routes/ にロケール付きルートなし (例 /en, /about/en)` |
| [#341](https://github.com/rebuildup/my-web-2026/issues/341) | feat(i18n): 韓国語のHome/Aboutとロケール別フォントを追加 | 実装予定・未着手 | unsupported | reopened | `unicode.ts`, `slug-identity.ts` |
| [#342](https://github.com/rebuildup/my-web-2026/issues/342) | feat(i18n): 中国語（簡体字） zh-Hans のHome/About翻訳を追加 | 実装予定・未着手 | unsupported | reopened | `src/i18n/ に locale 文字列・翻訳データが存在しない（src/i18n/ は unicode/slug/glyph/pseudo-locale/router-path のみ）`, `cjk-line-break.webp` |
| [#343](https://github.com/rebuildup/my-web-2026/issues/343) | feat(i18n): 中国語（繁体字） zh-Hant のHome/About翻訳を追加 | 実装予定・未着手 | unsupported | reopened | `copy/resources.json`, `src/editorial/cjk-line-break.tsx` |
| [#344](https://github.com/rebuildup/my-web-2026/issues/344) | feat(i18n): ドイツ語 de のHome/About翻訳を追加 | 実装予定・未着手 | unsupported | reopened | `copy/resources.json`, `src/routes/ に /de 系ルートなし` |
| [#345](https://github.com/rebuildup/my-web-2026/issues/345) | feat(i18n): フランス語 fr のHome/About翻訳を追加 | 実装予定・未着手 | unsupported | reopened | `No fr route or fr copy in src/routes or src/i18n (grep for 'fr' locale content returns nothing beyond slug fixtures)`, `src/i18n/glyphs.fixture.ts` |
| [#346](https://github.com/rebuildup/my-web-2026/issues/346) | feat(i18n): スペイン語 es のHome/About翻訳を追加 | 実装予定・未着手 | unsupported | reopened | `src/i18n/ に es の文字列・翻訳データが存在しない`, `docs/verification/i18n/ に es の撮影・記録が存在しない` |
| [#347](https://github.com/rebuildup/my-web-2026/issues/347) | feat(i18n): ポルトガル語 pt のHome/About翻訳を追加 | 実装予定・未着手 | unsupported | reopened | `copy/resources.json`, `src/i18n/glyphs.fixture.ts` |
| [#348](https://github.com/rebuildup/my-web-2026/issues/348) | feat(i18n): イタリア語 it のHome/About翻訳を追加 | 実装予定・未着手 | unsupported | reopened | `copy/resources.json`, `src/routes/ に /it 系ルートなし` |
| [#349](https://github.com/rebuildup/my-web-2026/issues/349) | feat(i18n): ロシア語 ru のHome/About翻訳を追加 | 実装予定・未着手 | unsupported | reopened | `No ru route or ru copy in src/routes or src/i18n`, `src/i18n/glyphs.fixture.ts` |
| [#350](https://github.com/rebuildup/my-web-2026/issues/350) | feat(i18n): hreflang・canonical・サイトマップを言語別に整合 | 実装予定・未着手 | unsupported | reopened | `src/http/seo/sitemap.ts`, `src/http/seo/sitemap.test.ts` |
| [#351](https://github.com/rebuildup/my-web-2026/issues/351) | feat(i18n): 言語別フォント遅延ロードとFOIT/FOUT比較を実装 | 一部のみ実装済み | unsupported | reopened | `src/styles.css:98-125 — global @font-face for Noto Sans JP / 'Noto Sans JP Fallback' loaded for every visitor (no per-locale conditional loading)`, `docs/verification/perf/font-firstpaint-snapshot.webp` |
| [#352](https://github.com/rebuildup/my-web-2026/issues/352) | feat(activity): release・記事・制作物を統合する活動タイムライン | 実装予定・未着手 | unsupported | reopened | `src/routes/ に /activity ルートなし`, `src/ に activity タイムラインの component / fixture は存在しない` |
| [#353](https://github.com/rebuildup/my-web-2026/issues/353) | feat(tools): テキストカウンター をhost_disabledから利用可能なWeb Toolへ統合 | 理由を明示して保留 | unsupported | reopened | `src/tools/manifest.json` |
| [#354](https://github.com/rebuildup/my-web-2026/issues/354) | feat(tools): 円周率暗記ゲーム をhost_disabledから利用可能なWeb Toolへ統合 | 実装予定・未着手 | unsupported | reopened | `src/tools/manifest.json`, `docs/verification/tools/ ディレクトリが存在せず、必須スクリーンショットも未作成` |
| [#355](https://github.com/rebuildup/my-web-2026/issues/355) | feat(tools): QR Code Generator をhost_disabledから利用可能なWeb Tool | 実装予定・未着手 | unsupported | reopened | `src/tools/manifest.json`, `slug.tsx` |
| [#356](https://github.com/rebuildup/my-web-2026/issues/356) | feat(tools): SVG to TSX をhost_disabledから利用可能なWeb Toolへ統合 | 実装予定・未着手 | unsupported | reopened | `src/tools/manifest.json` |
| [#357](https://github.com/rebuildup/my-web-2026/issues/357) | feat(tools): 連番PNGビューア をhost_disabledから利用可能なWeb Toolへ統合 | 理由を明示して保留 | unsupported | reopened | `src/tools/manifest.json`, `disabled_reason: 'Tool is currently a Next.js component library. Embedding blocked until the Tool repo adds a standalone Vite build path.'` |
| [#358](https://github.com/rebuildup/my-web-2026/issues/358) | feat(tools): Pomodoro Timer をhost_disabledから利用可能なWeb Toolへ統合 | 実装予定・未着手 | unsupported | reopened | `src/tools/manifest.json`, `docs/verification/tools/ ディレクトリが存在しない` |
| [#359](https://github.com/rebuildup/my-web-2026/issues/359) | feat(tools): 穴埋めプリントジェネレーター をhost_disabledから利用可能なWeb Toolへ統合 | 実装予定・未着手 | unsupported | reopened | `src/tools/manifest.json`, `no /tools/fillgen artifact or route adapter in src/routes/` |
| [#360](https://github.com/rebuildup/my-web-2026/issues/360) | feat(tools): マイクレベルチェッカー をhost_disabledから利用可能なWeb Toolへ統合 | 実装予定・未着手 | unsupported | reopened | `src/tools/manifest.json` |
| [#361](https://github.com/rebuildup/my-web-2026/issues/361) | feat(tools): CodeType / p5.js素材 をhost_disabledから利用可能なWeb Too | 理由を明示して保留 | unsupported | reopened | `src/tools/manifest.json`, `disabled_reason: 'Tool is currently a Next.js component library. Embedding blocked until the Tool repo adds a standalone Vite build path.'` |
| [#362](https://github.com/rebuildup/my-web-2026/issues/362) | feat(about): 関心のつながりから関連作品へ移動できる導線 | 実装予定・未着手 | unsupported | reopened | `src/about/data.ts`, `src/about/ のコンポーネント群に「関心→作品へ移動する導線」の component がない` |
| [#363](https://github.com/rebuildup/my-web-2026/issues/363) | feat(about): 好きな作家・技術者を分野別の参照集として表示 | 実装予定・未着手 | unsupported | reopened | `src/about/data.ts`, `docs/influences/music-connections.md` |
| [#364](https://github.com/rebuildup/my-web-2026/issues/364) | feat(portfolio): 映像作品のYouTube型プレイヤー表示を実装 | 実装予定・未着手 | unsupported | reopened | `src/portfolio/components/PortfolioMedia.tsx`, `reduced-motion.ts` |
| [#365](https://github.com/rebuildup/my-web-2026/issues/365) | feat(portfolio): 制作分野を横断する関連作品リンク | 実装予定・未着手 | unsupported | reopened | `grep -i 'related' over src/portfolio and src/routes/portfolio returns no match`, `src/portfolio/components/ contains no related-work component (only FacetFilter, ProjectCard, PortfolioDetail, PortfolioMedia, EmptyState, Markdown)` |
| [#366](https://github.com/rebuildup/my-web-2026/issues/366) | feat(portfolio): デザイン制作のビジュアルケーススタディ表示 | 実装予定・未着手 | unsupported | reopened | `src/portfolio/components/ は EmptyState/FacetFilter/Markdown/PortfolioDetail/PortfolioList/PortfolioMedia/ProjectCard のみで、design 専用レイアウト component がない`, `docs/verification/portfolio/ ディレクトリが存在しない` |
| [#367](https://github.com/rebuildup/my-web-2026/issues/367) | feat(contact): 相互リンクの公開ディレクトリを追加 | 実装予定・未着手 | unsupported | reopened | `channels.json`, `schema.ts` |
| [#368](https://github.com/rebuildup/my-web-2026/issues/368) | spike(contact): 映像・デザイン・開発依頼の受付状態を明示するUI | 実装予定・未着手 | unsupported | reopened | `src/contact/channels.json`, `src/contact/page.tsx` |
| [#369](https://github.com/rebuildup/my-web-2026/issues/369) | spike(contact): 依頼料金シミュレーターを公開前プレビューで検証 | 実装予定・未着手 | unsupported | reopened | `channels.json`, `filter.test.ts` |
| [#370](https://github.com/rebuildup/my-web-2026/issues/370) | feat(privacy): 公開ページのCookie/プライバシー説明への導線を監査・実装 | 一部のみ実装済み | unsupported | reopened | `src/privacy/data-lifecycle.ts`, `#496` |
| [#371](https://github.com/rebuildup/my-web-2026/issues/371) | spike(graphics): WebGPU / Three.jsによる独立した作品表示を検証 | 実装予定・未着手 | unsupported | reopened | `docs/verification/standards/browser-baseline.md`, `src/tools/manifest.json` |
| [#372](https://github.com/rebuildup/my-web-2026/issues/372) | spike(graphics): p5.jsのインタラクティブ作品表示を検証 | 実装予定・未着手 | unsupported | reopened | `package.json`, `src/personal/tech-interests/TechInterests.preview.ts` |
| [#373](https://github.com/rebuildup/my-web-2026/issues/373) | feat(editorial): 意味のある操作状態だけを動かすモーション試作 | 実装予定・未着手 | unsupported | reopened | `reduced-motion.ts`, `reduced-motion.test.tsx` |
| [#374](https://github.com/rebuildup/my-web-2026/issues/374) | feat(media): PortfolioのWebP画像表示と最適化fallbackを実証 | 実装予定・未着手 | unsupported | reopened | `src/portfolio/components/PortfolioMedia.tsx`, `#486` |
| [#375](https://github.com/rebuildup/my-web-2026/issues/375) | feat(media): 動画作品のWebM配信と互換fallbackを検証 | 実装予定・未着手 | unsupported | reopened | `src/editorial/reduced-motion.ts`, `src/home/access/reduced-motion.stories.tsx` |
| [#376](https://github.com/rebuildup/my-web-2026/issues/376) | perf(home): Lighthouse 95目標に対し実画面の1件のボトルネックを修正 | 実装予定・未着手 | unsupported | reopened | `quality/route-coverage.json`, `#384` |
| [#377](https://github.com/rebuildup/my-web-2026/issues/377) | feat(dev): ローカル開発の本番API・モック切替を見える化 | 一部のみ実装済み | unsupported | reopened | `index.ts`, `fixtures.ts` |
| [#378](https://github.com/rebuildup/my-web-2026/issues/378) | spike(editorial): SVG装飾記号とアイコンフォントの役割を比較 | 実装予定・未着手 | unsupported | reopened | `src/editorial/ の story は tokens/table-code/glyph-headings/cjk-line-break/language-of-parts/pseudo-locale-stress のみで、SVG vs アイコンフォント比較 story がない`, `git grep 'icon-font|iconfont|Material Icons|svg-icon' -- src/ docs/ は 0 件` |
| [#379](https://github.com/rebuildup/my-web-2026/issues/379) | spike(i18n): 特殊文字表現の画像化案とテキスト代替を比較 | 実装予定・未着手 | unsupported | reopened | `git grep -i '画像化' origin/release-0-8-0 -- docs/ src/ : no hit`, `font-image-option.png` |
| [#380](https://github.com/rebuildup/my-web-2026/issues/380) | feat(platform): 機能独立のUI Preview契約をStorybookに導入 | 実装・実証まで完了 | supported | kept-closed | `storybook/main.ts`, `storybook/preview.ts` |
| [#381](https://github.com/rebuildup/my-web-2026/issues/381) | feat(stack): Webサイトの開発スタックを説明する独立ページを追加 | 実装予定・未着手 | unsupported | reopened | `index.tsx`, `about.tsx` |
| [#382](https://github.com/rebuildup/my-web-2026/issues/382) | feat(stack): Biome設定とフォーマット変換例を技術ページに掲載 | 実装予定・未着手 | unsupported | reopened | `src/routes/ に /stack ルートが存在しない（git ls-tree origin/release-0-8-0 -- src/routes/ に stack なし）`, `git grep '/stack' -- docs/ src/ は 0 件` |
| [#383](https://github.com/rebuildup/my-web-2026/issues/383) | feat(stack): CI・テスト・デプロイ工程の可視化ページを追加 | 実装予定・未着手 | unsupported | reopened | `src/routes/ on origin/release-0-8-0 has no stack route (index, about, admin.*, contact, design-system, keyboard, portfolio, projects.dotfiles, tools.* only)`, `quality-gates.png` |
| [#384](https://github.com/rebuildup/my-web-2026/issues/384) | ci(quality): 全release候補のLighthouse測定を再現可能なコマンドにする | 実装予定・未着手 | unsupported | reopened | `quality/route-coverage.json`, `#384` |
| [#385](https://github.com/rebuildup/my-web-2026/issues/385) | ci(release): Lighthouse PC/モバイル95目標の必須release gateを実装 | 実装予定・未着手 | unsupported | reopened | `package.json`, `quality/profile.yaml` |
| [#386](https://github.com/rebuildup/my-web-2026/issues/386) | ci(release): Core Web Vitals/初期表示速度budgetをreleaseで検証 | 一部のみ実装済み | unsupported | reopened | `quality/profile.yaml`, `#482` |
| [#387](https://github.com/rebuildup/my-web-2026/issues/387) | ci(verification): UI以外の1Issue/1PRにも画像付き検証を必須化 | 実装予定・未着手 | unsupported | reopened | `ci.yml`, `compat.yml` |
| [#388](https://github.com/rebuildup/my-web-2026/issues/388) | feat(identity): 旧サイトの自己紹介を照合してAboutの編集可能な紹介コンテンツへ移す | 実装予定・未着手 | unsupported | reopened | `AboutPage.tsx`, `stories.tsx` |
| [#389](https://github.com/rebuildup/my-web-2026/issues/389) | feat(identity): 旧サイトの経歴年表を根拠付きデータと表示コンポーネントへ移行 | 実装予定・未着手 | unsupported | reopened | `components/AboutPage.tsx`, `data.ts` |
| [#390](https://github.com/rebuildup/my-web-2026/issues/390) | feat(identity): 旧サイトの外部リンク一覧を確認して利用先別リンクコンポーネントへ移行 | 実装予定・未着手 | unsupported | reopened | `src/about/data.ts`, `docs/verification/identity/ ディレクトリが存在せず、links の公開/無効/空 fixture も存在しない` |
| [#391](https://github.com/rebuildup/my-web-2026/issues/391) | feat(identity): 旧サイトのSkills表示を技術使用実績つきで再構成 | 実装予定・未着手 | unsupported | reopened | `src/about/data.ts`, `docs/influences/tech-interests.md` |
| [#392](https://github.com/rebuildup/my-web-2026/issues/392) | ci(a11y): Storybookの独立コンポーネントにaxe検査を導入 | 実装・実証まで完了 | supported | kept-closed | `#694`, `#392` |
| [#401](https://github.com/rebuildup/my-web-2026/issues/401) | feat(a11y): タップ・クリックターゲットとドラッグ代替を整備 | 一部のみ実装済み | unsupported | kept-closed | `#698`, `#401` |
| [#402](https://github.com/rebuildup/my-web-2026/issues/402) | test(a11y): 音声読み上げの操作手順を公開UIで検証 | 実装・実証まで完了 | supported | kept-closed | `quality/screenreader-steps.json`, `scripts/check-a11y-screenreader-steps.mjs` |
| [#406](https://github.com/rebuildup/my-web-2026/issues/406) | feat(a11y): モーダル/メニューの焦点管理と復帰 | 実装・実証まで完了 | supported | kept-closed | `scripts/check-a11y-dialog-focus.mjs`, `test.mjs` |
| [#408](https://github.com/rebuildup/my-web-2026/issues/408) | feat(a11y): 動画の字幕・説明・静止画代替を整備 | 実装・実証まで完了 | supported | kept-closed | `#699`, `#408` |
| [#424](https://github.com/rebuildup/my-web-2026/issues/424) | docs(copy): yomiyasu Agent Skillを文章レビュー手順へ導入 | 理由を明示して不採用 | supported | kept-closed | `docs/adr/ADR-0017-unicode-normalization-and-url-slug-separation.md`, `docs/influences/tech-interests.md` |
| [#427](https://github.com/rebuildup/my-web-2026/issues/427) | feat(copy): 日本語レビュー結果をStack/Editorプレビューで可視化 | 一部のみ実装済み | unsupported | reopened | `docs/verification/copy/meaning-diff-evaluation.md`, `#426` |
| [#436](https://github.com/rebuildup/my-web-2026/issues/436) | feat(content): 記事プレビューと公開承認の状態を見える化 | 実装予定・未着手 | unsupported | reopened | `src/ on origin/release-0-8-0 has no content/article owner (about, admin, cloudflare, contact, editorial, external-api, home, http, i18n, keyboard, legal, logging, personal, portfolio, privacy, projects, reactions, routes, server, tools)`, `src/routes/ on release-0-8-0 has no article or preview route; the only 'preview' artefacts are design-system/personal Storybook previews` |
| [#510](https://github.com/rebuildup/my-web-2026/issues/510) | feat(platform): 部品ごとの組込実例をStack説明ページに掲載 | 実装予定・未着手 | unsupported | reopened | `src/routes/ に stack ページは存在しない (design-system ルートのみ)`, `storybook-ownership-check.webp` |
| [#512](https://github.com/rebuildup/my-web-2026/issues/512) | docs(vision): 「根本的にいいもの」を制作判断の基準として定義 | 実装予定・未着手 | unsupported | reopened | `grep for '根本的にいいもの' / '意味のあるもの' across docs/ and src/ finds no such decision document`, `docs/personal/principles.md` |
| [#513](https://github.com/rebuildup/my-web-2026/issues/513) | docs(vision): 制作と成長・自信の関係を事実に基づき記録 | 実装・実証まで完了 | supported | kept-closed | `docs/personal/growth-through-making.md`, `src/routes/design-system/sections/GrowthThroughMaking.preview.ts` |
| [#514](https://github.com/rebuildup/my-web-2026/issues/514) | docs(vision): 「作りたい」と「欲しい」を区別した制作動機の分類 | 実装予定・未着手 | unsupported | reopened | `docs/domain/overview.md`, `audience-purpose-separation.md` |
| [#515](https://github.com/rebuildup/my-web-2026/issues/515) | docs(vision): 「使えるもの」を配布・API・操作の公開条件に落とし込む | 実装・実証まで完了 | supported | kept-closed | `#711`, `#515` |
| [#516](https://github.com/rebuildup/my-web-2026/issues/516) | docs(vision): 就活・差別化・需要・ネット集客の目的を分けて整理 | 実装・実証まで完了 | supported | kept-closed | `docs/vision/audience-purpose-separation.md`, `src/personal/audience-purpose/AudiencePurposeMatrix.preview.ts` |
| [#517](https://github.com/rebuildup/my-web-2026/issues/517) | spike(experience): 「見てて楽しい」の2種類の体験を比較 | 実装予定・未着手 | unsupported | reopened | `src/personal/ 配下は audience-purpose / flat-vs-depth / tech-interests / typography-grid-swiss / brand-naming / music-connections / usable-product-publication で、靜態/操作型の比較 preview は存在しない`, `git grep '見てて楽しい' はリポジトリ全体で 0 件` |
| [#518](https://github.com/rebuildup/my-web-2026/issues/518) | feat(portfolio): 作品ごとの制作史・変遷を示す履歴コンポーネント | 実装予定・未着手 | unsupported | reopened | `src/portfolio/components/ on release-0-8-0 has no history/timeline component (EmptyState, FacetFilter, Markdown, PortfolioDetail, PortfolioList, PortfolioMedia, ProjectCard)`, `git grep '制作史|projectHistory|年表' origin/release-0-8-0 -- src/ : hits only in personal/roadmap-style preview texts (music-connections, typography-grid-swiss, usable-product-publication, GrowthThroughMaking), i.e. unrelated documents` |
| [#519](https://github.com/rebuildup/my-web-2026/issues/519) | feat(portfolio): 設計判断と試行錯誤を記録する作品ケーススタディ要素 | 実装予定・未着手 | unsupported | reopened | `src/portfolio/components/ にケーススタディ element は存在しない (EmptyState / FacetFilter / Markdown / PortfolioDetail / PortfolioList / PortfolioMedia / ProjectCard のみ)`, `docs/verification/vision/growth-case-study-preview.md` |
| [#520](https://github.com/rebuildup/my-web-2026/issues/520) | docs(visual): シンプル・平面的になりがちな表現を観測ベースで分析 | 実装・実証まで完了 | supported | kept-closed | `docs/visual/flat-vs-depth-review.md`, `src/personal/flat-vs-depth/FlatVsDepth.preview.ts` |
| [#521](https://github.com/rebuildup/my-web-2026/issues/521) | docs(brand): 361doの名称解釈と採用可能なコピーを記録 | 実装・実証まで完了 | supported | kept-closed | `docs/brand/361do-name-meanings.md`, `src/personal/brand-naming/BrandNameMeanings.preview.ts` |
| [#522](https://github.com/rebuildup/my-web-2026/issues/522) | feat(brand): 「時間を溶かしています」モチーフの表示コンポーネント | 実装予定・未着手 | unsupported | reopened | `git grep '溶か|melting|Melting' origin/release-0-8-0 -- src/ docs/ : no hit`, `src/personal/brand-naming/BrandNameMeanings.preview.ts` |
| [#523](https://github.com/rebuildup/my-web-2026/issues/523) | docs(brand): 361do_sleep・361do_designの使い分けを仕様化 | 一部のみ実装済み | unsupported | reopened | `docs/personal/domain.md`, `361do-name-meanings.md` |
| [#524](https://github.com/rebuildup/my-web-2026/issues/524) | feat(identity): 名前・ハンドルの対応を説明する独立表示コンポーネント | 実装予定・未着手 | unsupported | reopened | `AboutPage.tsx`, `index.ts` |
| [#525](https://github.com/rebuildup/my-web-2026/issues/525) | docs(influences): 音楽・ボカロ・DTMから映像制作への関心を整理 | 実装・実証まで完了 | supported | kept-closed | `docs/influences/music-connections.md`, `src/personal/music-connections/MusicConnections.preview.ts` |
| [#526](https://github.com/rebuildup/my-web-2026/issues/526) | docs(influences): After Effects・文字PV・映像文化を制作事例に紐付け | 一部のみ実装済み | unsupported | reopened | `docs/influences/music-connections.md`, `#715` |
| [#527](https://github.com/rebuildup/my-web-2026/issues/527) | docs(influences): スイスデザイン・タイポグラフィ・グリッドの採否記録 | 実装・実証まで完了 | supported | kept-closed | `#717`, `#527` |
| [#528](https://github.com/rebuildup/my-web-2026/issues/528) | docs(influences): AI・OS・言語・フレームワークの関心を事実ベースで管理 | 実装・実証まで完了 | supported | kept-closed | `docs/influences/tech-interests.md`, `src/personal/tech-interests/TechInterests.preview.ts` |
| [#529](https://github.com/rebuildup/my-web-2026/issues/529) | docs(content): 「好き・尊敬・影響・使用」の関係語彙を区別 | 一部のみ実装済み | unsupported | reopened | `docs/influences/tech-interests.md`, `#528` |
| [#533](https://github.com/rebuildup/my-web-2026/issues/533) | docs(perf): Miroの「ポップコーン」案の意味を確定し採否を記録 | 実装予定・未着手 | unsupported | reopened | `git grep 'ポップコーン|popcorn' origin/release-0-8-0 -- src/ docs/ : no hit (the only clue is the 2026-10-17 issue comment clarifying it means a per-element rendered popcorn UI)`, `popcorn-term-audit.png` |
| [#535](https://github.com/rebuildup/my-web-2026/issues/535) | docs(vision): 制作哲学を公開できる編集記事の一画面として試作 | 実装予定・未着手 | unsupported | reopened | `audience-purpose-separation.md`, `git grep -ln "manifesto" -- docs/ src/ → ヒットなし` |
| [#598](https://github.com/rebuildup/my-web-2026/issues/598) | 判断待ち: mic-level を sandbox="allow-scripts allow-same-origin"  | 理由を明示して保留 | awaiting-owner | reopened | `docs/security/security-headers.md`, `src/tools/manifest.json` |
| [#669](https://github.com/rebuildup/my-web-2026/issues/669) | security(deps): braces 3.0.3 (GHSA-vfj7-8cjw-p6xm) の未修正 advi | 実装・実証まで完了 | supported | kept-closed | `quality/dependency-advisory-gate.json`, `#704` |
| [#672](https://github.com/rebuildup/my-web-2026/issues/672) | 判断待ち: 編集レビュー gate の対象外に残っている src/keyboard / src/legal / src/ | 実装予定・未着手 | awaiting-owner | reopened | `quality/copy-editorial-surfaces.json`, `copy/resources.json` |
| [#700](https://github.com/rebuildup/my-web-2026/issues/700) | fix(privacy): GA4 の Admin 経路判定を Router と同じ percent-decoding  | 実装・実証まで完了 | supported | kept-closed | `#706`, `#700` |
| [#701](https://github.com/rebuildup/my-web-2026/issues/701) | fix(data-integrity): D1 backup が JavaScript 安全整数範囲外の SQLite  | 実装・実証まで完了 | supported | kept-closed | `src/cloudflare/d1-backup.ts`, `src/cloudflare/d1-numeric.test.ts` |
| [#702](https://github.com/rebuildup/my-web-2026/issues/702) | fix(logging): Error.nameの未秘匿と audit fields による event/at 上書きを | 実装・実証まで完了 | supported | kept-closed | `src/logging/redact.ts`, `src/logging/logger.ts` |
| [#704](https://github.com/rebuildup/my-web-2026/issues/704) | chore(deps): 依存 advisory ゲートを green に戻す（better-auth / happy- | 実装・実証まで完了 | supported | kept-closed | `package.json`, `pnpm-lock.yaml` |
| [#709](https://github.com/rebuildup/my-web-2026/issues/709) | feat(platform): 個人文書 preview 用の owner「src/personal」を導入する | 実装・実証まで完了 | supported | kept-closed | `#710`, `#709` |
| [#724](https://github.com/rebuildup/my-web-2026/issues/724) | fix(bundle): サーバ専用スタックをブラウザ bundle から排除し、shell を約 1.69MB → 約 | 実装・実証まで完了 | supported | kept-closed | `src/admin/auth/load.ts`, `src/admin/keys/load.ts` |
| [#726](https://github.com/rebuildup/my-web-2026/issues/726) | fix(architecture): check-architecture の leaf ルールが到達不能コードで、AG | 実装・実証まで完了 | supported | kept-closed | `scripts/check-architecture.test.mjs`, `scripts/check-architecture.mjs` |
| [#728](https://github.com/rebuildup/my-web-2026/issues/728) | fix(verification): 検証が黙って通る 2 つの穴（台帳の未来日 / e2e の silent skip | 実装・実証まで完了 | supported | kept-closed | `src/legal/inventory.ts`, `scripts/_local-only-spec.mjs` |
| [#730](https://github.com/rebuildup/my-web-2026/issues/730) | docs(skills): herdr-runtime Skill を vendor する（upstream proje | 実装・実証まで完了 | supported | kept-closed | `#731`, `skills/herdr-runtime/SKILL.md` |
| [#734](https://github.com/rebuildup/my-web-2026/issues/734) | fix(seo): 公開面台帳と sitemap 生成器の矛盾を解消し、食い違いを gate にする | 実装・実証まで完了 | supported | kept-closed | `scripts/check-sitemap-ledger-agreement.mjs`, `scripts/check-sitemap-ledger-agreement.test.mjs` |
| [#737](https://github.com/rebuildup/my-web-2026/issues/737) | fix(verification): status-monochrome の「Storybook dev preview | 実装・実証まで完了 | supported | kept-closed | `docs/verification/a11y/status-monochrome.md`, `同ファイル:175 に『8px ラスタライズの RMS は上表の値、測定スクリプトは未 commit』という第 2 項の制約がそのまま保持されている` |

### 8.1 owner 判断待ちの一覧（11 件）

| Issue | タイトル | 判断が必要な点（記録メモ） |
| --- | --- | --- |
| [#61](https://github.com/rebuildup/my-web-2026/issues/61) | feat(brand): 361do-axis の samuido brand assets を personal identity として再評価する | brand asset の採用判断そのものが owner のブランド判断であり、361do-axis 由来の資産を個人 identity として公開することになる。決定が記録されるまで追跡は残す必要があるが、公開面の変更を伴うため agent 側では採用／不採用を決めない。 |
| [#202](https://github.com/rebuildup/my-web-2026/issues/202) | chore(deps): Panda CSS v2へアップグレード | A reasoned deferral exists (issue comment 2026-10-19), so the concept is not abandoned — but the deferral window closed inside this same release and no re-decis |
| [#317](https://github.com/rebuildup/my-web-2026/issues/317) | feat(home): 公開予定のカレンダーを現在地エリアに表示 | 外部カレンダー連携は既定で無効という条件付きであり、公開する予定の粒度・期間・非掲載条件は所有者の公開判断が要る。実装前の所有者決定事項として残すのが妥当。 |
| [#318](https://github.com/rebuildup/my-web-2026/issues/318) | spike(home): 「看板×地図」の位置コンテキスト表示を検証 | spike は「判断を PR に残す」ことが成果物だが、その判断記録もプロトタイプも存在しない。地図表示の採用可否は公開面の位置づけに関わる所有者決定。 |
| [#320](https://github.com/rebuildup/my-web-2026/issues/320) | spike(home): Discordオンライン表示の許可済みデータ経路を実証 | 「本人だけが許可した経路で公開する」ことが前提で、許可の主体・範囲・停止手順は所有者だけが決められる。データ経路の実証記録も存在しない。 |
| [#321](https://github.com/rebuildup/my-web-2026/issues/321) | feat(home): Xの公開投稿を選別して現在地に掲載 | 埋め込みの可否・登録する投稿・抜粋範囲は公開面の所有者の選択事項であり、採否は所有者決定。いずれにせよ実装は存在しない。 |
| [#322](https://github.com/rebuildup/my-web-2026/issues/322) | feat(home): Discordの公開告知を現在地に1件表示 | 許可済みチャンネルの特定と公開範囲は所有者の許諾事項である。通知経路の候補として docs/domain/integrations.md に載るのみで、コード上の根拠はない。 |
| [#330](https://github.com/rebuildup/my-web-2026/issues/330) | feat(content): Notionの承認済み1記事をCMSソースとして表示 | Notion を CMS ソースとして採用するか否かは Issue 本文でも「採用自体を確定しない」と留保しており、所有者判断が先行する。コード上の根拠はない。 |
| [#331](https://github.com/rebuildup/my-web-2026/issues/331) | feat(content): Notion記事の再同期・差分更新ステータスを表示 | 前提の #330 が未実装のままであるため差分更新の 대상自体が存在しない。Notion 連携の採用可否も未決。 |
| [#598](https://github.com/rebuildup/my-web-2026/issues/598) | 判断待ち: mic-level を sandbox="allow-scripts allow-same-origin" で卒業させるか (Issue #449 の残り) | これは owner 判断の追跡用の Issue であり、判断自体は未実施のまま閉じられた。推奨 B と推奨 B への反論が共に記録されている。 |
| [#672](https://github.com/rebuildup/my-web-2026/issues/672) | 判断待ち: 編集レビュー gate の対象外に残っている src/keyboard / src/legal / src/privacy の公開 copy | The sweep closed an explicitly owner-owned question ('判断は owner が record で残す') without a decision record. This is an owner copy decision about public surface an |

いずれも「採用するかどうか / 公開するかどうか」の判断です。**本監査では結論を出していません**（AGENTS.md §4・§6 の owner 権限）。

## 8. 残る問題

- **owner 判断待ち 11 件**: #61, #202, #317, #318, #320, #321, #322, #330, #331, #598, #672 — いずれも「採用するか / 公開するか」の判断で、 Issue の公開面・ブランド・外部 API 契約・個人情報に関わります。本監査では結論を出していません。
- **Miro 原典の対応表**（#534）: 上記 6 のとおり owner 作業待ち。
- **監査自体の未実施範囲**: 10-31 以外のクローズ（0 件）と、他リポジトリのバックログは対象外です。
