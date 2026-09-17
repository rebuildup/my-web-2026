# Domain overview

> Status: **Canonical domain grounding**
> Visibility: public (MIT)
> Audience: contributor, agent, future-self
> Grounded: 2026-09-18

## What this site is

my-web-2026 は **Personal Web Platform** である。

目的は portfolio ページを一枚作ることではなく、owner の公開活動を長期的に扱うための personal infrastructure を作ることにある。作品、文章、活動履歴、Tools、公開プロフィール、将来の integration は、単なる navigation category ではなく、それぞれの responsibility が観測された時点で capability / obligation として成立させる。

Web UI はその public surface の一つであり、domain model 全体と同一視しない。

## Relationship to my-web-2025

my-web-2026 は my-web-2025 の successor である。ただし route-by-route の互換実装を目的にしない。

my-web-2025 では About、Portfolio、Tools、依頼・料金、リンク、各種 utility など広い surface が一つの Web site に存在していた。この既存 surface は migration evidence として利用するが、「旧サイトにページがあった」ことだけでは my-web-2026 の独立 capability であることを意味しない。

移行単位は URL ではなく obligation である。

- 現在も必要な責任は、新しい domain で再定義して移行する。
- 別 capability の facet で十分なものは独立 module にしない。
- 現在の必要性を確認できないものは legacy evidence のまま保持する。
- 古い personal fact は current truth として自動継承しない。

## Current product state

### 0.1.0 Foundation

0.1.0 は 2026-09-11 に Foundation として成立した。

この段階で主に確立したのは、Cloudflare Workers 上の deployable shape、TanStack Start / Hono boundary、Panda CSS design-system foundation、D1 / R2 bindings、quality gates、release workflow である。

### 0.2.0

0.2.0 は canonical top page を最初の vertical slice として構築している。

現在コード上で観測できる user-facing state は次の通り。

- `home`: live。Personal Web Platform の canonical entry surface。
- platform health: `home` 内で live。Hono external boundary / D1 / R2 の到達性を表示する。
- `portfolio`: planned。
- `content`: planned。
- `activity`: planned。

`portfolio / content / activity` は home の static inventory で planned と宣言されているが、個別 route / module はまだ存在しない。

## Operating mode

owner-operated / single-author を基本とする public repository である。

contributor や agent が実装を担うことはできるが、personal narrative、public fact、architecture、integration、release の最終 authority は owner に残る。

## Stack

current repository contract:

- Runtime / deployment: Cloudflare Workers
- Web framework: TanStack Start
- External HTTP boundary: Hono
- UI: React 19.2.x
- Build: Vite 7.1.x
- Language: TypeScript 5.9.x
- Styling: Panda CSS
- Format / lint: Biome
- Package manager: pnpm
- Tests: Vitest + `@cloudflare/vitest-plugin`
- Browser E2E: Playwright
- Component development: Storybook

Tailwind CSS は styling owner ではない。Bun は default package manager ではない。

## Runtime bindings

current bindings:

- Static Assets: `ASSETS`
- D1: `DB` (`my-web-2026`)
- R2: `MEDIA` (`my-web-2026`)

KV、Queues、Durable Objects、Workflows、Vectorize、Workers AI などを追加する場合は、それ自体を新しい platform debt として ticket + ADR で評価する。

## HTTP boundary

external HTTP contract は Hono が所有する。

- `/api/v1/*`
- `/webhooks/*`
- `/oauth/*`
- `/integrations/*`

UI から使う internal application operation は TanStack Start server functions が所有する。両者を同じ「backend API」という理由だけで統合しない。

## Domain evolution

my-web-2026 の domain inventory は固定リストではない。

新しい capability は、ページを作りたいから追加するのではなく、独立した invariant / authority / lifecycle / boundary value が観測されたときに成立する。逆に、旧サイトで別ページだったものでも、同一 obligation の facet と判断できれば統合する。

現時点の inventory と確度は [`capabilities.md`](capabilities.md) を canonical とする。
