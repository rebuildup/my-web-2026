# Integrations

> Status: **Observed integration inventory**
> Visibility: public (MIT)
> Grounded: 2026-09-18

integration は「外部サービス名が登場すること」ではなく、my-web-2026 がその service との継続 contract を所有することを意味する。

外部 link、repository URL、social profile URL は integration ではない。

## Current state

0.2.0 時点で、application capability として promotion された top-level third-party integration は **ない**。

| ID | Service | Current status | Current owner | Promotion condition | Evidence / note |
| --- | --- | --- | --- | --- | --- |
| github | GitHub API / events | **not integrated** | none | activity 等が API / webhook / auth / rate limit を継続的に所有し、複数 consumer で identity が一致したとき | Source repository への link は存在するが API integration ではない。未結線の参照アダプタ（`src/external-api/github.ts`, Issue #499）は信頼性契約の検証対象であり、runtime の外部通信は 0 件。integration ではない |
| notion | Notion API | **uncommitted** | none | 実際の capability が Notion data を source of truth として読む必要が生じたとき | scaffold 上の候補のみ。current code evidence なし |
| discord | Discord API | **uncommitted** | none | webhook / OAuth / bot event を capability が実際に必要としたとき | current code evidence なし |
| stripe | Stripe API | **uncommitted** | none | billing / checkout obligation が current product scope に入り、price / payment lifecycle を所有するとき | old commission surface があっても Stripe 採用の evidence にはならない |

### Unwired reference adapters are not integrations

`src/external-api/`（Issue #499）は、外部 read の一貫した信頼性契約（timeout / stale
timestamp / 非破壊 fallback / breaker）を持ち、アダプタ 1 件で証明する obligation である。

- 参照アダプタは **どの capability からも参照されていない**。route に結線されていないので、
  Worker は外部 API に 1 リクエストも送らない。
- 参照アダプタの存在は promotion の根拠に**ならない**。上の「Capability-scoped first」の
  観測条件（二つ以上の capability が同じ external contract を使う等）を満たすまで、status は
  `not integrated` のまま。
- アダプタを増やしても integration を作らない。`contract.ts`（snapshot と failure vocabulary）
  が共有されていることが、共通 contract を持つ consumer 数の観測として積み上がる。

## Platform dependencies are not third-party integrations

次は active だが、この文書でいう application integration とは分ける。

| Platform boundary | Status | Obligation |
| --- | --- | --- |
| Cloudflare Workers | active | runtime / deployment |
| Static Assets `ASSETS` | active | built client assets |
| D1 `DB` | active | structured data binding |
| R2 `MEDIA` | active | media / blob binding |
| Hono | active internal adapter | external HTTP boundary `/api/v1/*`, `/webhooks/*`, `/oauth/*`, `/integrations/*` |

これらは platform / runtime debt であり、Notion や GitHub のような domain integration と同じ lifecycle ではない。

## Capability-scoped first

外部 service が初めて必要になった場合、原則としてその consumer capability の内側から始める。

例えば activity が GitHub events を読むだけなら、最初から top-level GitHub integration を作る理由にはならない。activity 内部の adapter として持ち、次を観測してから promotion を検討する。

- 二つ以上の capability が同じ external contract を使う。
- auth / rate limit / webhook verification / retry などの lifecycle が capability から独立する。
- 共通 contract test を一箇所で所有する boundary value が出る。
- governing invariant / authority / expected evolution が一致する。

## Promotion is not permanent

top-level integration に promotion した後でも、一つの consumer に縮退した、または consumer ごとに contract が分裂した場合は demotion できる。

「一度 shared にしたから shared のまま」は architecture invariant ではない。

## Integration acceptance questions

新しい service を導入するときは、少なくとも次を明示する。

- どの capability outcome のために必要か。
- credential / OAuth / webhook secret の authority はどこか。
- external SLA / rate limit / failure を誰が吸収するか。
- source of truth は local か remote か。
- sync の direction と conflict policy は何か。
- data deletion / revocation 時に何を撤去するか。
- capability-local に置けない具体的な boundary value があるか。

これらが未確定なら、service 名だけを architecture に先行登録しない。
