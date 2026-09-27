# Capabilities

> Status: **Observed inventory**
> Visibility: public (MIT)
> Grounded: 2026-09-27

この文書は「将来ありそうな page 一覧」ではなく、my-web-2026 で観測できる capability と、my-web-2025 から得られる migration evidence を区別して記録する。

## Status vocabulary

- **live** — current release branch に end-to-end implementation が存在する。
- **planned** — current code / accepted ticket が明示的に planned と宣言している。
- **observed legacy** — my-web-2025 に user-facing responsibility が存在したが、my-web-2026 で独立 capability として確定していない。
- **facet candidate** — 別 capability の facet である可能性が高く、独立 boundary は未観測。
- **uncommitted** — idea / scaffold に出現しただけで、current domain commitment とする evidence がない。

## Current / grounded inventory

| ID | Capability | Status | Governing invariant | Authority | Lifecycle | Dependency / boundary evidence |
| --- | --- | --- | --- | --- | --- | --- |
| home | Canonical top page | **live (0.2.0)** | site の現在地・live/planned state・次の導線を誤認させない | home-surface authority | per release + continuous | `src/modules/home/**` が vertical slice として存在 |
| platform-status | D1 / R2 / external boundary health | **live inside home (0.2.0)** | 到達性を現在の観測として表示し、raw error / binding internals を漏らさない | platform-health authority | continuous | current consumer は home のみ。top-level promotion は未観測 |
| portfolio | Selected work / project portfolio | **live (0.5.0 surface; publication curation pending)** | 掲載作品の provenance と owner による selection を保つ。runtime surface と content publication curation を分離する | portfolio-curation authority | per project | `migrations/0007_portfolio.sql` + `src/portfolio/` obligation。Issue #76 D1 schema + loader、Issue #77 UI、Issue #78 migration infrastructure (UPSERT / role grounding) landed。owner publication approval は未着手、publication count = 0 |
| content | Long-form content / posts | **planned** | authored content の本文・公開状態・chronology を正しく保つ | editorial authority | per content item | `CAPABILITIES` で planned。current module なし |
| activity | Commits / releases / shipped work timeline | **planned** | event の source と時系列を捏造せず、derived activity として再構成する | activity-observation authority | continuous / per event | `CAPABILITIES` で planned。GitHub 等は integration 候補に留まる |
| identity | Public professional identity | **grounded knowledge / runtime not implemented** | real name・handle・role・self narrative を同一人物として一貫させる | self-narrative / identity-data authority | continuous | `docs/personal/domain.md` が canonical grounding。`/about` (Issue #102) / `/contact` (Issue #103) が runtime surface として grounded identity を投影するが、shared `identity` runtime module は作らない |
| about | Narrative profile surface | **live (0.5.0)** | owner が意図した自己紹介を現在の事実として表現する | self-narrative authority | per publication revision | Issue #102 + PR #111 + follow-up PR #112。`src/about/**` obligation + `/about` route、repo-controlled `ABOUT_DATA`、5-section narrative (identity / interests / experience / current / future) + finds-me-elsewhere footer |
| cv | Education / achievements / career chronology | **deferred (0.6.0+)** | factual timeline と provenance を保つ | career-fact authority | per fact | canonical CV dataset が未作成。decision doc §"What we defer" 参照 |
| contact | Contact channels | **live (0.5.0)** | 現在利用可能な channel だけを公開し、用途を誤らせない | contact-policy authority | per channel | Issue #103 + PR #110。`/contact` route、repo-controlled channels.json、30-day `verified_at` freshness gate (fail-closed) |
| tools | Owner-made tools directory | **live (0.5.0)** | tool の ownership / version / distribution boundary を誤らせない | tools-publication authority | per tool | Tool Registry (Issue #80, ADR-0006) + `/tools` index + `/tools/<slug>` route + ProtoType same-origin artifact pilot (Issue #81)。`scripts/check-architecture.mjs` で tool boundary を強制 |
| work-dev | Development works grouping | **facet candidate** | portfolio 内で development work を正しく分類する | portfolio-curation authority | per project | 独立 lifecycle / authority は未観測 |
| work-video | Video works grouping | **facet candidate** | portfolio 内で video work を正しく分類する | portfolio-curation authority | per project | 活動カテゴリ evidence はあるが独立 capability 未確定 |
| work-design | Design works grouping | **facet candidate** | portfolio 内で design work を正しく分類する | portfolio-curation authority | per project | 同上 |
| writing | Articles / notes presentation | **facet candidate of content** | authored truth を別 authority に二重化しない | editorial authority | per content item | `content` と identity が分かれる evidence が出るまで独立させない |
| commission | Development / video request information | **uncommitted (Issue #79, decision doc)** | 受付可否・scope・contact を現在の条件として正しく表示する | commission-policy authority | per offering | Issue #79 decision で 2026 drop 確定。次回 open は別 ticket |
| pricing | Commission pricing / estimate rules | **uncommitted (Issue #79, decision doc)** | price rule と適用条件を一貫して表現する | pricing-policy authority | per pricing revision | 同上 |
| shop | Sold content / distribution | **uncommitted** | 未確定 | 未確定 | 未確定 | scaffold 以外に my-web-2026 の current evidence がない |

## Personal-domain dependency

Home / About / Portfolio / Content / Activity など人物を扱う capability は、人物像を capability ごとに再定義しない。identity / experience / taste / current / future の上流 truth は [`../personal/domain.md`](../personal/domain.md) を参照し、各 capability は自分の outcome に必要な view だけを投影する。

これは runtime に shared identity module を先行実装することを意味しない。knowledge-level の共通 truth と code-level abstraction は別の obligation である。

## What is intentionally not decided

### Identity is not automatically a shared module

About、Portfolio、Content が同じ handle や profile data を参照する可能性は高いが、「複数で使いそう」だけで top-level identity abstraction を作らない。

二つ以上の capability が実際に同じ invariant / lifecycle の identity data を必要とした時点で promotion を評価する。

### Work categories are not capabilities by default

development / video / design は owner の活動領域としては実在するが、architecture 上の capability かどうかは別問題である。

portfolio の filter / facet で十分なら分離しない。異なる publication policy、data lifecycle、visual authority が観測された場合にのみ別 capability を検討する。

### Legacy does not mean planned

my-web-2025 に存在した page や機能は migration evidence であって、my-web-2026 の backlog commitment ではない。

移行時は route parity ではなく obligation identity を再評価する。
