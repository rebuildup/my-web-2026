# 技術関心 inventory — AI・OS・言語・フレームワーク

> Status: **Canonical technical-interest inventory**
> Visibility: public (MIT)
> Audience: owner, contributor, agent, future-self
> Issue: #528（`docs(influences): AI・OS・言語・フレームワークの関心を事実ベースで管理`）
> Preview: `src/personal/tech-interests/TechInterests.stories.tsx`（Storybook の `personal/Tech interests`）
> Data: `src/personal/tech-interests/TechInterests.preview.ts`
> Grounded: 2026-10-28

Miro の board「好きなもの > 開発・AI」のうち、**言語 / OS / ライブラリ / フレームワーク** と **AI（モデル / 開発ツール）** の関心を、スキルの表示ではなく事実ベースで管理するための文書である。

Miro の付箋にはアクセスできない。Issue #528 本文が引用した見出し語（好きなもの > 開発・AI、言語 / OS / ライブラリ / フレームワーク、AI → 各モデル / 開発ツール）だけが Miro 由来の典拠であり、それ以外の Miro 固有の情報はこの文書に存在しない。

## 1. この文書の目的

AI・OS・言語・フレームワーク・ライブラリに対する技術関心を、状態ごとに分けた事実ベースの inventory として管理する。

- 『好き』『試した』『制作で使った』『現在使用』は、それぞれ別の意味を持つ状態として定義する。1 つの平坦なリストに並べ替えると、どの状態なのかが読めなくなる。
- 根拠は「このリポジトリに実在する記録」に限る。Miro の付箋にはアクセスできないため、Issue 本文が引用した見出し語だけが典拠になる。
- 観察できないことは「未確認（owner 確認待ち）」として残す。空いた欄を推測で埋めない。
- 全ツールの宣伝 LP は作らない。記録に残すのは、状態と根拠と観測日だけでよい。

この文書が**しない**ことは次の 3 つ。

1. 技術の優劣を評価しない。各項目の state は関心と関係の記録であって、技術の順位ではない。
2. 公開 surface を出さない。公開 copy は owner の承認を要するため、公開は別 Issue で行う（§9）。
3. 最新の版を主張しない。観測日つきの記録であり、「いま最も新しいもの」ではない。

## 2. 状態の定義

この inventory が使う 4 状態と、それぞれが何を主張しないかの定義。

- 現在使用: いま手元の開発環境と、このプラットフォームの運用で実際に使っている。
- 制作で使った: このリポジトリの外にある出荷済み作品（Aulymo / MultiSlicer / Tastile）で実際に使った。
- 試した: 触れて評価したが、出荷済み作品にも現在のツールチェーンにも使っていない。評価記録だけが残っているものもこの状態に入る。
- 好き / 関心: 関心はあるが、利用の記録がこのリポジトリ内に存在しない。
- 4 状態は排他で、同じ対象が 2 つの状態に同時に現れることはない。根拠が複数あるときは、より強い関係（現在使用 > 制作で使った > 試した > 好き / 関心）を採る。
- 現在使用は「記録が存在する」ことだけでは成立しない。採用記録（adoption）や実 $HOME への配置のような肯定的な記録で支えられるときだけ成立する。存在記録しかない対象は、より弱い状態に置く。

状態の主観性と owner の権限については [`docs/personal/knowledge-model.md`](../personal/knowledge-model.md) が正本である。この inventory は「assert / close subjective state は proposal only」という規則の下で、**観察と記録**だけを行う。owner が明示していない好みを、記録の側に増やすことはしない。

## 3. 現在使用（currently using）

いま手元の開発環境と運用で実際に使っているもの。

観測日 `2026-10-28` はこの記録を読んだ日、`2026-10-20` は snapshot 側の `verifiedAt` / `fetchedAt` である。観測日が違うのは、根拠が別の記録だからである（§8）。

### `TypeScript`

- 状態: 現在使用
- 分類: 言語
- 観測日: 2026-10-28
- 根拠: `package.json`
- 備考: 実装言語。このリポジトリのソースはすべて TypeScript で書かれている。

### `React`

- 状態: 現在使用
- 分類: ライブラリ
- 観測日: 2026-10-28
- 根拠: `package.json`
- 備考: UI の実装基盤。Routes と server function の両方が React 19 上にある。

### `Cloudflare Workers`

- 状態: 現在使用
- 分類: プラットフォーム
- 観測日: 2026-10-28
- 根拠: `cloudflare.config.ts`
- 備考: 本番のランタイムでありデプロイ先。単一 Worker で全 surface を配信する。

### `Cloudflare D1 / R2`

- 状態: 現在使用
- 分類: プラットフォーム
- 観測日: 2026-10-28
- 根拠: `src/cloudflare/health.ts`
- 備考: SQL は D1、公開画像は R2。health probe が両方の binding を実際に叩いている。

