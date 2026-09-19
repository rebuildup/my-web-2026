# Architecture

> 現在の source ownership を 1 ページで示す。判断理由は
> `docs/adr/`、実装詳細は source を参照する。

## Source ownership

my-web-2026 は 1 Worker / 1 repository の deployment monolith だが、
source は固定 layer や file type ではなく **obligation** で境界を作る。

obligation は、同じ規則・判断権限・ライフサイクルに支配される仕事の集合である。
path はその境界を見える形にした結果であり、path 自体を先に設計しない。

```text
src/
├─ home/
│  ├─ composer.tsx
│  ├─ hero.tsx
│  ├─ footer.tsx
│  ├─ capabilities/
│  │  ├─ capability.ts
│  │  ├─ registry.ts
│  │  └─ grid.tsx
│  └─ status/
│     ├─ health.ts
│     ├─ services.ts
│     ├─ load.ts
│     └─ tiles.tsx
├─ editorial/
│  ├─ tokens.ts
│  ├─ semantic-tokens.ts
│  └─ primitives/
├─ cloudflare/
│  └─ health.ts
├─ http/
│  ├─ hono.ts
│  └─ health.ts
├─ routes/
├─ server.ts
├─ client.tsx
└─ router.tsx
```

この tree は template ではない。新しい feature を追加するときに
`home/` と同じ形を複製しない。新しい仕事について owner / change reason /
dependency / lifecycle を確認し、その結果として必要な境界だけを作る。

## Current obligations

### `home/`

canonical home surface の composition と Home 固有の表示判断を所有する。

- `composer.tsx` — Home の reading order と page composition
- `capabilities/` — Home が公開する capability inventory とその表示
- `status/` — platform health を Home 上でどう説明するか
- `hero.tsx` / `footer.tsx` — Home 固有の public communication

Home は Cloudflare binding の probe 方法を所有しない。

### `editorial/`

現在の public surface が話す editorial visual language を所有する。

raw / semantic tokens と、その visual language の primitive をまとめる。
これは「全 UI component の共有置き場」ではない。別の visual language が必要に
なった場合、観測された同一 obligation がない限り自動的には統合しない。

### `cloudflare/`

Cloudflare runtime によって変更理由が決まる仕事を所有する。

現在は D1 / R2 health probe がここにある。Home は public-safe な health contract
だけを消費し、binding API や probe implementation を知らない。

### `http/`

外部 HTTP contract を所有する。

- `hono.ts` — external REST / webhook / OAuth / integration boundary
- `health.ts` — この boundary の stable health description

### `routes/` and runtime entries

`routes/` は TanStack Start の file-based routing contract によって場所が決まる。
`server.ts`, `client.tsx`, `router.tsx` も runtime/framework contract の
entrypoint である。

これらは technical name だが、単なる分類ではなく独立した外部契約を所有するため
有効な obligation boundary である。

## Dependency direction

```text
routes ───────────────▶ home
home/status ─────────▶ cloudflare
home/status ─────────▶ http
home ────────────────▶ editorial
server ──────────────▶ http
```

逆向きは禁止する。

- `cloudflare/` は `home/` を知らない。
- `http/` は `home/` を知らない。
- `editorial/` は特定 surface を知らない。
- framework route は Home を bind するが、Home は route file を知らない。

## TanStack Start / Hono boundary

```text
Cloudflare Worker
        │
        ▼
src/server.ts
        │
        ├─ /api/v1/* /webhooks/* /oauth/* /integrations/*
        │       ▼
        │   src/http/hono.ts
        │
        └─ everything else
                ▼
       @tanstack/react-start/server-entry
```

TanStack Start の default CSRF middleware を維持するため、custom
`src/start.ts` / `startInstance` は ADR なしで追加しない。

UI から使う internal operation は TanStack Start server function とする。
第三者向け stable HTTP contract は Hono が所有する。

## How boundaries are evaluated

新しい boundary を作る前に最低限次を確認する。

1. **Obligation** — 何を守る仕事か。
2. **Change reason** — どの判断・契約が変わると変更されるか。
3. **Authority** — その判断を最終的に決める権限は何か。
4. **Dependency direction** — どこまでがこの仕事を知ってよいか。
5. **Lifecycle** — 何と一緒に生まれ、何と一緒に消えるか。

「同時に変更された」は boundary 仮説を検証する evidence であり、同一 obligation
であることの定義ではない。

物理的な directory 分離にもコストがある。独立した概念を見つけても、分離によって
blast radius / ownership / navigation が改善しないなら無理に directory を増やさない。

## Promotion and demotion

共有化は一方向ではない。

- local な実装が独立した contract / authority / lifecycle を持つようになれば昇格する。
- shared/cross-surface な boundary が 1 owner だけの仕事に戻れば、その owner の下へ降格できる。
- duplication は shared obligation の候補を示す evidence であって、統合の証明ではない。

将来利用されるかもしれない、という理由だけで shared layer や adapter を先に作らない。

## Persistence and deployment

Bindings は `wrangler.jsonc` が canonical source である。binding を変更したら
`pnpm run cf-typegen` を実行し、`worker-configuration.d.ts` を同じ PR に含める。

| Binding | Name | Purpose |
| --- | --- | --- |
| D1 | `DB` | Structured content |
| R2 | `MEDIA` | Blobs / media |
| Assets | `ASSETS` | Vite static assets |

SELF integration tests は local workerd / Miniflare 上の contract を確認する。
real Cloudflare resource smoke は release cut で確認する。

## Verification

Architecture boundary の変更は path の見た目だけで承認しない。
代表的な change scenario を当て、変更が想定 owner に局所化されるか確認する。

- Home に section を追加する → `home/` と route binding 以外へ不要な変更を漏らさない。
- D1 / R2 probe を変更する → `cloudflare/` が変更を所有し、Home composition は維持する。
- editorial spacing を変更する → `editorial/` が変更を所有し、platform code は触らない。
- routing convention を変更する → `routes/` / runtime entry が変更を所有し、Home の意味を変えない。

詳細は ADR-0008 を参照する。
