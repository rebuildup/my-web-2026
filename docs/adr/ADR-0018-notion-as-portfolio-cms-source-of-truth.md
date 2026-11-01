# ADR-0018 — Notion を portfolio の CMS SoT とし、offline sync で取り込む

- Status: **Proposed (draft) — 未承認。owner review 待ち**
- Date: 2026-11-01
- Ticket: Issue #765（採用と同期基盤） / Issue #766（旧サイト全件移行）
- Target release: `release-0-8-1`（0.8.1）
- Proposed module location: `src/portfolio/notion/`（取得 adapter と snapshot reader）、
  `src/portfolio/snapshots/`（committed snapshot）。**まだ作成しない。**
- Companion docs:
  [`docs/migration/notion-cms-audit-2026-11-01.md`](../migration/notion-cms-audit-2026-11-01.md) /
  [`docs/migration/notion-cms-integration-scope-draft.md`](../migration/notion-cms-integration-scope-draft.md) /
  [`docs/domain/integrations.md`](../domain/integrations.md) /
  [`docs/security/integration-token-scope.md`](../security/integration-token-scope.md)

> この ADR は **提案** である。`Status: Accepted` に変えるのは repository
> owner の判断であり、agent はこの文書を書いたこと自体を承認の証拠にしない
> （AGENTS.md §6 / `docs/runbook/issue-lifecycle.md`）。§6 の未決事項が
> 埋まるまで実装に入らない。

## 1. Context

### 1.1 何が決まっていないか

owner は 2026-11-01 に「Notion を Portfolio の CMS の source of truth として
採用し、旧サイト `rebuildup/my-web-2025` のコンテンツを全件移行する」と決定した
（Issue #765 body）。決まっていないのは **採用そのものではなく、取得境界** である。

現在の repository は、外部 CMS を読む経路を 1 本も持たない。

| 事実 | 出典 |
| --- | --- |
| `docs/domain/integrations.md` の notion 行は `uncommitted`、promotion condition は「実際の capability が Notion data を SoT として読む必要が生じたとき」 | 同 §Current state |
| `quality/integration-scope.json#allowlist.entries` は空。Notion token は 1 本も取得していない | 同 |
| `/integrations/*` は `src/server.ts` が dispatch するが handler 未 mount で 404 を返す | `src/http/integrations/boundary.test.ts` |
| Worker から external への runtime 通信は 0 件（`src/external-api/**` は未結線） | `docs/domain/integrations.md` §Unwired reference adapters |
| portfolio の公開データは D1 `portfolio_project` / `portfolio_link` / `portfolio_media` と R2 `MEDIA`。runtime は `src/portfolio/load.ts` が D1 を読む | `migrations/0007_portfolio.sql`, `src/portfolio/public.ts` |
| Notion 由来の HTML を受ける口は既に 1 つだけある（`sanitizeNotionHtml`）が、**ingest 経路に接続されていない** | `src/portfolio/index.ts`, `docs/portfolio/decisions.md` Decision 6 |
| 「offline で取得 → committed snapshot → reader-side validation → freshness」の実装済み前例が `src/projects/**` にある | `src/projects/{types,snapshot}.ts`, `scripts/sync-project-introductions.mjs` |
| 旧サイトの移行は Issue #78（closed 2026-10-03）で classifier / migrate / verify まで作られ、`publication_overrides` が空のまま止まっている | `docs/migration/README.md`, `docs/migration/portfolio-2025-role-overrides.json` |

### 1.2 この ADR が解く問題

「Notion を読むコードを書く」ことは決定ではない。決めるべきは次の 5 点であり、
どれも public contract / security / cost に触れるため AGENTS.md §8 の
escalation 対象である。

1. 取得境界（runtime か、offline か）
2. 更新の伝播（誰が・いつ・どの経路で公開状態を変えるか）
3. 失敗時の振る舞い（取得できないとき、サイトは何を表示するか）
4. token の authority（どの層が持ち、誰が失効させるか）
5. 公開権限（Notion の property が公開を決めてよいのか）

## 2. Decision（提案）

### 2.1 Notion は **authoring の SoT** であり、公開時の runtime dependency ではない

portfolio の文章・タグ・リンク・メディア参照の正は Notion の database に置く。
公開サイトは **リクエスト時に Notion を読まない**。これは §4 の追加 service を
必要とせず、vendor 障害を公開障害に変換しないための境界である。

