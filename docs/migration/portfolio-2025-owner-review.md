# Portfolio owner review (Issue #78)

This is the decision surface. Each row below is a legacy portfolio entry
that is technically eligible for migration but blocked on at least one
publication criterion. Owner approves / rewrites / rejects — the
migration script + verifier reflect that sign-off without changing the
classification script.

## How to approve a row

Edit `docs/migration/portfolio-2025-role-overrides.json`:

- add a `publication_overrides` entry for the `legacy_id`,
- set `publication: "approved"` and `publication_visibility: "public"`,
- if the row's role is not yet grounded, also add a `role_overrides`
  entry with the source citation,
- re-run `scripts/migrate-portfolio-from-2025.mjs --apply --target=local`.

## How to reject a row

Set `publication: "rejected"` in the override file. The migration
script skips the row entirely.

## Mechanical-drop rows (no owner action required)

91 rows fall into `mechanical_drop` and are
NEVER inserted. Most are `media-list-*` / `media-rt-*` UUID-named
CMS scaffold rows (empty summary / tags / assets / links / markdown)
or `test-otu-*` periodic status posts.

## Eligible + blocked (mechanical eligibility, owner authority pending)

60 rows fall in this surface. Grouped by blocker:

### `role_missing` (54)

| legacy id | title | migration_class | publication | role | publication_blockers | link_count | external_video | markdown | available_sections |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Border` | Ae縁取りエフェクト Border | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 2 | 0 | 1 |  |
| `FlashBeat-BGM` | FlashBeatテーマ曲(BGM) | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 1 | 1 | 1 |  |
| `FlashBeat-OP` | FlashBeatオープニング | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 1 | 1 | 1 |  |
| `FlashBeat` | FlashBeat | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 2 | 1 | 1 |  |
| `FoldLayers` | Aeプラグイン FoldLayers | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 3 | 0 | 1 |  |
| `LiteGlow` | 【Aeエフェクトプラグイン】LiteGlow | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `NullOto` | NullOto ソフトウェア型ノイズキャンセリングアプリ | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `ProtoType-brochure` | ProtoType パンフレット | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `ProtoType` | タイピングゲーム ProtoType | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `RGBDelay` | Aeエフェクトプラグイン RGBDelay | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 2 | 0 | 1 |  |
| `alice` | Alice in 冷凍庫 文字pv | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `bansankai` | 煤夜 様 - わたし晩餐会 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 1 | 1 | 1 |  |
| `baramoji` | Ae書式維持文字分解スクリプトBaraMoji | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `blue-white-design` | 青と白のデザイン | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `cclub-brochure-2024` | コンピュータ部パンフレットデザイン | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `cclub-brochure-2025` | コンピュータ部 勧誘チラシ | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `ch4nge` | 三途くお 様「CH4NGE/Giga」 | rewrite_required | pending_owner | ∅ | role_missing, no_mappable_section | 0 | 1 | 1 |  |
| `code-type` | コードタイプ風映像素材 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `design-001` | デザイン練習 #001 | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `dounika` | どうにかなっちゃいそう 文字pv | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 2 | 1 | 1 |  |
| `homura` | ひよりひよこ 様 - アエギス 第零楽章「焔」 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `hurahu` | フラフープハレーション 文字pv | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `icon-tegaki-anime` | アイコン 手書きアニメーション | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `isogasii-demo` | 忙しい人のための作文エディター 試作 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 1 | 1 | 1 |  |
| `isogasii-editor` | 忙しい人のための作文エディター 完成版 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `kaben` | 【二次創作】花弁、それにまつわる音声 文字pv | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `kakumei` | 蝶羽ヘレナ 様 - 革命道中 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `kosen-fes2025-ending` | 宇部高専祭2025 エンディング | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `lhaplus` | ラプラスショコラ 二次創作 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `m5_clock` | M5_Clock | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `mawaru` | まわる世界 文字pv | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `meikai` | 冥界 二次創作pv | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `moumoku` | 盲目の怪物 文字pv | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `my-first-blender` | 初めてのBlender | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 2 | 1 | 1 |  |
| `my-sns-icon` | SNSアイコン | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `my-web-2025` | my-web-2025 | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `netu` | 熱異常 テキストモーション | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `oneself` | ONESELF 二次創作 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 2 | 1 | 1 |  |
| `ooame` | 大雨警報発令中 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 1 | 1 | 1 |  |
| `pomodoroom` | pomodoroom | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `propose` | 三途くお 様「プロポーズ/可不」 | rewrite_required | pending_owner | ∅ | role_missing, no_mappable_section | 0 | 1 | 1 |  |
| `red-black-design` | 赤と黒のデザイン | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `reel-2024` | reel 2024 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 2 | 1 | 1 |  |
| `reel-2025` | REEL 2025 | rewrite_required | pending_owner | ∅ | role_missing, no_mappable_section | 0 | 1 | 1 |  |
| `seishun` | 青春コンプレックス / darupoi様 | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `sep_color` | Aeエフェクトプラグイン sep_color | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 2 | 0 | 1 |  |
| `shinkansen` | シンカンセンスゴイカタイアイス p5js練習 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `stretch-v01` | Aeエフェクトプラグイン Stretch | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `stretch_v02` | Aeエフェクトプラグイン Stretch v2 | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 2 | 0 | 1 |  |
| `tegaki-anime` | 手書きアニメーション | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `tokimeki` | darupoi 様 - Tokimeki | rewrite_required | pending_owner | ∅ | role_missing, no_mappable_section | 0 | 1 | 1 |  |
| `ugoita` | 動いたっ！ イラストアニメーション | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 1 | 1 | 1 |  |
| `usoto` | 嘘と未来 文字pv | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 4 | 1 | 1 |  |
| `yukikate` | 【二次創作】雪糅 文字pv | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |

### `media_missing` (23)

| legacy id | title | migration_class | publication | role | publication_blockers | link_count | external_video | markdown | available_sections |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Border` | Ae縁取りエフェクト Border | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 2 | 0 | 1 |  |
| `FoldLayers` | Aeプラグイン FoldLayers | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 3 | 0 | 1 |  |
| `NullOto` | NullOto ソフトウェア型ノイズキャンセリングアプリ | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `ProtoType-brochure` | ProtoType パンフレット | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `RGBDelay` | Aeエフェクトプラグイン RGBDelay | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 2 | 0 | 1 |  |
| `aulymo_v03` | Aeスクリプト Aulymo_v03 | eligible | pending_owner | Solo developer | media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `baramoji` | Ae書式維持文字分解スクリプトBaraMoji | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `blue-white-design` | 青と白のデザイン | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `cclub-brochure-2024` | コンピュータ部パンフレットデザイン | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `cclub-brochure-2025` | コンピュータ部 勧誘チラシ | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `design-001` | デザイン練習 #001 | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `icon-tegaki-anime` | アイコン 手書きアニメーション | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `kosen-fes-2025` | 宇部高専祭ウェブサイト2025 | eligible | pending_owner | Lead developer | media_missing, no_mappable_section | 2 | 0 | 1 |  |
| `kosen-fes2025-ending` | 宇部高専祭2025 エンディング | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `m5_clock` | M5_Clock | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `my-sns-icon` | SNSアイコン | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `my-web-2025` | my-web-2025 | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `pomodoroom` | pomodoroom | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `red-black-design` | 赤と黒のデザイン | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `seishun` | 青春コンプレックス / darupoi様 | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `sep_color` | Aeエフェクトプラグイン sep_color | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 2 | 0 | 1 |  |
| `stretch_v02` | Aeエフェクトプラグイン Stretch v2 | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 2 | 0 | 1 |  |
| `tegaki-anime` | 手書きアニメーション | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |

