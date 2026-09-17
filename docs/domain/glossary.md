# Glossary

> Status: **Canonical terminology**
> Visibility: public (MIT)

my-web-2026 の docs / ADR / Skills で architecture と delivery を議論するときの用語を定義する。同じ言葉を別の意味で使う必要がある場合は、暗黙に上書きせずこの文書を更新する。

## Architecture

### Obligation

何かを存在させることで発生する、正しさ・変更・依存・検証・撤去に関する責任のまとまり。物理的な file / class / package ではなく、architecture 上の identity の候補である。

### Debt

obligation を引き受けることで発生する継続的な責任。bad code の同義語ではない。必要な feature、外部 service、data、public contract も debt を持つ。目標は debt の消滅ではなく、所在と owner が明示されている状態である。

### Debt Identity

複数の implementation が「同じ obligation を表している」と判断できる identity。主に governing invariant / authority / lifecycle / expected evolution の一致で判断し、syntax や見た目の一致だけでは決めない。

### Governing invariant

その obligation が変更後も守るべき真実・規則・契約。

### Authority

ある判断を行う decision power。人名そのものではなく「self-narrative を決める権限」「deployment contract を決める権限」のように表す。

### Lifecycle

obligation が生成され、維持され、終了する時間的境界。例: per content item / per project / per release / per external channel / continuous。

### Change reason

変更を発生させる具体的な圧力。boundary identity の定義ではなく、identity 仮説を検証する evidence として使う。

### Co-change

二つ以上の領域が同じ変更で一緒に修正される観測。shared obligation の evidence になり得るが、それだけでは同一 debt の proof ではない。

### Dependency direction

どの obligation がどの obligation を知ってよいかという認知方向。import direction だけでなく、schema、event、runtime contract、public API への依存も含む。

### Boundary value

物理的・論理的に分離することで得られる実利。blast radius の縮小、独立した検証、交換可能性、authority の分離など。概念上分けられても value がなければ構造を増やさない。

### Capability

visitor または owner に意味のある outcome を提供する機能領域。URL と 1:1 ではない。一つの capability が複数 route を持つことも、一つの route が複数 capability を compose することもある。

### Vertical slice

一つの capability / obligation cluster を、UI から data / runtime boundary まで end-to-end で検証できる最小単位。抽象的な architecture を先に完成させるのではなく、slice で圧力を観測する。

### Stress matrix

vertical slice に複数の変更圧力を当て、boundary が変更を局所化できるか確認する検証表。新機能、UI 変更、framework 交換、backend 追加、共通化・共通化解除、ownership 変更、一時実験、性能最適化、policy 追加、要件消滅などを含む。

### Promotion

local obligation を、観測に基づいてより広い scope の obligation に昇格させること。

### Demotion

shared / cross-capability obligation を、観測に基づいて狭い scope に戻すこと。promotion と同じく通常の architecture evolution であり、失敗扱いしない。

### Cross-cutting obligation

複数 capability に効く独立 policy。authorization、telemetry、locale、accessibility など。単なる `shared/` convenience bucket とは区別する。

### Integration

外部 service と my-web-2026 の間にある継続的な contract。単なる external link は integration ではない。API、webhook、OAuth、sync、billing 等で lifecycle / failure / auth / rate limit を所有して初めて integration obligation が発生する。

### Foreign boundary

framework / runtime / toolchain が project に物理構造や contract を強制する境界。`src/routes/`、Storybook config、migrations、generated output、Cloudflare entrypoint など。project architecture の例外ではなく、外部 authority との adapter surface として扱う。

### Visual language

特定の presentation authority が所有する、typography / color / spacing / motion / interaction などの表現規則のまとまり。複数 visual language の共存を許容し、見た目が似ているだけでは統合しない。

## Delivery

### Sprint

1 週間 = 1 target semantic version = 1 release branch を基本とする delivery unit。

### Ticket

一つの top-level GitHub Issue と、それを実装する ticket branch / ticket PR の作業単位。

### Ticket branch

Issue number を branch name に使う canonical ticket branch。

### Release branch

`release-x-y-z` 形式の integration line。ticket の landing 先であり、`main` への唯一の release source。

### Release

release branch の内容を `main` に landing し、必要な tag / GitHub Release を公開する event。

### Validation gate

同じ project contract を異なる深さで検証する entry point: `validate:fast` / `validate:integration` / `validate:release`。

### Release PR merge human gate

release PR merge、release tag push、GitHub Release 公開に owner の明示的承認を要求する boundary。CI green や release-ready 判定は approval の代替にならない。
