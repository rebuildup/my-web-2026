# Capabilities

> Status: **Draft** — owner 自身が本文を埋めるまで Draft のまま
> Visibility: public (MIT)

my-web-2026 が露出する capability を 6-criterion で表にする。 **Status / Authority / Governing invariant / Lifecycle / Notes** のいずれかが空欄の行は obligation 未確定 (観測待ち)。

## Table

| ID | Capability | Status | Authority | Governing invariant | Lifecycle | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| home | Top page composition | active (0.2.0) | TODO | TODO | TODO | slice 検証対象 |
| about | About page text | TODO | TODO | TODO | TODO | |
| cv | CV structured entries | TODO | TODO | TODO | TODO | |
| contact | Contact channels + form | TODO | TODO | TODO | TODO | |
| identity | Canonical identity entity | TODO | TODO | TODO | TODO | shared data obligation 候補 |
| work-dev | Dev portfolio | TODO | TODO | TODO | TODO | |
| work-video | Video portfolio | TODO | TODO | TODO | TODO | |
| work-design | Design portfolio | TODO | TODO | TODO | TODO | |
| tools | Self-made tools directory | TODO | TODO | TODO | TODO | |
| writing | Long-form notes / articles | TODO | TODO | TODO | TODO | |
| shop | Sold content | TODO | TODO | TODO | TODO | |
| pricing | Pricing tables (video commissions) | TODO | TODO | TODO | TODO | |
| activity | Recent commits / releases / shipped work timeline | TODO | TODO | TODO | TODO | may consume github integration |
| operations | System status / health (D1/R2/Hono) | TODO | TODO | TODO | TODO | may consume cloudflare/health-probe |
| job-hunting | Job-hunting data | TODO | TODO | TODO | TODO | may consume notion integration |

## Status 列の規約

- `active (x.y.z)` — 該当 release で slice 通過済み
- `planned (x.y.z)` — 該当 release 着手予定
- `partial` — 一部 obligation のみ実装済み
- TODO — 未確定、 slice で観測してから決定

## Authority 列の規約

人名ではなく **判断権限** を書く。 例:

- home-surface authority
- self-narrative authority
- career-history authority
- contact-policy authority
- identity-data authority
- platform-health authority

## Governing invariant 列の規約

その capability が **何について真実であるべきか** を書く。 例:

- home: "canonical surface composition"
- about: "autobiographical consistency"
- cv: "factual timeline"
- pricing: "price-rule consistency"

## Lifecycle 列の規約

capability が **何と共に生まれ何と共に消えるか** を書く。 例:

- "indefinitely" — owner が生きている限り
- "per release" — release branch 寿命
- "per channel" — contact channel の寿命
- "per quarter" — pricing の更新周期
- "per project" — work portfolio の個別 project 寿命
- "continuous" — 連続運用 (operations / activity)

## Notes

> TODO — owner が各 capability について追加する注記、 ADR との対応、 関連 integration、 過去の co-change 観測
