# Glossary

> Status: **Draft** — owner 自身が本文を埋めるまで Draft のまま
> Visibility: public (MIT)

ADR / docs / Skills で使う用語集。 ここで定義された語は他 doc で再定義しない。

## Architecture

### Obligation

コードの集合が **同じ規則・authority・lifecycle に支配されている** 状態。 code の物理構造ではなく、 identity の単位。 `path` は obligation graph の projection に過ぎない。

### Governing invariant

obligation を定義する上位規則・契約・判断権限の集合。 obligation の identity 本体。 co-change はこれを観測する手段であって、 定義ではない。

### Authority

obligation の decision power を保持する主体。 人やチームではなく **判断権限そのもの**。 例: "editorial visual language の決定権" / "Cloudflare deployment contract の決定権"。

### Change reason

obligation を変更させる契機。 obligation を **定義する** ものではなく、 仮説を **検証する** もの。 co-change 観測は evidence。

### Dependency direction

obligation の認知可能範囲。 上流 (誰に知ってよいか) / 下流 (誰に知られるか) で表現する。 双方向依存は負債。

### Boundary value

obligation を物理分離することで実際に防げる blast radius / 獲得できる独立性。 概念分離可能でも boundary value が小さければ物理分離しない (YAGNI on structure)。

### Debt / Debt Identity

「obligation として同一である」 という identity。 DRY (Don't Repeat Yourself) より Debt Identity を優先する。

### Duplication

物理的に同じ実装が複数箇所に存在すること。 **shared obligation の証拠であって証明ではない**。 同一 obligation と判定するには invariant / authority / lifecycle / expected evolution の 4 つ全部が一致する必要がある。

### Slice

obligation cluster を垂直に切り出した検証単位。 ADR accept の前に 1 slice で stress matrix を通過させる。

### Vertical slice

1 つの obligation cluster を end-to-end で動かす最小実装。

### Stress matrix

slice に当てる変更シナリオ表。 圧力 (新機能追加 / 外部サービス交換 / UI 変更 / framework 交換 / 共通化 / 共通化解除 / ownership 変更 / 一時的実験 / 性能最適化 / 横断 policy 追加 / framework 強制構造 / 要件消滅) を slice に適用して局所化を観測する。

### Promotion

capability-scoped な obligation が cross-capability obligation に昇格すること。 観測 (複数 capability からの co-use) が要件。

### Demotion

cross-capability な obligation が capability-scoped に降格すること。 観測 (使用範囲の縮小) が要件。

### Foreign boundary

framework / toolchain が物理構造を強制する領域。 例: `routes/`, `.storybook/`, `migrations/`, `public/`, generated, dist。 思想の例外ではなく、 toolchain への foreign boundary obligation として承認する。

### Cross-cutting obligation

複数 capability から呼ばれる policy obligation。 例: telemetry, authorization, locale, feature-flags, accessibility, rate limiting。 `shared/` に逃げず独立 obligation として成立させる。

### Capability

site が露出する user-facing 機能 / content。 URL と 1:1 強制はしない (1 capability が複数 route を持つ / 1 route に複数 capability が composition される どちらも許容)。

### Integration

外部サービスとの契約。 capability-scoped のうちは capability 内部に置き、 観測で cross-capability obligation になった時点で top-level に昇格。

### Visual language

特定の authority が所有する visual 規則の集合。 例: editorial, product, dashboard。 それぞれ独立 obligation。 同名 primitive は 4 つの identity 基準が全部一致するまで別物として扱う。

## Process

### Sprint

1 週間 = 1 target semantic version = 1 release branch の単位。

### Release

target version を cut するイベント。 release branch から main への PR。

### Ticket

GitHub Issue と 1:1 の作業単位。 1 ticket = 1 ticket branch = 1 ticket PR。

### Ticket branch

ticket number を branch name にする。 `123`, `456`。 `issue/` prefix や prose 不可。

### Release branch

`release-x-y-z` 形式。 0-diff でない限り常に active Draft PR を持つ。

### Validation gate

`pnpm run validate:fast` / `validate:integration` / `validate:release` の 3 段階。 local agent と GitHub Actions は同じ entry point を使う。

### Release PR merge human gate

release PR の merge / tag push / GitHub Release 公開は owner の明示的承認なしに実行しない。

## Notes

> TODO — owner 補足、 上記以外の語彙
