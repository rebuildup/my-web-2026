# ADR-0018 — Notion を portfolio の CMS SoT とし、build-time で snapshot を取り込む

- Status: **Accepted**（owner 決定 2026-11-01）
- Date: 2026-11-01
- Accepted on: 2026-11-01 — owner が「Accepted を選ぶ」と決定（総合監督経由で伝達）
- Owner instruction: `.tmp/supervisor/portfolio/OWNER-2026-11-01.md`（build-time のみ /
  scheduled sync 禁止 / 編集可能性の実証 / 全件移行は不要）
- Ticket: Issue #765（採用と同期基盤） / Issue #766（旧サイトからの代表例の移行）
- Target release: `release-0-8-1`（0.8.1）
- Implemented at: `src/portfolio/notion/`（contract / publish / reader / generated
  snapshot）、`scripts/sync-portfolio-notion.mjs`（sync）、
  `scripts/_notion-mapper.mjs`（Notion block → Markdown）、
  `scripts/_notion-transport.mjs`（Notion API read）
- Companion docs:
  [`docs/migration/notion-cms-audit-2026-11-01.md`](../migration/notion-cms-audit-2026-11-01.md) /
  [`docs/migration/notion-cms-integration-scope-draft.md`](../migration/notion-cms-integration-scope-draft.md) /
  [`docs/runbook/notion-portfolio-sync.md`](../runbook/notion-portfolio-sync.md) /
  [`docs/domain/integrations.md`](../domain/integrations.md) /
  [`docs/security/integration-token-scope.md`](../security/integration-token-scope.md)

> **採用の記録。** `Status: Accepted` は repository owner の決定（2026-11-01）に
> よる。agent がこの ADR を書いたこと・本行を編集したことは承認の証拠ではない
> （AGENTS.md §6 / `docs/runbook/issue-lifecycle.md`）。決定の出所は owner の
> 指示であり、この行はその**記録**であって認定ではない。
> 決定内容（本文）は Proposed 時点から変えていない。§5 に残る未決事項は
> Accepted の範囲外ではなく、実装側で順に解く対象である。

## 1. Context

### 1.1 何が決まっていないか

owner は 2026-11-01 に「Notion を Portfolio の CMS の source of truth として
採用する」と決定した（Issue #765 body）。同日の指示で範囲が絞られた:
**build-time のみ**、**scheduled sync は作らない**、**旧サイト全件移行は不要**、
ただし **「Notion で本文を編集すると build に反映される」ことを実証する**。

決まっていないのは採用そのものではなく、取得境界と交換形式である。

| 事実 | 出典 |
| --- | --- |
| `docs/domain/integrations.md` の notion 行は `uncommitted`、promotion condition は「実際の capability が Notion data を SoT として読む必要が生じたとき」 | 同 §Current state |
| `quality/integration-scope.json#allowlist.entries` は空。Notion token は 1 本も取得していない | 同 |
| `/integrations/*` は dispatch されるが handler 未 mount で 404 | `src/http/integrations/boundary.test.ts` |
| portfolio の公開データは D1 `portfolio_project` / `portfolio_link` / `portfolio_media` と R2 `MEDIA`。runtime は `src/portfolio/load.ts` が D1 を読む | `migrations/0007_portfolio.sql`, `src/portfolio/public.ts` |
| 「offline で取得 → committed snapshot → reader-side validation」の実装済み前例が `src/projects/**` にある | `src/projects/{types,snapshot}.ts`, `scripts/sync-project-introductions.mjs` |
| portfolio の本文レンダラは Markdown を入力に取る（`motivationMd` 等） | `src/portfolio/markdown.lexer.ts`, `src/portfolio/schema.ts` |

### 1.2 この ADR が解く問題

1. 取得境界（runtime か build-time か）
2. 更新の伝播（誰が・いつ・どの経路で公開状態を変えるか）
3. 失敗時の振る舞い
4. token の authority
5. 公開権限（Notion の property が公開を決めてよいのか）
6. **交換形式**（Markdown か rich text か）

## 2. Decision（提案）

### 2.1 Notion は **authoring の SoT** であり、公開時の runtime dependency ではない

文章・タグ・リンク・メディア参照の正は Notion の database に置く。公開サイトは
**リクエスト時に Notion を読まない**。`src/portfolio/notion/transport` に相当する
通信コードは `scripts/` にのみ存在し、Worker の import graph に入らない。