### `no_mappable_section` (60)

| legacy id | title | migration_class | publication | role | publication_blockers | link_count | external_video | markdown | available_sections |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Border` | Ae縁取りエフェクト Border | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 2 | 0 | 1 |  |
| `FlashBeat-BGM` | FlashBeatテーマ曲(BGM) | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 1 | 1 | 1 |  |
| `FlashBeat-OP` | FlashBeatオープニング | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 1 | 1 | 1 |  |
| `FlashBeat` | FlashBeat | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 2 | 1 | 1 |  |
| `FoldLayers` | Aeプラグイン FoldLayers | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 3 | 0 | 1 |  |
| `LiteGlow` | 【Aeエフェクトプラグイン】LiteGlow | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `MultiSlicer` | MultiSlicer | eligible | approved | Solo developer | no_mappable_section | 3 | 1 | 1 |  |
| `NullOto` | NullOto ソフトウェア型ノイズキャンセリングアプリ | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `ProtoType-brochure` | ProtoType パンフレット | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `ProtoType` | タイピングゲーム ProtoType | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `RGBDelay` | Aeエフェクトプラグイン RGBDelay | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 2 | 0 | 1 |  |
| `alice` | Alice in 冷凍庫 文字pv | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `aulymo-v01` | Aulymo | eligible | approved | Solo developer | no_mappable_section | 2 | 1 | 1 |  |
| `aulymo_v02` | Aeスクリプト Aulymo | eligible | pending_owner | Solo developer | no_mappable_section | 2 | 1 | 1 |  |
| `aulymo_v03` | Aeスクリプト Aulymo_v03 | eligible | pending_owner | Solo developer | media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `bansankai` | 煤夜 様 - わたし晩餐会 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 1 | 1 | 1 |  |
| `baramoji` | Ae書式維持文字分解スクリプトBaraMoji | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `blue-white-design` | 青と白のデザイン | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `cclub-brochure-2024` | コンピュータ部パンフレットデザイン | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `cclub-brochure-2025` | コンピュータ部 勧誘チラシ | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `ch4nge` | 三途くお 様「CH4NGE/Giga」 | rewrite_required | pending_owner | ∅ | role_missing, no_mappable_section | 0 | 1 | 1 |  |
| `code-type` | コードタイプ風映像素材 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `design-001` | デザイン練習 #001 | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `dounika` | どうにかなっちゃいそう 文字pv | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 2 | 1 | 1 |  |
| `homura` | ひよりひよこ 様 - アエギス 第零楽章「焔」 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `hurahu` | フラフープハレーション 文字pv | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `icon-tegaki-anime` | アイコン 手書きアニメーション | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `isogasii-demo` | 忙しい人のための作文エディター 試作 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 1 | 1 | 1 |  |
| `isogasii-editor` | 忙しい人のための作文エディター 完成版 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `kaben` | 【二次創作】花弁、それにまつわる音声 文字pv | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `kakumei` | 蝶羽ヘレナ 様 - 革命道中 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `kosen-fes-2025` | 宇部高専祭ウェブサイト2025 | eligible | pending_owner | Lead developer | media_missing, no_mappable_section | 2 | 0 | 1 |  |
| `kosen-fes2025-ending` | 宇部高専祭2025 エンディング | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `kosen-procon-pv` | 高専プロコン 非公式pv | eligible | pending_owner | Solo creator | no_mappable_section | 4 | 1 | 1 |  |
| `lhaplus` | ラプラスショコラ 二次創作 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `m5_clock` | M5_Clock | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `mawaru` | まわる世界 文字pv | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `meikai` | 冥界 二次創作pv | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `moumoku` | 盲目の怪物 文字pv | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `my-first-blender` | 初めてのBlender | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 2 | 1 | 1 |  |
| `my-sns-icon` | SNSアイコン | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `my-web-2025` | my-web-2025 | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `netu` | 熱異常 テキストモーション | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `oneself` | ONESELF 二次創作 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 2 | 1 | 1 |  |
| `ooame` | 大雨警報発令中 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 1 | 1 | 1 |  |
| `pomodoroom` | pomodoroom | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `propose` | 三途くお 様「プロポーズ/可不」 | rewrite_required | pending_owner | ∅ | role_missing, no_mappable_section | 0 | 1 | 1 |  |
| `red-black-design` | 赤と黒のデザイン | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `reel-2024` | reel 2024 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 2 | 1 | 1 |  |
| `reel-2025` | REEL 2025 | rewrite_required | pending_owner | ∅ | role_missing, no_mappable_section | 0 | 1 | 1 |  |
| `seishun` | 青春コンプレックス / darupoi様 | rewrite_required | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 0 | 0 | 1 |  |
| `sep_color` | Aeエフェクトプラグイン sep_color | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 2 | 0 | 1 |  |
| `shinkansen` | シンカンセンスゴイカタイアイス p5js練習 | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `stretch-v01` | Aeエフェクトプラグイン Stretch | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |
| `stretch_v02` | Aeエフェクトプラグイン Stretch v2 | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 2 | 0 | 1 |  |
| `tegaki-anime` | 手書きアニメーション | eligible | pending_owner | ∅ | role_missing, media_missing, no_mappable_section | 1 | 0 | 1 |  |
| `tokimeki` | darupoi 様 - Tokimeki | rewrite_required | pending_owner | ∅ | role_missing, no_mappable_section | 0 | 1 | 1 |  |
| `ugoita` | 動いたっ！ イラストアニメーション | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 1 | 1 | 1 |  |
| `usoto` | 嘘と未来 文字pv | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 4 | 1 | 1 |  |
| `yukikate` | 【二次創作】雪糅 文字pv | eligible | pending_owner | ∅ | role_missing, no_mappable_section | 3 | 1 | 1 |  |


## New candidates (no legacy DB row)

8 entries are `new_candidate`. They are NOT in
`data/contents/`; each must be added by the owner with a fully
grounded narrative (motivation / architecture / evidence / retrospective)
+ media + role before publication is approved.

- `my-web-2026-foundation` — my-web-2026 Foundation release — release-by-release candidate
- `my-web-2026-content` — my-web-2026 Content release — release-by-release candidate
- `my-web-2026-home` — my-web-2026 Home release — release-by-release candidate
- `my-web-2026-platform` — my-web-2026 Platform release — release-by-release candidate
- `tastile` — Tastile (NEW) — verify availability
- `ido-bata` — Ido-bata (NEW) — verify availability
- `internship-sciencearts` — ScienceArts internship (NEW) — NDA check required
- `internship-optim` — OPTiM internship (NEW) — NDA check required