### `TanStack Start`

- 状態: 現在使用
- 分類: フレームワーク
- 観測日: 2026-10-28
- 根拠: `package.json`
- 備考: Web フレームワーク。route と server function を提供する層。

### `Hono`

- 状態: 現在使用
- 分類: フレームワーク
- 観測日: 2026-10-28
- 根拠: `src/http/hono.ts`
- 備考: 外部 HTTP boundary の実装。Worker entry が path prefix で dispatch する。

### `Panda CSS`

- 状態: 現在使用
- 分類: ライブラリ
- 観測日: 2026-10-28
- 根拠: `src/editorial/tokens.ts`
- 備考: styling 基盤。token 層と primitive を editorial が所有する。

### `@cloudflare/vite-plugin`

- 状態: 現在使用
- 分類: ツール
- 観測日: 2026-10-28
- 根拠: `package.json`
- 備考: 2.0.0-beta.sha-c82c3efb3 に固定。1.x 系の記録は §7 の保留側にある。

### `cf CLI`

- 状態: 現在使用
- 分類: ツール
- 観測日: 2026-10-28
- 根拠: `package.json`
- 備考: build / typegen / deploy を実行する CLI。Wrangler からの移行先はここ。

### `pnpm`

- 状態: 現在使用
- 分類: ツール
- 観測日: 2026-10-28
- 根拠: `package.json`
- 備考: package manager。12.3.4。

### `Biome`

- 状態: 現在使用
- 分類: ツール
- 観測日: 2026-10-28
- 根拠: `quality/profile.yaml`
- 備考: format と lint を 1 つの binary で担う。validate:fast の先頭で毎回走る。

### `Vitest`

- 状態: 現在使用
- 分類: ツール
- 観測日: 2026-10-28
- 根拠: `package.json`
- 備考: unit / integration test の runner。

### `GitHub Actions`

- 状態: 現在使用
- 分類: ツール
- 観測日: 2026-10-28
- 根拠: `.github/workflows`
- 備考: CI と release の自動化の実行環境。

### `macOS`

- 状態: 現在使用
- 分類: OS
- 観測日: 2026-10-20
- 根拠: `src/keyboard/sources/manifest.json`
- 備考: keyboard manifest の adoption 記録が mac-kanata（role: pc-setup-adopted）を採用 ref として宣言している。構成が存在するのではなく、採用が記録されている。

### `Kanata`

- 状態: 現在使用
- 分類: ツール
- 観測日: 2026-10-20
- 根拠: `src/keyboard/sources/manifest.json`
- 備考: macOS の採用 ref は installer が pin する config_ref。repository head は自動追随しない。

### `hidutil`

- 状態: 現在使用
- 分類: ツール
- 観測日: 2026-10-20
- 根拠: `src/keyboard/catalog.ts`
- 備考: 物理キーボードを大西配列へ変換する macOS 標準の remap 機構。

### `Claude Code`

- 状態: 現在使用
- 分類: AI ツール
- 観測日: 2026-10-20
- 根拠: `src/projects/snapshots/dotfiles.json`
- 備考: ネイティブの claude command は公式 login を保持し、wrap も alias もしない。

### `Codex`

- 状態: 現在使用
- 分類: AI ツール
- 観測日: 2026-10-20
- 根拠: `src/projects/snapshots/dotfiles.json`
- 備考: agent 設定が sibling submodule として固定している。

### `OpenCode`

- 状態: 現在使用
- 分類: AI ツール
- 観測日: 2026-10-20
- 根拠: `src/projects/snapshots/dotfiles.json`
- 備考: agent 設定が sibling submodule として固定している。

## 4. 制作で使った（used in production）

このリポジトリの外にある出荷済み作品で実際に使ったもの。

根拠はいずれも `src/portfolio/seed.ts` であり、その entries は `docs/personal/domain.md` §8 / §9 を根拠に書かれた構造化記録である。観測日 `2026-09-18` は `docs/personal/domain.md` の grounded 日付。

### `After Effects SDK`

- 状態: 制作で使った
- 分類: プラットフォーム
- 観測日: 2026-09-18
- 根拠: `src/portfolio/seed.ts`
- 備考: MultiSlicer（2023 - present）。C++ の effect plugin として配布した。

### `Premiere Pro SDK`

- 状態: 制作で使った
- 分類: プラットフォーム
- 観測日: 2026-09-18
- 根拠: `src/portfolio/seed.ts`
- 備考: MultiSlicer の technologies として記録されている。

### `ExtendScript`

- 状態: 制作で使った
- 分類: 言語
- 観測日: 2026-09-18
- 根拠: `src/portfolio/seed.ts`
- 備考: Aulymo（2022 - present）。After Effects の lyric motion を作る tool。

