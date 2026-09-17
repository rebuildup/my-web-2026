# Domain overview

> Status: **Draft** — owner 自身が本文を埋めるまで Draft のまま
> Visibility: public (MIT)
> Audience: contributor, agent, future-self

## What this site is

> TODO — my-web-2026 が何であるかを owner の言葉で書く。 「personal infrastructure として owner を clone する」のような核を 1〜3 段落で

## What this site replaces

> TODO — my-web-2025 との関係を書く。 何を継いで何を変えたか、 互換性はあるか、 移行方針

## Operating mode

> TODO — single-person operation か、複数 contributor 想定か、 招待方針。 owner.md の operating mode と整合

## Stack

事実 (確定済み、 owner 確認のみ):

- Runtime / deployment: Cloudflare Workers
- Web framework: TanStack Start
- External HTTP boundary: Hono
- Styling: Panda CSS (Tailwind CSS 不使用)
- Format / lint: Biome (Prettier / ESLint 不使用)
- Package manager: pnpm (Bun 不使用)
- Tests: Vitest + `@cloudflare/vitest-plugin`
- UI: React 19.2.x, Vite 7.1.x, TypeScript 5.9.x

## Bindings in scope (v0.1.0)

事実 (確定済み):

- Static Assets (`ASSETS`)
- D1 (`DB`, database_name: my-web-2026)
- R2 (`MEDIA`, bucket_name: my-web-2026)

新しい service (KV, Queues, Durable Objects, Workflows, Vectorize, Workers AI) を追加する場合は ticket + ADR が必要。

## Release state

事実 (確定済み):

- 0.1.0 Foundation: released 2026-09-11
- 0.2.0: in progress (canonical top page 確立中)

## Target

> TODO — owner が書く。 0.3.0 以降の goal、 0.2.0 で達成したいこと、 個人インフラ philosophy の 0.2.0 での位置づけ

## Notes

> TODO — owner 補足、 他 doc への参照