### 2.2 取得は offline sync。成果物は committed snapshot

```
Notion database ──(offline sync, token=NOTION_TOKEN)──▶ src/portfolio/snapshots/portfolio.json
                                                              │  (reviewed in a PR)
                                                              ▼
                                              apply（offline / pre-release step）
                                                              ▼
                                                     D1 portfolio_* （runtime の読み先は不変）
```

- sync は Node スクリプト（`scripts/sync-portfolio-notion.mjs` を想定）が実行する。
  Worker の request path には現れない。
- 出力は **status-only**（件数・digest・verdict）。本文・メディアバイト・
  token を stdout に書かない。
- snapshot は PR で review される。差分が review できることが、外部データを
  公開物へ持ち込む唯一の統制である。
- **runtime の読み先は D1 のまま変えない**。snapshot は「公開してよい状態の
  記録」であり、D1 はその projection である。この分離により、
  `src/portfolio/load.ts` の公開境界（§Decision 3）、cursor pagination、
  query budget、`isPublishedPortfolioMediaKey` の R2 公開判定はそのまま生きる。

> **なぜ snapshot を runtime で直接読まないか。** 151 件規模の本文とメタデータを
> Worker bundle に載せると `bundle:budget:check`（Issue #482）に直接効く。
> Static Assets 経由で読む案は bundle を避けられるが、公開判定と pagination を
> Worker 側で再実装することになり、既存の 1 つの公開境界が 2 つに分裂する。
> 実測（§3）で件数が小さく、bundle 予算内に収まると確認できた場合に限り、
> この判断を見直してよい。

### 2.3 Snapshot contract

`src/projects/snapshots/dotfiles.json` と同型に、**reader 側で fail-closed に
検証できる** 形にする。最低限:

| field | 意味 | 検証 |
| --- | --- | --- |
| `schemaVersion` | reader が受け付ける形 | 未知 version は `null` 扱い（公開しない） |
| `source.databaseId` | 取得元 database の識別子（secret ではない） | 文字列・非空。**workspace id は記録しない** |
| `source.capabilities` | 実際に行使した capability（`read_content` 等） | ledger の required/optional の部分集合であること |
| `fetchedAt` / `verifiedAt` / `appliedAt` | 取得・検証・適用の時刻 | ISO 8601。parse 不能は stale ではなく invalid |
| `contentDigest` | snapshot 内容の SHA-256 | `sha256:[0-9a-f]{64}` |
| `availability` | `public` \| `unavailable` | `unavailable` は `reason` / `observedAt` を必須にする |
| `records[]` | 公開判定に必要な最小の投影 | 未知 key は invalid（記録は人間の判断なので silent に落とさない） |

`records[]` は Notion page の全 property を写さない。`src/projects/types.ts` が
「上流 document より意図的に狭い」と明記しているのと同じ理由で、narrative の
うち公開に必要な section だけを表現する。

### 2.4 更新の伝播

1. schedule（既定案: 1 日 1 回）または `workflow_dispatch` で sync が走る。
2. 内容 digest が変わったときだけ snapshot を書き、**PR を開く**
   （`.github/workflows/projects-sync.yml` と同じ形。base は repository
   variable `PORTFOLIO_SYNC_BASE_REF` で、sprint ごとに release branch を指す）。
3. PR の merge は human gate。workflow は merge / deploy / publish をしない。
4. merge 後に apply（snapshot → D1）を実行する。apply は offline の
   idempotent な upsert で、既存行を消さない。削除は明示の tombstone だけ。

schedule の間隔・apply の実行主体（手動 / リリース手順 / CI）は §6 の owner 判断。

### 2.5 失敗時の振る舞い

| 段階 | 失敗 | 記録 | 公開面 |
| --- | --- | --- | --- |
| sync（transport） | timeout / 401 / 403 / 429 / 5xx / body 不正 | **何も書かない**（snapshot の `fetchedAt` は据え置き） | 前回 snapshot のまま。`verifiedAt` の経過で `stale` |
| sync（source-state） | database が共有解除 / property 形が想定外 | `availability: unavailable` + `reason` + `observedAt`。最後の known good は保持 | 「最終取得時点の内容。現在は未確認」を明示し、**新しい事実として提示しない** |
| apply | schema 不一致 / 想定外 record | apply を中断し、D1 を変更しない（部分的に適用しない） | 直前の適用済み状態 |
| rights review | asset の権利が未記録 | その asset を公開対象から外す（fail-closed） | 画像は placeholder（既存の `url: null` contract） |