### `Kotlin`

- 状態: 制作で使った
- 分類: 言語
- 観測日: 2026-09-18
- 根拠: `src/portfolio/seed.ts`
- 備考: Tastile（2024-06 - present）の multi-client 開発で使った。

### `Rust`

- 状態: 制作で使った
- 分類: 言語
- 観測日: 2026-09-18
- 根拠: `src/portfolio/seed.ts`
- 備考: Tastile の technologies として記録されている。docs/personal/domain.md §5 は Rust を「展開中の関心」に置くが、確認できる使用の根拠は tastile なので、この状態の方が強い。

### `Tauri`

- 状態: 制作で使った
- 分類: フレームワーク
- 観測日: 2026-09-18
- 根拠: `src/portfolio/seed.ts`
- 備考: Tastile の desktop client。

## 5. 試した（tried — 採用には至っていない）

触れて評価したが、出荷済み作品にも現在のツールチェーンにも使っていないもの。

この節の観測には「採用しなかった理由の記録」（ADR）が含まれる。ADR は判断の記録であり、試行そのものの証拠ではない。だからここでも主張は「採用に至っていない」までで、「試した」の意味は §2 の定義のとおり「評価記録が残っている」ことに限られる。

### `yomiyasu`

- 状態: 試した
- 分類: ライブラリ
- 観測日: 2026-10-18
- 根拠: `docs/adr/ADR-0017-unicode-normalization-and-url-slug-separation.md`
- 備考: Python の校正ライブラリ。校正と slug 規則は同じ obligation ではないうえ、Python はこのプラットフォームの runtime ではないため採用しなかった。

### `cf.botScore`

- 状態: 試した
- 分類: プラットフォーム
- 観測日: 2026-09-19
- 根拠: `docs/adr/ADR-0010-abuse-protection-rate-limit.md`
- 備考: Cloudflare の bot スコア。server-to-server API が自動的な呼び出しと区別できないため、明示的に採用しないと決めた。

### `Cursor`

- 状態: 試した
- 分類: AI ツール
- 観測日: 2026-10-20
- 根拠: `src/portfolio/seed.ts`
- 根拠（補助）: `src/projects/snapshots/dotfiles.json`
- 備考: project-init（2025-06 - present）の technologies として記録されているが、2026-10-20 時点の agent 構成記録に名前は出ない。「いま使っていない」ことの証拠ではなく、「現在の使用記録がない」ことまでしか主張しない。

### `Kanata（Windows 側の設定）`

- 状態: 試した
- 分類: ツール
- 観測日: 2026-10-20
- 根拠: `src/keyboard/sources/manifest.json`
- 備考: 取得・解析して snapshot に取り込んだ Windows 側の設定。採用 ref として選ばれているのは macOS 側だけで、installer が更新されるまで自動追随しない。

### `Windows`

- 状態: 試した
- 分類: OS
- 観測日: 2026-10-20
- 根拠: `src/projects/snapshots/dotfiles.json`
- 備考: agent launcher に Windows 用の PowerShell entry script がある。対応のための記録であって、いま Windows を開発環境として使っている記録ではない。keyboard manifest の採用 ref も macOS 側だけ。

### `OpenRouter / DeepSeek / MiniMax / OpenCode Zen`

- 状態: 試した
- 分類: AI プロバイダ
- 観測日: 2026-10-20
- 根拠: `src/projects/snapshots/dotfiles.json`
- 備考: unified agent launcher の opt-in 経路として設定されている。既定経路は公式 login 側で、この一覧が現在の推奨になることはない。

## 6. 好き / 関心（liked — 利用の記録はない）

関心はあるが、このリポジトリ内に利用の記録がないもの。

- docs/personal/domain.md §5 の「展開中の関心」には Rust / backend / low-level / 機械的検証 / agent evaluation / real-time graphics / cross-platform が挙がるが、そのうち Rust と cross-platform は §4 に出荷物での使用の根拠があるため、より強い状態（制作で使った）を採った。残りは本節の対象ではない。

### `p5.js`

- 状態: 好き / 関心
- 分類: ライブラリ
- 観測日: 2026-09-18
- 根拠: `docs/personal/domain.md`
- 備考: creative coding への関心として記録されている library。作品としての使用記録は repository 内にない。

### `WebGL`

- 状態: 好き / 関心
- 分類: プラットフォーム
- 観測日: 2026-09-18
- 根拠: `docs/personal/domain.md`
- 備考: code 自体を表現手段として使うことへの関心として記録されている。

## 7. 古い推奨を現在の推奨として表示しない規則

観察が置き換わったら、推奨は引き継がれる。引き継がれた側の観測だけが現在の推奨になる。