### 2.2 取得は **build-time のみ**。scheduled sync は作らない

```
Notion database ──(node scripts/sync-portfolio-notion.mjs)──▶
        src/portfolio/notion/generated/snapshot.json（commit される）
                                    │
                                    ▼  Vite が bundle に inline
                     src/portfolio/notion/reader.ts → publish.ts
                                    │
                                    ▼
                        src/portfolio/load.ts（D1 と merge）
```

- 実行主体は **operator（またはリリース手順）**。`.github/workflows/*` に
  portfolio 同期の workflow は置かない。`projects-sync.yml` と同じ形の定期
  同期は **明示的に禁止**（owner 指示 2026-11-01 項目 4）。
- 出力は **status-only**（件数・digest の先頭・理由コード）。本文・タイトル・
  token を stdout に書かない。
- snapshot は commit され、ticket PR の差分として review される。差分が
  review できることが、外部データを公開物へ持ち込む唯一の統制である。
- 反映の遅延は「次の build」まで。これは仕様であり、欠陥ではない
  （`docs/runbook/notion-portfolio-sync.md`）。

### 2.3 交換形式は **Markdown**（Notion の rich text ではない）

| 候補 | 判定 | 理由 |
| --- | --- | --- |
| **Markdown（採用）** | 採用 | 既存レンダラ（`markdown.lexer.ts`）の入力そのもの。commit されたファイルの diff がそのまま読める。語彙が有限なので、未対応 block を **error にできる** |
| Notion rich text（annotations の JSON） | 不採用 | レンダラを新設する必要があり、diff が構造 JSON になって review できない。Notion の語彙すべてに対して表示を定義し続ける義務も生じる |
| Notion の HTML（`sanitizeNotionHtml` 経由） | 不採用 | sanitisation は ingest 境界の防御であって交換形式ではない。公開バイトが「作者が書いた review 可能なテキスト」ではなく「parser の出力」になる |

変換は **total ではない**。`scripts/_notion-mapper.mjs` は次を error として
返し、sync 全体を失敗させる（何も書かない）:

- 未知の level-2 見出し（`unknown_section_heading`）— 節は 6 つに固定
- 最初の見出しより前の本文（`content_before_first_section`）
- `image` block（`image_block_unsupported`）— Issue #766 の範囲
- その他の未対応 block（`unsupported_block`）
- mention / equation など Markdown に落ちない rich text（`unsupported_rich_text`）

**沈黙して落とさない**ことが要点である。落とした段落は「作者が書かなかった
段落」と区別がつかない。

### 2.4 更新の伝播

1. owner が Notion で本文・property を編集する。
2. operator が `node scripts/sync-portfolio-notion.mjs` を実行する
   （`--dry-run` で先に確認できる）。
3. 内容 digest が変わっていれば `src/portfolio/notion/generated/snapshot.json`
   が書き換わる。変わっていなければ `unchanged` と表示し、書かない。
4. 差分を commit し、PR を経て release branch → `main` に届く。
5. `main` へのマージは Cloudflare Workers Builds が deploy する
   （`docs/runbook/cloudflare-workers-builds.md`）。次の deploy で公開面が変わる。

**cron / schedule / workflow_dispatch のいずれも作らない。** この repository の
定期同期（`.github/workflows/projects-sync.yml`）はこの経路の前例では **ない**。

### 2.5 失敗時の振る舞い

| 段階 | 失敗 | 記録 | 公開面 |
| --- | --- | --- | --- |
| 認証（401 / 403 / 404） | token 不正 / integration 未共有 | **何も書かない**。exit 3 | 変化なし。operator が直す |
| transport（timeout / 429 / 5xx） | 一次障害 | `availability: unavailable` + `reason` + `observedAt`。最後の known good を保持 | 「最終取得時点の内容。現在は未確認」として提示し、**新しい事実として提示しない** |
| content（mapping 拒否） | 未対応 block / property 欠落 | **何も書かない**。exit 1。拒否を全件列挙 | 変化なし |
| reader（契約違反） | snapshot が schema を通らない | `parseSnapshot` が `null` を返し、CMS 由来の 0 件として扱う | CMS 分は非公開。D1 分は不変 |

