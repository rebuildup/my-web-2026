# Personal knowledge model

> Status: **Canonical temporal / authority semantics**
> Visibility: public (MIT)
> Audience: domain design, future CMS, contributor, agent
> Grounded: 2026-09-18

この文書は personal data の全 schema を先に設計するものではない。

将来 CMS や structured storage を作るときに失ってはいけない、**時間と authority に関する意味論だけを固定する**。

実際の table、JSON shape、API、RBAC、CMS UI は必要になった時点で決める。

## Principle: current profile is not canonical history

「現在の自分」を一つの mutable profile object として保存し、それを上書きし続けない。

personal domain には、時間的性質の違う情報が存在する。

- ある時点で起きたこと
- ある期間だけ成立する状態
- その時点で持っている好み・関心・意図
- それらから現在向けに組み立てた表示

これらを同じ更新方法で扱わない。

## Temporal categories

### Historical Event

過去のある時点で発生した出来事。

例:

- 2023年11月に Adobe を購入した
- 2023年に宇部高専へ入学した
- 2026年8月に internship へ参加した
- ある release を公開した

出来事そのものは、発生後に未来から変化しない。

通常は append-only と考える。ただし記録内容が間違っていた場合は訂正できる。**history is immutable; knowledge about history is correctable.**

日付の精度を捏造しない。年しか分からない事実は year、月までなら month として保持できる意味論を残す。

### Temporal State

ある期間に成立する状態。

例:

- 宇部高専に在学している
- ある handle を利用している
- ある project を active にしている
- frontend engineering を主軸に活動している

現在値を上書きするのではなく、成立期間を閉じて次の状態を追加できるようにする。

過去の state は「古くなった誤情報」ではなく、その期間についての正しい history になり得る。

### Preference / Interest / Intention

subjective な Temporal State。

例:

- 映像制作が好き
- Rust に関心がある
- generic な portfolio 表現を好まない
- software engineer を主軸に就職したい

これらは owner がその時点で持っている自己認識・嗜好・方向性であり、未来まで真である保証はない。

変化した場合は過去を消さず、新しい assertion を追加して時間軸を作る。

「映像制作が好き」と「2023年11月に Adobe を買った」は同じ data class ではない。

### Projection

Event / State / Preference / Intention から、特定時点・特定 audience のために作る表示。

例:

- 現在のプロフィール文
- Home hero の肩書き
- About page
- CV
- 現在好きなもの一覧
- portfolio の facet

Projection は canonical personal fact ではない。元データや authority が変われば再生成できる。

プロフィール文章を canonical data として固定しない。

## Two notions of time

将来 structured storage を作る場合、少なくとも次の二つを区別できることが望ましい。

- **valid / occurred time** — 現実世界でいつ成立・発生したか
- **recorded time** — my-web-2026 がいつその情報を記録したか

たとえば 2026年に「Adobe を買ったのは 2023年11月だった」と記録した場合、2023年11月と2026年は別の意味を持つ。

この区別により、後から情報が判明した場合や、過去記録を訂正した場合も history を壊さず扱える。

完全な bitemporal database を今実装する commitment ではない。意味論だけを失わない。

## Correction is not mutation of reality

Historical Event の record が訂正可能であることと、過去が変更可能であることを混同しない。

訂正が必要になった場合、将来の storage は少なくとも次を追跡できる余地を残す。

- 何を訂正したか
- なぜ訂正したか
- いつ訂正したか
- 何を根拠にしたか

実装方式は append-only、revision、supersedes relation などから必要時に選ぶ。

## Authority model

authorization は「誰が CMS にログインできるか」より先に、**どの意味の操作を誰が確定できるか**を定義する。

### Operations

- **observe** — source や external evidence を収集する
- **propose** — new record / correction / state change を提案する
- **record** — Historical Event を personal knowledge として確定する
- **correct** — 既存 knowledge の誤りを訂正する
- **assert** — Temporal State / Preference / Intention を owner の現在認識として確定する
- **close** — temporal assertion の valid period を終了させる
- **publish / unpublish** — public projection に利用可能かを決める
- **derive** — canonical knowledge から Projection を生成する
- **administer authority** — 上記 authority の委譲・変更を決める

### Current authority

現在は owner-operated / single-author であり、最終 authority は owner が持つ。

| Operation | Agent / contributor | Owner |
| --- | --- | --- |
| observe | yes | yes |
| propose | yes | yes |
| derive | yes, canonical knowledge の範囲内 | yes |
| record | proposal only | final authority |
| correct | proposal only | final authority |
| assert / close subjective state | proposal only; owner の発言を勝手に作らない | final authority |
| publish / unpublish personal knowledge | proposal only | final authority |
| administer authority | no | final authority |

将来 trusted editor や automated integration を追加しても、この表の role をそのまま database role にする必要はない。operation 単位の authority を capability / source ごとに委譲できればよい。

## Source authority is contextual

すべての personal data を owner が手入力する必要はない。

将来は source に応じて authority を分けられる。

例:

- GitHub release event は GitHub integration を observation source にできる
- school enrollment の current interpretation は owner が確定する
- preference / intention は owner の explicit assertion を必要とする
- project metrics は authoritative external source から derive できる

外部 source が authoritative でも、**public に出す authority** まで自動的に持つとは限らない。

data truth と publication policy を分離する。

## Visibility is independent from truth

正しい personal knowledge であることと、public site に表示してよいことは別である。

将来の model では少なくとも、truth / temporal semantics と publication / audience policy を同じ field に潰さない。

同じ Event でも public、private、限定公開など異なる扱いがあり得る。

my-web-2026 の public repository には private data 自体を置かない。

## What is intentionally deferred

現時点では次を決めない。

- CMS 製品・framework
- database table
- JSON / TypeScript schema の完全形
- event sourcing の採否
- append-only storage の実装方式
- RBAC / ABAC の具体方式
- editor role の種類
- admin UI
- sync strategy
- versioning / migration format

これらは実際の consumer と変更圧力が観測されてから決める。

## Invariants for future implementation

将来 CMS / API / database を導入しても、次は維持する。

1. Historical Event と mutable current state を同じ更新モデルにしない。
2. Preference / Interest / Intention は temporal であり、owner の過去の状態を上書き消去しない。
3. Projection を canonical personal fact にしない。
4. occurred / valid time と recorded time を混同しない。
5. 記録の訂正と、過去そのものの変更を混同しない。
6. truth authority と publication authority を分離できる。
7. agent / integration が observation を行えても、subjective assertion を勝手に確定しない。
8. data schema はこの意味論を実装する手段であり、意味論そのものではない。