transport 失敗を「この database はもう存在しない」と記録しない。これは
`scripts/sync-project-introductions.mjs` が既に守っている区別であり、
1 回の 500 を恒久的な非公開として記録すると、復旧後も誤った状態が残る。

### 2.6 公開権限は Notion に移さない

Notion の `status` property は **入力** であり、公開の権限ではない。

- 公開判定は repository 側の記録（owner の `publication` 決定 + rights の
  記録 + 既存の公開条件）で行う。
- したがって「Notion で Published にしたらサイトに出た」という経路を作らない。
  Notion の property 名や値を、我々の公開 policy に読み替えない
  （`docs/security/integration-token-scope.md` §2 の Notion 行と同じ原則）。
- 権利未記録の asset は、反映後も公開されない（`src/legal/**` の判定を通る）。

### 2.7 Secret contract

| 項目 | 値 |
| --- | --- |
| 名前 | `NOTION_TOKEN`（`{PRODUCT}_{ROLE}`、`docs/runbook/infisical-secrets.md` §3.2） |
| 値の所在 | Infisical（ADR-0015 §1）。この repository のどのファイルにも書かない |
| 誰が使うか | **offline sync スクリプトのみ**。Worker は読まない |
| `wrangler*.jsonc` | **登録しない**。`wrangler*.jsonc#secrets.required` に integration token の名前を足すと、allowlist が空のうちは `pnpm run integration:scope:check` が error にする |
| 保持期限 | 90 日（`quality/integration-scope.json` の notion 行と一致） |
| 失効 | ledger の `revocation` 手順（workspace 側で connection を削除 → Infisical の値を削除 → 両文書の status を更新、24h 以内） |
| 出力 | status-only。値を echo しない・ログに載せない |

**重要な帰結**: snapshot 方式を採ると token は Worker に到達しない。runtime
secret の数が増えないことは、この案の security 上の主要な利点である。

### 2.8 変えないもの

- §4 の Cloudflare service は増やさない。KV / Queues / Workflows は不要。
- `/integrations/*` は **404 のまま**。mount は promotion ticket の仕事で、
  この ADR は mount を承認しない。
- `src/http/**` は inbound 境界のまま。sync は `src/http/**` に入れない
  （outbound の既存 owner は `src/external-api/**` だが、そちらは表示 component の
  read 契約であり、build/CI の offline tooling は `scripts/**` が担う）。
- D1 / R2 の binding と公開 prefix（`portfolio/`, `reactions/`）は変えない。

## 3. Comparison — 取得境界の候補

| 軸 | **runtime read**（Worker が Notion を叩く） | **scheduled sync → committed snapshot**（提案） | **build-time だけ** |
| --- | --- | --- | --- |
| vendor 障害の影響 | 公開面が直接落ちる | snapshot の `stale` として劣化するだけ | deploy できない（公開面は前回のまま） |
| 追加 service / ADR（§4） | KV/キャッシュ層が必要 | 不要 | 不要 |
| token の到達範囲 | Worker runtime | CI / operator の shell のみ | CI のみ |
| rate limit / 429 | リクエスト数に比例して踏む | 1 日 1 回の一括 read | deploy 時のみ |
| 公開差分の review | 差分が見えない（D1 が勝手に変わる） | **PR で review できる** | PR で review できる |
| 新規コンテンツの反映遅延 | 0 | 1 sync 間隔 + PR merge | deploy まで |
| 実装の大きさ | 中〜大（cache / retry / breaker / UI 状態） | 小（既存 `src/projects/**` と同型 + apply） | 中（build が network に依存し、再現性が落ちる） |
| 再現性 | 低（外部状態に依存） | 高（snapshot が commit されている） | 低（build 時に外部を読む） |
| 失敗時の rollback | なし | snapshot を 1 commit 戻す | deploy を戻す |

**採用案（§2）は中央列。** runtime read は vendor を公開経路の一部にしてしまい、
token を Worker に置く必要があり、公開差分の review も失う。build-time だけの案は
build の再現性と deploy の可用性を vendor に依存させるため落とす。

### 3.1 snapshot の保存先（第 2 の軸 — owner 判断）

