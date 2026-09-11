# my-web-2026 初期化レポート (Final report)

> プロジェクトの初期化完了時点における状態の集約。`docs/release.md` /
> `docs/architecture.md` / `docs/backlog-0.1.0.md` を一次情報とし、
> 本レポートはそれらへの index。

## 1. 採用した stack と version

| Layer             | Choice                            | Pinned version | Source of truth                |
| ----------------- | --------------------------------- | -------------- | ------------------------------ |
| Runtime           | Cloudflare Workers                | compatibility_date `2026-09-07` | `wrangler.jsonc`     |
| Framework         | TanStack Start (Router + Start)   | `^1.168.52`    | `package.json`                 |
| Build / SSR       | Vite + `@cloudflare/vite-plugin`  | `^7.1.0` / `^1.0.0` | `vite.config.ts`          |
| UI runtime        | React + React DOM                 | `^19.2.0`      | `package.json`                 |
| External HTTP     | Hono (boundary only)              | `^4.13.7`      | `src/boundary/`                |
| Styling           | Panda CSS                         | `^1.12.1`      | `panda.config.ts`              |
| Type system       | TypeScript                        | `^5.9.0`       | `tsconfig.json`                |
| Test runner       | Vitest                            | `~4.1.0`       | `vitest.config.ts`             |
| Worker toolchain  | Wrangler                          | `^4.131.0`     | `wrangler.jsonc` / scripts     |
| Worker test plug. | `@cloudflare/vitest-plugin`       | `^1.0.0`       | wired in 0.1.0 (#003)          |
| Package manager   | pnpm (corepack)                   | `12.3.4`       | `packageManager` field         |

言語とランタイムに関する explicit な非採用:

- Bun (my-web-2025 の選択) — Panda 公式ガイド・workspace 整合性・
  クロスプラットフォームの三点で pnpm を採用 (ADR-0003)。
- Tailwind — Panda CSS を採用 (ADR-0005)。
- KV / Queues / Durable Objects / Workflows / Vectorize / Workers AI
  — 0.1.0 では導入しない (ADR-0004)。

## 2. repository 構成

```
my-web-2026/
├── AGENTS.md                 # ルート契約 (11 セクション, progressive disclosure)
├── README.md
├── CONTRIBUTING.md
├── package.json
├── pnpm-workspace.yaml       # onlyBuiltDependencies allowlist
├── tsconfig.json
├── vite.config.ts            # cloudflare + tanstackStart + react
├── vitest.config.ts          # 別ファイルでバンドラ干渉を回避
├── panda.config.ts
├── postcss.config.mjs
├── wrangler.jsonc            # main: "@tanstack/react-start/server-entry"
├── worker-configuration.d.ts # `pnpm run cf-typegen` 生成物
├── .gitignore                # dist/ styled-system/ .wrangler/ ...
├── .editorconfig
├── src/
│   ├── client.tsx            # hydrate (createRouter)
│   ├── server.tsx            # placeholder (entry は virtual module)
│   ├── router.tsx            # createTanStackRouter
│   ├── start.ts              # createMiddleware().server で Hono へ委譲
│   ├── routes/
│   │   ├── __root.tsx
│   │   └── index.tsx         # loader → domains/health/application
│   ├── styles.css
│   ├── boundary/             # Hono 外部境界 (ONLY)
│   │   ├── index.ts          # externalBoundary アプリ
│   │   └── health.test.ts
│   ├── domains/              # domain-oriented backend
│   │   ├── README.md
│   │   └── health/application.ts
│   ├── features/             # feature-oriented frontend
│   │   └── README.md
│   └── infra/                # 横断基盤 (env / design tokens / ...)
│       ├── env.ts
│       ├── design-tokens.ts
│       └── README.md
├── test/
│   ├── README.md
│   └── index.spec.ts
├── docs/
│   ├── architecture.md
│   ├── development.md
│   ├── release.md
│   ├── security.md
│   ├── recovery.md
│   ├── troubleshooting.md
│   ├── backlog-0.1.0.md
│   ├── init-report.md        # ← 本ファイル
│   └── adr/
│       ├── ADR-0001-stack-selection.md
│       ├── ADR-0002-architecture-boundary.md
│       ├── ADR-0003-package-manager.md
│       ├── ADR-0004-cloudflare-services-policy.md
│       ├── ADR-0005-design-system.md
│       ├── ADR-0006-tools-submodule-policy.md
│       └── ADR-0007-quality-gate-compilation.md
├── quality/
│   └── profile.yaml          # gate 機械可読定義
├── skills/                   # 8 project-local Skills
│   ├── github-delivery/SKILL.md
│   ├── quality-gate/SKILL.md
│   ├── parallel-orchestration/SKILL.md
│   ├── sandbox-runtime/SKILL.md
│   ├── engineering-decisions/SKILL.md
│   ├── security-maintenance/SKILL.md
│   ├── onboarding/SKILL.md
│   └── agent-recovery/SKILL.md
├── .github/
│   └── workflows/ci.yml      # 3 jobs (validate-fast/integration/release)
└── tools/                    # Tools ディレクトリ (submodule 予約, 0.1.0 は空)
    └── README.md
```

レイヤ責務 (詳細は `docs/architecture.md`):

| レイヤ          | パス                       | 役割                                |
| --------------- | -------------------------- | ----------------------------------- |
| UI              | `src/features/**`          | feature-oriented frontend           |
| Server functions| `src/domains/**`           | domain application ロジック        |
| External boundary | `src/boundary/**`        | Hono — 外部 HTTP 入口 ONLY          |
| Persistence     | `src/domains/**/adapters/` | D1 / R2 / external API              |
| Infra           | `src/infra/**`             | 横断基盤 (env / tokens / runtime)   |
| Contracts       | `src/domains/**/contracts/`| ドメイン間 I/F 型定義               |
| Entry / SSR     | `src/{client,server,start,router}.tsx` | TanStack Start wiring |

## 3. 作成した ADR と project-local rules

### ADR (7 本, `docs/adr/`)

1. **ADR-0001 Stack selection** — Cloudflare + TanStack Start + Hono
   boundary + modular monolith + feature-oriented FE + domain-oriented
   BE + Panda CSS + Tools submodule + D1/R2。
2. **ADR-0002 Architecture boundary** — 内部 / 外部の分離と
   `createMiddleware().server` による Hono 接続。
3. **ADR-0003 Package manager** — pnpm 12.3.x (Bun 不採用の理由を
   明示)。
4. **ADR-0004 Cloudflare services policy** — 0.1.0 は Worker +
   Static Assets のみ。KV / Queues / DO / Workflows / Vectorize /
   Workers AI を後発 ADR で再評価する。
5. **ADR-0005 Design system** — 基礎トークンのみ。semantic レイヤと
   共通コンポーネントは 0.2.0 以降。
6. **ADR-0006 Tools submodule policy** — 双方向 import 禁止、pin、
   manifest contract、0.1.0 は submodule を追加しない。
7. **ADR-0007 Quality gate compilation** — 3 つの決定論的 entry
   point、change-risk → verification マッピング、coverage threshold
   は 0.1.0 では無効。

### Project-local rules

- **AGENTS.md** — ルート契約 (11 セクション、progressive disclosure
  で PROMPT.ja.md を埋め込みまない)。
- **README.md / CONTRIBUTING.md** — 公開 surface の最小規約。
- **`quality/profile.yaml`** — gate を CI から直接解釈可能な形で定義。
- **8 Skills** — `skills/*/SKILL.md` (GitHub delivery / quality gate
  / parallel orchestration / sandbox runtime / engineering decisions
  / security maintenance / onboarding / agent recovery)。
- **`.github/workflows/ci.yml`** — 3 jobs、concurrency cancel、
  pnpm cache、timeout 設定。

## 4. local dev / test / build / preview commands

| 目的                         | コマンド                              | 想定時間 |
| ---------------------------- | ------------------------------------- | -------- |
| Install                      | `corepack enable pnpm && pnpm install` |          |
| Panda codegen (postinstall)  | `pnpm prepare`                        |          |
| Dev server                   | `pnpm dev` (Vite, `127.0.0.1:3000`)   | 秒       |
| Build (Cloudflare Worker)    | `pnpm build`                          | 秒〜分   |
| Preview (Cloudflare local)   | `pnpm preview`                        | 秒       |
| CF types                     | `pnpm cf-typegen`                     | 秒       |
| Lint / Format                | `pnpm lint` / `pnpm format`           | 秒       |
| Typecheck                    | `pnpm typecheck` (`tsc --noEmit`)     | 秒       |
| Unit test                    | `pnpm test` (`vitest run`)            | 秒       |
| Fast gate                    | `pnpm run validate:fast`              | 秒       |
| Integration gate             | `pnpm run validate:integration`       | 秒       |
| Release gate                 | `pnpm run validate:release`           | 分       |
| Deploy (dry-run)             | `pnpm exec wrangler deploy --dry-run` | 秒       |
| Deploy (real)                | `pnpm deploy`                         | 分       |

`pnpm install` 直後の `validate:fast` は **PASS** を確認済み
(1 test file / 2 tests 通過、typecheck クリーン、lint 未配線のため
現状は format / typecheck / test のみ — `quality/profile.yaml` の
coverage_policy.enabled は false)。

## 5. Cloudflare integration 状態

- `wrangler.jsonc`:
  - `name: my-web-2026`
  - `main: "@tanstack/react-start/server-entry"` (Vite plugin 仮想)
  - `compatibility_date: 2026-09-07`
  - `compatibility_flags: ["nodejs_compat", "global_fetch_strictly_public"]`
  - `assets.directory: ./dist/client`, `assets.binding: ASSETS`
  - `observability.enabled: true`, `upload_source_maps: true`
  - Bindings はコメントで予約 (D1 / R2 / KV / Queues / DO は 0.1.0
    Issue #004 / #005 / #002 配下で追加)。
- `pnpm build` (Vite + Cloudflare plugin) が成功し、
  `pnpm exec wrangler deploy --dry-run` も成功 (バンドル:
  約 1002 KiB / gzip 約 200 KiB)。
- `worker-configuration.d.ts` は `pnpm run cf-typegen` の出力で
  コミット対象 (binding 追加 PR で同時更新)。
- `src/start.ts` の `createMiddleware().server` が
  `EXTERNAL_BOUNDARY_PREFIXES` (`/api/v1`, `/webhooks`, `/oauth`,
  `/integrations`) にマッチした path を Hono `externalBoundary` に
  委譲し、それ以外は `next()` で TanStack Start 側に渡す。
- 0.1.0 で commit / push する Cloudflare 契約は「Worker + Static
  Assets」のみ。Smart Placement / KV / Queues / Durable Objects /
  Workflows / Vectorize / Workers AI は ADR-0004 で 0.1.0 範囲外。

## 6. quality gate

3 つの決定論的 entry point (`quality/profile.yaml` と
`skills/quality-gate/SKILL.md` に同期):

| Gate                  | 含むもの                                              | 想定起動条件                            |
| --------------------- | ----------------------------------------------------- | --------------------------------------- |
| `validate:fast`       | `panda codegen` → `lint` → `format --check` → `tsc` → `vitest run` | ローカル push 前、PR 作成直後          |
| `validate:integration`| `validate:fast` + `vite build` + `wrangler deploy --dry-run --outdir=dist-cloudflare/` + 0.1.0 で追加する `@cloudflare/vitest-plugin` SELF smoke | PR が Ready になる前                  |
| `validate:release`    | `validate:integration` + `cf-typegen` チェック + release 分岐でのみ走る destructive 検証 | `release-x-y-z` push / PR へ昇格時 |

CI (`.github/workflows/ci.yml`) はこの 3 ジョブを並列起動し、
`concurrency.cancel-in-progress: true` で冗長 run を止める。coverage
threshold は 0.1.0 では false。秘密走査のみ非同期 job で有効化、
依存 / SAST / container 走査は 0.2.0 以降の ticket。

## 7. 0.1.0 sprint goal

> Establish my-web-2026's canonical architecture and dev / build /
> deploy foundation. Empty-site Cloudflare production-equivalent
> release is acceptable.

期間: 2026-09 (週 1 sprint)。成功条件:

1. `main` が canonical remote に保護されて存在。
2. `pnpm run validate:fast` と `validate:integration` が CI 緑。
3. D1 / R2 バインディングの smoke が Worker boot で通る。
4. `portfolio` / `content` / `activity` の feature skeleton と
   `tools` domain skeleton が main に存在。
5. 1 つの example webhook が Hono 境界で受理される。
6. `release-0-1-0` が `main` にマージされ、`v0.1.0` が tag される。

## 8. 0.1.0 の Issue 一覧と dependency

| #    | Title                                                | Depends on | Type             | Priority |
| ---- | ---------------------------------------------------- | ---------- | ---------------- | -------- |
| #001 | Confirm canonical remote and visibility              | —          | governance       | P0       |
| #002 | Apply `main` protection + release-source check       | #001       | governance / CI  | P0       |
| #003 | Wire `@cloudflare/vitest-plugin` into integration    | —          | test infra       | P1       |
| #004 | Add D1 binding smoke                                 | #002       | infra            | P1       |
| #005 | Add R2 binding smoke                                 | #002       | infra            | P1       |
| #006 | Bootstrap `portfolio` feature module                | #004       | feature          | P2       |
| #007 | Bootstrap `content` feature module                  | #004       | feature          | P2       |
| #008 | Bootstrap `tools` domain module (spec only)          | —          | domain / arch    | P2       |
| #009 | First external integration (example webhook)        | #005       | feature          | P2       |
| #010 | Bootstrap `activity` feature module                 | —          | feature          | P2       |
| #011 | Cut the 0.1.0 release PR                            | #001–#010  | release          | P0       |

dependency graph (詳細は `docs/release.md` / `docs/backlog-0.1.0.md`):

```
#001
 └─ #002
     ├─ #004 ── #006
     │       └ #007
     └─ #005 ── #009

#003 (独立)
#008 (独立)
#010 (独立)

#001..#010 → #011
```

## 9. 未解決 blocker

1. **Canonical remote 未作成** — `my-web-2026` の GitHub 公開 remote
   が未決定。Issue #001 で「作成 / visibility 決定 /
   main 保護ルール設定」を要求。これが解けないと #002 の CI 必須
   チェックが構成できない。
2. **Lint ルール未配線** — `pnpm lint` は script として存在するが
   0.1.0 では `format --check` と `tsc` で代替。ESLint の本格導入は
   0.2.0 で ADR を起こす (理由: 0.1.0 はアーキテクチャ foundation
   であり lint ルールは style 議論を伴うため foundation を歪めない)。
3. **`@cloudflare/vitest-plugin` の SELF smoke** — plugin は依存に
   含まれるが `validate:integration` への組み込みは #003。#003 が
   着くまでは外部 smoke が走らない。
4. **LICENSE ファイル** — `public` を選択した場合 MIT / Apache-2.0
   のいずれかを #001 で決める必要あり。決定までは `LICENSE` を
   リポジトリに置かない。
5. **0.1.0 のスコープ外 (明示的な deferral)** — KV / Queues /
   Durable Objects / Workflows / Vectorize / Workers AI、
   共通 design system コンポーネント、submodule Tools、coverage
   threshold、SAST / dependency review / container scanning。

## 10. 次に着手すべき Issue

**#001 Confirm canonical remote and visibility** — すべての後続
ticket (Issue を GitHub に登録する行為自体) と #002 (main 保護)
がこれに連鎖するため、ここが 0.1.0 の最初の PR の前段になる。

並列着手できるもの (dependency なし):

- **#003** Wire `@cloudflare/vitest-plugin` into `validate:integration`
- **#008** Bootstrap `tools` domain module (Tool Registry spec only)
- **#010** Bootstrap `activity` feature module

これらは #001 の決定待ちではなく main が手元にあれば着手可能。
ただし #003 は CI 必須チェックを追加するため、#002 (main 保護) が
完了する前にマージすると main に対する direct push を要求する
経路に載る。最終的には #001 → #002 → #003 の順で main に載せる
のが安全。

## 11. 起動手順 (operator 用)

```bash
# 1. clone (canonical remote 作成後)
git clone <canonical-remote> my-web-2026
cd my-web-2026

# 2. install
corepack enable pnpm
pnpm install
pnpm prepare

# 3. ローカル検証
pnpm run validate:fast

# 4. dev server
pnpm dev   # http://127.0.0.1:3000

# 5. Cloudflare 互換性プレビュー
pnpm build
pnpm exec wrangler deploy --dry-run
```

CI は `.github/workflows/ci.yml` が自動で走り、`AGENTS.md` /
`docs/architecture.md` / `skills/github-delivery/SKILL.md` を
参照しながら Issue / PR / release を回す。