401 を `unavailable` として記録しない。それは運用ミスであって障害ではない
（`scripts/sync-project-introductions.mjs` が守っているのと同じ区別）。

### 2.6 公開権限は Notion に移さない

`status` / `visibility` は **入力** であり、公開の権限ではない。

- 公開判定は `src/portfolio/notion/publish.ts#isPublicRecord` が行い、
  `published` + `public` の同時成立だけを公開とする。これは D1 loader が
  SQL にハードコードしている述語と同じであり、**2 つの情報源が同じ規則に
  従う**ことを意味する。`archived` は D1 側でも公開されないため、CMS でも
  公開しない（`toProject` は `published` 以外で `null`）。
- 権利未記録の asset は、反映後も公開されない（`src/legal/**` の判定を
  offline で通り、`rights: 'recorded'` 以外は URL を持たない）。

### 2.7 実行時は bundle された snapshot を読む（apply を挟まない）

当初案（§3.1 option A）は「snapshot → offline apply → D1」だった。実装は
**bundle された snapshot を loader が D1 と merge する**形を採る。

| 判断 | 理由 |
| --- | --- |
| apply を挟まない | apply は production D1 への書き込みを伴う。build-time のみという owner 指示の範囲を超え、別の承認境界を作る |
| merge を loader に置く | 既存の公開境界・pagination・query budget・adjacency をそのまま使える。`PortfolioLoader` の契約は変わらない |
| 代償 | 公開述語が 2 箇所（SQL と `isPublicRecord`）になる。`src/portfolio/load.test.ts` の CMS merge 節と `src/portfolio/notion/publish.test.ts` が両方を固定する |
| bundle 予算 | 記録件数は 1 桁〜数十件を想定。`bundle:budget:check`（Issue #482）が実測で上限を判断する |

`createD1PortfolioLoader(env, { cmsProjects })` の注入 seam は、**テストが
merge 経路を通すため**のものである（snapshot が空の commit では merge 節が
一度も実行されない）。production の呼び出しは第 2 引数を渡さず、既定で
`notionProjects()` を使う。

#### slug が両方に存在する場合の規則（D1 が勝つ）

移行期間中は、同じ slug が D1 の行にも snapshot の記録にも存在しうる。
規則は **1 slug = 1 URL = 1 カード** で、所有は D1 とする。

| method | 実装 |
| --- | --- |
| `loadPortfolioProject` | D1 の行を引き、無いときだけ CMS に fallback する（追加 query 0） |
| `loadPortfolioAdjacent` | D1 全行（`LIMIT` なし）の slug 集合から CMS 行を除外してから並べる（追加 query 0） |
| `listPublishedProjectIndex` | 同上（追加 query 0） |
| `listPortfolioProjects` | 現在ページの D1 行だけでは衝突を網羅できないため、`CMS が 1 件以上のときだけ` slug 射影を 1 本追加する。page query と並行に発行するので往復は増えない |

逆（CMS が勝つ）は採らない。detail が D1 を返す以上、list だけ CMS を返すと
同じ URL へのカードが 2 枚出るか、片方が別内容になる。`load.query-budget.test.ts`
は merged 時の追加が **ちょうど 1 文** であることを固定する。

この規則は「衝突を許容する」ことを意味しない。移行の途中状態を安全に
表示するためのもので、恒久的な重複は #766 で解消する。

### 2.8 Snapshot contract

`src/portfolio/notion/contract.ts` が唯一の契約である。reader 側で
fail-closed に検証する。

| field | 意味 | 検証 |
| --- | --- | --- |
| `schema` | `portfolio-notion-snapshot.v1` | 未知 version は `null`（公開しない） |
| `source.databaseId` | 取得元の識別子（secret ではない）。**database id でも data source id でもよい** | 非空文字列。**workspace id も token も記録しない** |
| `source.idKind` | `database` \| `data_source`。configured id がどちらとして解決したか | 任意。無い場合は「不明」（fixture / 旧 snapshot）であって database と推定しない |
| `source.capabilities` | 実際に行使した capability | `read_content` のみ |
| `source.fetchedAt` / `observedAt` | 取得時刻 / 観測時刻 | ISO 8601。parse 不能は invalid |
| `availability` | `public` \| `unavailable` | `unavailable` と `unavailableReason` は必ず対 |
| `contentDigest` | 内容の SHA-256 | `sha256:[0-9a-f]{64}` |
| `records[]` | 公開判定に必要な最小の投影 | 未知 facet / 未知 link kind は invalid |