| 案 | 概要 | 長所 | 短所 |
| --- | --- | --- | --- |
| **A（提案）** snapshot → D1 apply | commit された snapshot を offline で D1 に投影。runtime は D1 | 既存の公開境界・pagination・query budget をそのまま使う。bundle が増えない | apply という手順が 1 つ増える |
| B | snapshot を runtime で直接読む（bundle） | apply 不要 | 151 件の本文を bundle に載せる。`bundle:budget:check` に効く。公開判定の再実装 |
| C | snapshot を Static Assets から読む | bundle を避けられる | fetch + parse が runtime に入る。公開判定が 2 箇所に分裂する |

A を提案する。理由は「公開境界を 1 つに保つ」ことと「bundle 予算」であり、
実測（§5）で反証されたら B/C を再検討する。

## 4. Consequences

### 4.1 良くなること

- 外部データが公開物になる瞬間に、必ず review 差分が存在する。
- 公開面は vendor 障害に対して劣化モードを持つ（stale / unavailable）。
- token が Worker に存在しない。
- 旧サイト移行（#766）が「Notion → snapshot → D1」の 1 本の経路に乗る。

### 4.2 コスト / 制約

- 反映遅延が sync 間隔 + PR merge 分だけ生じる。速度が必要なら schedule を詰める
  （ただし Notion 側の rate limit を先に確認する）。
- snapshot の schema と D1 の schema の 2 つを保守する。
- apply の idempotency と「削除」の表現（`tombstone`）を決める必要がある。
- `publication_overrides` 相当の owner 承認面を Notion の外に持つか、
  Notion の property + 署名済み記録で持つかを決める必要がある（§6）。

### 4.3 品質ゲートへの影響（実装時の見込み）

- `integration:scope:check` — notion 行の status 変更と allowlist entry は
  **同一 PR** で必要。entry は owner が記録する（agent は書かない）。
- `structured-data:check` / `seo:status:check` — 新しい public 状態
  （stale / unavailable の表示）は route の status row を持つ。
- `legal`（`assets:license:check`）— 旧メディアは権利未記録のため、
  移行時は全て `hold` から始まる（§2.6）。
- `bundle:budget:check` — §3.1 の判断に効く。

## 5. Open questions（owner の判断。この ADR は決めない）

1. **snapshot の保存先** — §3.1 の A / B / C。
2. **sync 頻度** — 1 日 1 回 / 週 1 回 / 手動のみ。失敗時に公開面をどう見せるか
   （stale を許容するか、unavailable として隠すか）。
3. **apply の実行主体** — 手動（release 手順）/ CI の PR merge 後 / 別 workflow。
4. **公開承認の置き場** — Notion の property を入力とし、承認は repository の
   記録に置く（§2.6）か、承認も Notion に寄せるか。前者を提案している。
5. **Notion workspace / database / integration token の実体** — 値は Issue に
   書かない。owner が Infisical に投入し、名前だけを ledger と整合させる。
6. **旧サイトの draft 80 件 / `mechanical_drop` 91 件を移送するか**
   （#766 の台帳 §未移行を参照）。
7. **引用した人名（依頼者名）を含むタイトルの公開可否** — 権利・プライバシー。

## 6. Rejected alternatives

- **runtime read**: §3 のとおり、公開経路が vendor に依存し、token が Worker に
  載り、差分 review を失う。
- **Notion を直接編集 UI としてサイトに埋め込む**: 認証・権限・CSRF の面が
  一気に増え、§4 の追加 service と新しい公開境界が必要になる。対象外。
- **`/integrations/*` を mount して OAuth で接続する**: 誰の grant で読むのか
  （owner の workspace か、訪問者か）が未定義。ADR-0011 の consumer パターンと
  §4 の policy を先に満たす必要がある。この ADR は **private integration token**
  を offline tooling の credential としてのみ扱う。

## 7. References

- `docs/domain/integrations.md` — 候補 roster と promotion condition
- `docs/security/integration-token-scope.md` — scope / retention / revocation
- `docs/domain/project-introductions.md` — offline sync + snapshot の前例
- `scripts/sync-project-introductions.mjs` — 失敗時の 2 分類
- `.github/workflows/projects-sync.yml` — PR ベースの同期
- `docs/migration/notion-cms-audit-2026-11-01.md` — 現状監査
- Notion API の vendor 仕様: `quality/integration-scope.json` の notion 行
  `source.url`（`verified_on: 2026-10-19`）。**promotion 前に再確認する。**