- 各観察には観測日（observedOn）を必ず付ける。観測日を添えない記述は、いまの推奨として読めない。
- ある観察が別の観察に置き換わったら、古い側には supersededBy を付け、古い側は保留の一覧にだけ出す。
- 現在の推奨一覧は supersededBy を持たない観察から機械的に導く。手書きの「現在の推奨」リストは持たない。
- この節の 2 件は実際に引き継がれた例であり、古い側を現在の推奨として表示してはならない。

この規則は「運用上の注意」ではなく **データの構造** として担保される。`CURRENT_RECOMMENDATIONS` は `state === 'currently-using' && supersededBy === undefined` から導出され、`SUPERSEDED_OBSERVATIONS` は `supersededBy !== undefined` から導出される。両者は排他なので、古い推奨を現在の推奨として表示する状態はデータとして表現できない。`scripts/check-tech-interests-preview-parity.test.mjs` がこの構造を検証する。

### `Wrangler`

- 状態: 現在使用
- 分類: ツール
- 観測日: 2026-10-04
- 根拠: `docs/adr/ADR-0016-cf-migration-plan.md`
- 備考: 当時の推奨だった Cloudflare CLI。移行が進行中のため依存は tree に残っているが、現在の推奨は cf CLI 側であり、Wrangler 単体を現在の推奨として表示しない。
- 置き換え: `cf CLI`（観測日 2026-10-28）

### `@cloudflare/vite-plugin 1.x`

- 状態: 現在使用
- 分類: ツール
- 観測日: 2026-10-04
- 根拠: `docs/adr/ADR-0016-cf-migration-plan.md`
- 備考: 当時の固定は ^1.0.0 だった。現在の固定は 2.0.0-beta 側であり、1.x の記述を現在の推奨として表示しない。
- 置き換え: `@cloudflare/vite-plugin`（観測日 2026-10-28）

## 8. 観察日と出典の規則

観察日・出典・誰が何を確定できるかの規則。

- 観察日は ISO の日付（YYYY-MM-DD）で、記録が読まれた日、または snapshot の verifiedAt / fetchedAt / committedAt を使う。
- 出典は repository 内の実在するパス、または公開済みの URL。存在しないファイルや未公開の URL は書かない。
- 主観的な状態（好き / 関心 / 意向）の確定は owner の権限。agent は観察と提案までで、owner の発言を勝手に作らない。
- 同じ対象について相反する記録が両方あるときは、観測日が新しい方を採用し、古い方を保留として残す。

出典は **`docs/personal/owner.md` の grounding precedence** に従う。owner の明示 > `docs/personal/domain.md` の canonical statement > 現在の公開 site / repository data > 日付つきの公開記録 > 履歴文書 > 推論。最后の「推論」は公開事実として出力しない。

`src/projects/snapshots/dotfiles.json` の snapshot は `commitSha` と `verifiedAt` を持ち、`src/keyboard/sources/manifest.json` は `syncedAt` / `fetchedAt` を持つ。本 inventory の観測日はそれらの値を使うか、記録を読んだ日を使うかである。

## 9. 採用 / 保留の判断

この Issue で採用するもの、保留にして別 Issue と owner 判断に回去もの。

- 採用: 4 状態の定義、観測日つき inventory、supersede 規則、単独で描ける Storybook preview、Markdown と preview データの一致検証。
- 保留: 公開 route への接続。独立 preview の契約は Issue #380 が所有しており、この Issue は接続しない。
- 保留: Miro の付箋の逐語記録。agent は Miro にアクセスできないため、Issue 本文が引用した見出し語だけを典拠とする。
- 保留: AI モデルの最新版番号の追跡。外部情報への定期アクセスが必要なため、この Issue の範囲外。
- 保留: この inventory の公開 surface への表示。公開 copy は owner の承認を要するため、この Issue では公開しない。

採用した部分だけを「完成」と読ませることもない。上の 5 行的うち 4 行が保留である。第 1 行のみが今回の完了条件に含まれる。

## 10. 未確認（owner 確認待ち）

このリポジトリからは確認できず、owner に確認を要する事項。

- Miro の付箋にある AI モデルの一覧と、各モデルごとの位置づけ。
- my-web-2025 時代に別の styling を使っていた時期があったかどうか。
- Cursor の現在の使用状況。記録に名前がないことは「使っていない」ことの証拠ではない。
- 各 AI モデルの最新版番号。観測日ごとに記録する対象であり、agent は最新と主張しない。
- Windows をいま手元の開発環境として使っているか。dotfiles に Windows 用の entry script があることは対応の記録にすぎず、採用の記録ではない。

これらは未確認のまま残す。埋められるのは owner が結果を書いてからであり、agent が推測で埋めることではない。