`records[]` は Notion page の全 property を写さない。`src/projects/types.ts` が
「上流 document より意図的に狭い」と明記しているのと同じ理由である。

**configured id の解決順**（2026-11-01 追加）。data-source model では 1 つの表に
database id と data source id の 2 つがあり、Notion の UI からコピーできるのは
たいてい data source id である。operator に「どちらをコピーしたか」を当てさせない。

1. `GET /v1/databases/{id}` を読む。成功したら `data_sources[]` がちょうど 1 つで
   あることを要求し（複数は §5 の owner 判断）、その data source を query する。
2. 404 のときだけ、同じ値を data source id として `POST /v1/data_sources/{id}/query`
   する。data source id は database endpoint の知らない id なので、これは
   「別の表を黙って選ぶ」推測にはならない。解決しなければ 404 で止まる。
3. query 側の 404 は fallback しない。id が database id として入ってきた場合、
   それは本当の失敗である。

どちらの経路で解決したかは `source.idKind` に残す。

### 2.9 Secret contract

| 項目 | 値 |
| --- | --- |
| 名前 | `NOTION_TOKEN` / `NOTION_PORTFOLIO_DB_ID`（`{PRODUCT}_{ROLE}`、`docs/runbook/infisical-secrets.md` §3.2）。id は secret ではないが、token と同じ場所に置く |
| 種別 | **internal connection token**（静的。OAuth の refresh token ではない） |
| 値の所在 | Infisical **`dev`**（ADR-0015 §1）。この repository のどのファイルにも書かない。`prod` に置かない理由: `pnpm build` は sync を呼ばず、Worker も Notion を読まず、CI にも sync step が無い。本番 runtime secret ではないので `prod` に置くと `secrets.required` と乖離する |
| 誰が使うか | **offline sync スクリプトのみ**。Worker は読まない |
| `wrangler*.jsonc` | **登録しない**。`secrets.required` に足すと allowlist が空のうちは `pnpm run integration:scope:check` が error にする |
| 出力 | status-only。値を echo しない・ログに載せない。snapshot に混入した場合は書き込みを拒否する（`findCredentialLeak`） |
| 保持期限 / 失効 | `quality/integration-scope.json` の notion 行（90 日 / revocation 手順）に従う |

vendor 文書の drift は `docs/migration/notion-cms-integration-scope-draft.md` §5 に
記録した。要点: **OAuth public connection は `refresh_token` を返し、access
token は失効しうる**。個人 workspace の CMS 読み出しには internal connection
token を使うため、refresh 経路は不要であり、ledger に refresh 手順が無いことは
欠落ではなく対象外である。

### 2.10 変えないもの

- §4 の Cloudflare service は増やさない。KV / Queues / Workflows は不要。
- `/integrations/*` は **404 のまま**。
- `src/http/**` は inbound 境界のまま。sync は `scripts/**` に置く。
- D1 / R2 の binding と公開 prefix は変えない。
- 旧サイト全件移行（#766）はこの ADR の範囲外。代表 2〜3 件で経路を証明する。

## 3. Comparison — 取得境界の候補

| 軸 | runtime read | scheduled sync → snapshot | **build-time のみ（採用）** |
| --- | --- | --- | --- |
| vendor 障害の影響 | 公開面が直接落ちる | snapshot の `stale` として劣化 | deploy できないだけ。公開面は前回のまま |
| 追加 service / ADR（§4） | キャッシュ層が必要 | 不要 | 不要 |
| token の到達範囲 | Worker runtime | CI / operator の shell | operator の shell のみ |
| 公開差分の review | 見えない | PR で review | **PR で review** |
| 反映遅延 | 0 | 1 sync 間隔 + merge | 次の build まで |
| 定期実行の運用 | なし | あり（失敗監視が要る） | **なし** |

owner は 2026-11-01 に右列を選んだ。中央列は「Notion を編集したら自動で
公開物が変わる」利点があるが、定期 workflow の運用と失敗監視を伴う。0.8.1 の
目的は CMS 経路の実証であり、運用は次の判断とする。

