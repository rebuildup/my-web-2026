# ADR-0008: Obligation-oriented source architecture

- Status: Proposed
- Date: 2026-09-19
- Extends: ADR-0001, ADR-0002, ADR-0005
- Superseded by: None

## Context

0.1.0 では `src/modules/<capability>/`、`src/design-system/`、
`src/platform/` を先に用意し、model / service / repository / server / ui の
固定 template で source を整理した。

0.2.0 の Home 実装でこの構造を使うと、分類と ownership が一致しない箇所が現れた。

- D1 / R2 probe は Home の画面都合ではなく Cloudflare runtime contract で変わる。
- `ui/`, `model.ts`, `server.ts` は存在理由ではなく実装種別を分類する。
- generic design-system は、まだ 1 つしか観測されていない visual language を
  将来の共有物として先取りしている。
- framework が強制する `routes/` は technical path だが実在する contract を所有する。

固定 template を別の固定 template に置き換えるのではなく、source 境界を実際の
obligation から導く。

## Decision

### 1. Obligation is primary; path is a projection

obligation は同じ governing invariant / decision authority / lifecycle に
支配される仕事として扱う。path / module / public API は ownership を navigation と
dependency に反映した結果である。

「何が変わったとき一緒に変わったか」は boundary を検証する evidence として使うが、
同じ delivery で変更されたこと自体を同一 obligation の定義にはしない。

### 2. Boundary evaluation

1. **Obligation** — 何について責任を負うか。
2. **Change reason** — どの判断・契約が変わると変更されるか。
3. **Authority** — その判断を最終的に決定する権限は何か。
4. **Dependency direction** — どの owner がこの contract を知ってよいか。
5. **Lifecycle** — 何と一緒に生まれ、何と一緒に消えるか。

Owner は現在担当している人や team 名ではなく、判断権限を指す。

### 3. Generic classifiers are not architecture boundaries by default

`modules/`, `components/`, `ui/`, `models/`, `services/`,
`repositories/`, `utils/`, `shared/`, `platform/` のような名前を
同じ実装種別を入れるためだけに作らない。

technical name 自体は問題ではない。`http/`, `cloudflare/`, `routes/`,
runtime entrypoint のように独立した contract / authority / lifecycle を所有すれば
有効な境界になる。

### 4. Physical separation must pay for itself

概念上異なる obligation があっても、すべてを directory に分ける必要はない。
分離で ownership、blast radius、dependency、navigation のいずれも改善しないなら
近い owner の中に留める。小さい file を増やすこと自体を correctness としない。

### 5. Abstraction follows observed pressure

shared abstraction、cross-capability adapter、second visual language は先取りしない。

重複は shared obligation の可能性を示す evidence だが、同じ invariant /
authority / lifecycle / expected evolution が観測されるまでは統合しない。

一度 shared へ昇格した boundary でも独立性が消えた場合は local owner の下へ降格できる。

### 6. Current source projection

```text
src/
├─ home/
├─ editorial/
├─ cloudflare/
├─ http/
├─ routes/
├─ server.ts
├─ client.tsx
└─ router.tsx
```

これは将来 feature 用の schema ではない。

```text
routes -> home
home/status -> cloudflare
home/status -> http
home -> editorial
server -> http
```

lower-level runtime / visual owner は Home を import しない。

## Validation before acceptance

この ADR は PR #30 の source rewrite と一緒に検証する。

- `pnpm run validate:integration` green
- Playwright E2E green
- Home section / capability status / Cloudflare probe / editorial spacing の
  change scenario で不要な cross-owner edit が発生しない
- architecture docs と実装 path が一致する

## Consequences

### Positive

- file の置き場所が種類ではなく owner から決まる。
- runtime / visual / surface の変更理由を別々に追える。
- generic shared layer への責任流出を抑えられる。
- framework-imposed structure を外部契約として正面から扱える。
- obligation の昇格・降格が可能で project growth に追従できる。

### Negative / Trade-offs

- sibling directory の shape は均一にならない。
- ownership を考えず機械的に file を置くことは難しくなる。
- 細分化しすぎると navigation cost が増えるため physical boundary の価値を判断する必要がある。
- 初期 boundary 仮説は将来誤りと分かる可能性があり、移動を許容する必要がある。

## Re-evaluation triggers

- auth / telemetry / i18n / caching 等の cross-cutting policy が複数 owner を横断する。
- 2 つ目の visual language が実装される。
- Cloudflare 以外の runtime implementation が必要になる。
- 1 つの変更で複数 obligation を毎回編集する状態が続く。
- 独立させた boundary が常に同じ authority / lifecycle で動くと観測される。