### 3.1 却下した保存先の変種

| 案 | 判定 | 理由 |
| --- | --- | --- |
| snapshot → offline apply → D1 | 不採用（今回は） | production D1 への書き込みが build-time の外に出る。§2.7 |
| snapshot を Static Assets から fetch | 不採用 | fetch + parse が runtime に入り、公開判定が 2 箇所に分裂する |
| **bundle された snapshot を merge（採用）** | 採用 | 同期読み出し。pagination / budget / 隣接をそのまま再利用 |

## 4. Consequences

### 4.1 良くなること

- 外部データが公開物になる瞬間に、必ず review 差分が存在する。
- token が Worker に存在しない（runtime secret が増えない）。
- 公開面は vendor 障害に劣化モードで応答する（stale / unavailable）。
- 「Notion で編集 → build で反映」の経路が、fixture だけでなく実際の API
  呼び出しコードまで含めて存在する（token を差すだけで動く）。

### 4.2 コスト / 制約

- 反映は operator の実行に依存する。自動化しないと決めたことの直接の帰結。
- 公開述語が 2 箇所（SQL / `isPublicRecord`）になる。テストで固定している。
- snapshot schema と D1 schema の 2 つを保守する。
- 未対応 block は error である。作者は節見出しの語彙（6 種）に従う必要がある。

### 4.3 品質ゲートへの影響

- `integration:scope:check` — notion 行の status 変更と allowlist entry は
  同一 PR で必要。**entry は owner が記録する**（agent は書かない）。
- `legal`（`assets:license:check`）— 旧メディアは権利未記録のため、移行時は
  全て `hold` から始まる。
- `bundle:budget:check` — §2.7 の判断に効く。
- `scripts/*.test.mjs` — `scripts/sync-portfolio-notion.test.mjs` が
  「拒否時に何も書かない」「401 で書かない」「5xx で unavailable + 既知内容保持」
  を固定する。

## 5. Open questions（owner の判断。この ADR は決めない）

1. **`quality/integration-scope.json#allowlist.entries` の追加** — agent は
   書かない。形式は `docs/migration/notion-cms-integration-scope-draft.md` §4 に
   案がある。
2. **integration token の実体** — Infisical の環境・path、database id。
   値は Issue に書かない。
3. **公開承認の置き場** — Notion の property を入力とし、承認は repository の
   記録に置く（§2.6）か、承認も Notion に寄せるか。前者を提案している。
4. **反映の自動化** — build-time のみで運用を続けるか、将来 scheduled sync を
   追加するか（追加する場合は失敗監視と §4 の service 判断が要る）。
5. **旧サイトの全件移行**（#766）の範囲と、draft 80 件 / `mechanical_drop` 91 件
   の扱い。
6. **引用した人名（依頼者名）を含むタイトルの公開可否** — 権利・プライバシー。

## 6. Rejected alternatives

- **runtime read**: 公開経路が vendor に依存し、token が Worker に載り、差分
  review を失う。
- **Notion を直接編集 UI としてサイトに埋め込む**: 認証・権限・CSRF の面が
  一気に増え、§4 の追加 service と新しい公開境界が必要になる。対象外。
- **`/integrations/*` を mount して OAuth で接続する**: 誰の grant で読むのかが
  未定義。この ADR は internal connection token を offline tooling の
  credential としてのみ扱う。
- **scheduled sync + PR workflow**: 2026-11-01 の owner 指示で明示的に却下。
  「代表的な項目で経路を証明する」目的に対して運用コストが見合わない。

## 7. References

- `docs/domain/integrations.md` — 候補 roster と promotion condition
- `docs/security/integration-token-scope.md` — scope / retention / revocation
- `docs/domain/project-introductions.md` — offline snapshot の前例
- `scripts/sync-project-introductions.mjs` — 失敗時の 2 分類
- `docs/runbook/notion-portfolio-sync.md` — token 投入と実行手順
- `docs/migration/notion-cms-audit-2026-11-01.md` — 現状監査
- Notion API: `Notion-Version: 2025-09-03`（data source model の最小 version）。
  `POST /v1/databases/{id}/query` は 2025-09-03 で deprecated。
  取得は `GET /v1/databases/{id}` → `data_sources[]` →
  `POST /v1/data_sources/{id}/query` の 3 段。
