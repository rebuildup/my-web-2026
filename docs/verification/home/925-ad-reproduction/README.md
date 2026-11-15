# Issue #925 — Web 広告の観察記録とトップページ再現の根拠

> Status: verification record
> Issue: #925（feat(home): 実在 Web 広告の構成を観察・再現し「現在地」を訴求するトップページへ再設計する）
> 観察日: 2026-11-14 / 実施: Orca 内蔵ブラウザ（実際に配信・掲載されている面をそのまま閲覧）

## 1. 観察した実在広告と出典

「実際に配信・掲載されている広告」を優先し、ギャラリーやモックではなく
ライブの面を観察した。証跡スクリーンショットは本ディレクトリに保存。

| # | 出典 | URL | 観察したもの | 証跡 |
| --- | --- | --- | --- | --- |
| 1 | Meta 広告ライブラリ（日本・アクティブな広告のみ表示） | `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=JP&media_type=all&search_type=keyword_unordered&q=ポートフォリオ` | 実際に配信中の広告 8 件超の全文コピーとカード構造 | `facebook-ad-library.png` |
| 2 | Google 検索結果（スポンサー広告枠） | `https://www.google.com/search?q=ウェブサイト+制作+依頼&hl=ja&gl=jp` | リスティング広告 2 件の全文（見出し・説明・サイトリンク相当・CTA 相当行） | `google-serp-ads.png` |
| 3 | 音楽ナタリー（実 publisher 面のディスプレイ広告） | `https://natalie.mu/music` | AdSense 実配信ユニットの実測サイズ: 728×90 / 336×280 / 300×250 | `natalie-music-top.png`, `natalie-336x280-ad.png` |
| 4 | すまほん!!（実 publisher 面） | `https://smhn.info/` | AdSense 300×60 リーダーボード 2 面の実測 | （eval 計測のみ） |
| 5 | TikTok Creative Center / Google Ads Transparency | 各トップ | 動画広告・政治広告が中心で構造参照には不適と判断 | `ads-transparency-top.png` |

観察メモ:

- AdSense のクリエイティブは safeframe のクロスオリジン iframe 内にあり
  DOM から内容を読めないため、サイズと配置のみを実測した（728×90
  リーダーボード、336×280 ラージレクタングル、300×250 ミディアム
  レクタングル — IAB 標準サイズどおり）。
- Meta 広告ライブラリは広告主が許諾した実配信広告のみを表示し、
  「アクティブ」バッジ・ライブラリ ID・掲載開始日つき。コピー全文が
  読めるため、広告文の構造分析はここを正本とした。

## 2. 観察した広告の共通構造（分析）

Meta 広告ライブラリで確認した実広告（prod_oricham / World Gold
Council / SSGA / 東洋館出版社 / UKCorporation / Juju8・ベルメゾン
デイズ / yuco_ushi・Jimdo / masaki_life_photo / ステート・ストリート）
に共通する骨格:

1. **広告主識別 + 開示**: ページ名 + 「スポンサー広告」ラベル + 「…」
2. **フック（1 行目で止める）**: 問いかけ（「〜をご存知ですか？」）/
   逆説（「常識が変わる」）/ 感情訴求（「手触りのある価値」）/
   個人の体験談
3. **根拠の列挙**: `・` 箇条書き + 具体数値（価格・店舗数・納期・枚数）
4. **リンクカード**: ドメイン（大文字小型）+ 見出し（太字 2 行 clamp）
   + 説明文 + 画像（1.91:1）
5. **CTA ボタン**: 青塗り・白抜き文字・「詳しくはこちら」「Shop Now」
   「お問い合わせ」等の行動動詞

Google リスティング広告も同型: 「スポンサー」ラベル → 青リンク見出し →
説明文 → サイトリンク行（`·` 区切り）→ CTA 相当行（「ホームページ制作を
ご相談」）。

機能している要素: **数値の具体性**（「1本1,550円〜」「750店舗以上」）、
**ベネフィットの箇条書き**、**リンク先の予告**（ドメイン+見出し+
説明 = クリック前に内容が分かる）、**単一の明確な CTA**。

## 3. 選定した参照広告と再現の形

**参照**: Facebook フィードのリンク広告カード（Ad Library 表示どおりの
 anatomy）。全要素がテキストで観察・計測でき、ページ全面への転用が
自然な唯一のフォーマットと判断した（検索広告は面が小さすぎ、
ディスプレイ広告はクリエイティブ内部が観察不能）。

**再現**: トップページのヒーローを、実測 ~640px 幅の広告カードとして
再構成する。カードは白地・角丸・ヘアライン枠で、ページの canvas から
「埋め込みクリエイティブ」として分離する（実広告がフィード面から
浮いて見えるのと同じ関係）。

| 広告の要素 | 再現 |
| --- | --- |
| ページアバター（円形 40px） | `SiteMark` を円形白ボックスに収める |
| ページ名 + 「スポンサー広告」+ 「…」 | `rebuildup` + `スポンサー広告` + 装飾「…」 |
| プライマリテキスト（フック+箇条書き+締め） | 「現在地」の訴求コピー（§4） |
| リンクカード画像 1.91:1 | `public/og/default-card.png`（1200×630 = 1.91:1、そのまま） |
| ドメイン大文字表記 | `rebuildup.dev`（CSS `uppercase` で広告どおり大文字表示） |
| リンク見出し / 説明 | head metadata と同一文（`src/routes/index.tsx` の title / description をそのまま流用） |
| CTA「詳しくはこちら」 | FB ブルー塗りボタン → `/about`。観察値 `#1877F2` は白文字とのコントラストが約 4.3:1 で WCAG AA（4.5:1）未満のため、axe ゲートに合わせて同色相の `#1773E0`（約 4.6:1）に調整 |
| カード全体と CTA のリンク先 | 共に `/about`（広告の単一遷移先ルール） |

**あえて再現しなかった要素**: リアクションバー（いいね/コメント/
シェア）は Ad Library のカード anatomy に含まれず、機能を持たない
装飾ボタンを置くのは UI 規約上不適と判断。動的クリエイティブ
（動画・カルーセル）も対象外。

## 4. 「現在地」コンテンツの流し込み

広告コピーは全てコミット済みの事実のみを使う（`src/home/current/` の
測定値・`CAPABILITIES` レジストリ・`package.json#version`）。

- フック: 個人 Web Platform を毎日作り直している、という事実の提示
- 箇条書き: 公開中ツール 15 個 / Notion CMS 全件移行中 / 直近 30 日の
  コミット数（`weight.activity` の実測値を props で受け取る）
- 締め: 「完成していないから、毎日更新されている」— 移行中という
  正直な状態を広告的な緊急性に転用

## 5. 検証

実ブラウザ（Orca 内蔵ブラウザ、`pnpm dev` = `http://127.0.0.1:3000/`）
で確認した結果:

- **デスクトップ 1440×900**: カード実測幅 640px（フィード広告カードと
  同じオーダー）。`final-desktop.png` / `final-desktop-1440.png`。
- **モバイル 390×844（mobile エミュレーション）**: 横スクロールなし
  （`scrollWidth === innerWidth`）、h1 は 1 つで accessible name
  `my-web-2026` を維持。`final-mobile.png`。
- **コンソールエラーなし**。
- **計測値の実表示を確認**: SSR HTML とブラウザ双方で
  「直近 30 日で 2,433 件のコミット」が `weight.activity` の実測値
  どおり描画されることを確認（捏造数値なし）。
- **h1 / セクション契約**: `section[aria-labelledby="hero-title"]`、
  名前付きセクション 5 つの順序、`/about` リンク 2 本（リンクカード +
  CTA）、`yusuke-kim.com` リンク 0 件を維持。
  `e2e/smoke.spec.ts` のヒーロー `/portfolio` 期待は、広告 anatomy
  の「単一遷移先」ルールに合わせて `/about` ×2 の契約へ更新した
  （`/portfolio` は capabilities グリッドと footer index から到達可能）。
- 判定: 実広告との画素一致ではなく **anatomy（要素・階層・情報密度・
  CTA 配置）の再現**を合格条件とした。配色は Meta の実測値
  （`#f0f2f5` 面・`#65676b` 副文字）を採用し、CTA ブルーのみ
  WCAG AA コントラストを満たすよう `#1877F2` → `#1773E0` に微調整。
  いずれもグローバル editorial トークンには混ぜず
  `src/home/hero.tsx` 内にスコープした。

## 6. Second pass — 全形態混在・ビジュアル広告への再設計（2026-11-15）

第一弾の単一リンク広告ヒーローは「よくある Web 広告のイメージでは
ない」「AI Slop」「内容に興味を持てない」との評価を受けて再設計。
さらに以下の 2 点の追加フィードバックを反映した:

- **広告は全形態をごちゃ混ぜにする**。特定フォーマットに固執せず、
  観察した実在フォーマットを複数同時にページへ混在させる。
- **「現在地」は通常のフローコンテンツ**。広告と現在地は完全に別軸
  であり、現在地コンテンツ自体を広告化しない。
- **広告の指し示す先は実コンテンツ**。`/about` のような自己言及の
  メタページではなく、公開済みの Tool / Portfolio の実ページを
  指す（自分を説明する広告は広告ではない）。
- **テキストだけの広告は置かない**。実際のディスプレイ・SNS 広告は
  画像リードなので、全ユニットにビジュアルを必須とする。

### 再現したフォーマットと配置（`src/home/ads/`）

全ユニットが公開 Tool を宣伝し、クリエイティブはその Tool 自身の
コミット済み画面キャプチャ（`public/tool-previews/<slug>.webp`、
Tools index と同一アセット）を使う。

| フォーマット | 出典 | 実装 | 宣伝対象 / 遷移先 | 配置 |
| --- | --- | --- | --- | --- |
| Leaderboard（728×90 / 300×60 系） | natalie.mu・smhn.info の AdSense 実測 | `AdTopBanner` → `AdLeaderboard`（サムネイル + 見出し + CTA） | Mic Level → `/tools/mic-level` | ページ最上部 |
| フィード内リンク広告カード | Meta Ad Library の実広告 anatomy | `AdToolLinkCard` → `AdLinkCard`（1.91:1 画像カード） | QR Generator → `/tools/qr-generator` | 「現在地」直後 |
| 動画スポット（インフィード動画） | フィード面で常時観察される動画ユニット | `AdToolVideo` → `AdVideo`（16:9 + 再生ボタン + 尺チップ） | ProtoType → `/tools/prototype` | capabilities 直後 |
| ディスプレイ矩形（300×250 / 336×280 系） | natalie.mu の AdSense 実測 | `AdToolRect` → `AdRect`（画像 + コピー横並び・dark 面） | Pi Game → `/tools/pi-game` | status 直後 |
| ネイティブカード（ティーザー） | コンテンツフィードの PR ユニット | `AdToolNative` → `AdNative`（小サムネ + 見出し + PR 開示） | readmark → `/tools/readmark` | contact 直前 |

「現在地」側は `src/home/hero.tsx` を editorial ヒーロー（eyebrow
「現在地 / Where I am now」+ h1 + リード + About リンク）に戻した。
広告コピーは広告文体だが、内容は各 Tool の実説明
（`description_ja`）の言い換えに留め、数値・効果の捏造はない。
追加フィードバック「テキストにするな」を受け、各ユニットのコピーは
最小化した（画像リード + 1 行フック + CTA）。さらに「形だけ真似ても
意味がない。魅力がないのが重大な問題」との評価を受け、第三パスで
各ユニットを **設計された広告クリエイティブ** として作り込んだ:

- Leaderboard: 暗色フィールド全面 + 大見出し（3xl）+ オファーチップ
  （「無料・登録不要」）+ 右から滲む製品ビジュアル。全体がリンク化
  する実バナー型。
- Link card: フィードカラム幅（max 640px）に収め、実測 anatomy を維持。
- Video spot: 見出しをクリエイティブ上にオーバーレイ + 下部に
  ドメインバー + CTA。
- Display rect: 画像全面 + スクリムグラデーション + 4xl 見出し +
  白ピル CTA のフルブリード・クリエイティブ。
- フックは広告技法（問いかけ・オファー・挑発）を使うが、主張は全て
  実 Tool の事実（無料・登録不要・ブラウザ完結）に限定。

証跡: `final5-desktop-1440.png` / `final5-desktop-full.png` /
`final5-mobile.png`（第三パス後の再撮影）。

### Second pass の検証

- 実ブラウザ（Orca 内蔵ブラウザ、`pnpm dev`）1440×900:
  5 ユニット全て描画、各ユニットの `<img>` は対応する
  `/tool-previews/*.webp` を指し、遷移先は全て `/tools/<slug>`
  の実ルート（`/tools/mic-level`・`/tools/qr-generator`・
  `/tools/prototype`・`/tools/pi-game`・`/tools/readmark`）。
  h1 は 1 つ（accessible name `my-web-2026`）、横スクロールなし、
  コンソールエラーなし。証跡: `final4-desktop-1440.png` /
  `final4-desktop-full.png`（コピー最小化後の再撮影）。
- モバイル 390×844（mobile エミュレーション）: 横スクロールなし、
  h1 ×1。証跡: `final4-mobile.png`。
- `e2e/smoke.spec.ts`: ヒーロー `/about` リンク期待を ×2 → ×1 に更新
  （広告はヒーローセクションの外に配置）。`e2e/viewport/
  visual-diff.spec.ts` の BREAKAGE_CSS は新しい広告 testid 群を
  対象に更新。
- Storybook: `home/Ads` stories を追加（5 フォーマット）、axe 監査
  対象に自動収録。
- `publication:check` 再記録済み。

## Fourth pass — フォーマット拡張とカテゴリ別広告の観察

第三パスまでの指摘「参照フォーマットが少ない」「効果のある広告を
選んでいない」「映像・ゲーム・美容・漫画・セール等の趣旨の違う
広告がある」への対応として、Meta 広告ライブラリの実配信広告を
カテゴリ別に再観察した。

### 観察した実広告（追加分）

Meta 広告ライブラリ（`country=JP`, `active_status=active`）で、
キーワード検索により以下のカテゴリの実配信広告を確認:

- **映像/ブランド広告**: AWS — 3〜15 秒の動画クリエイティブ複数
  バリエーション、「ビジュアルエフェクトを、瞬時に完成」等の
  業種別ベネフィット訴求 + Learn More CTA。
  証跡: `fb-game-ads.png`（動画広告カード群）。
- **ゲーム広告**: Gossip Harbor（45 秒動画、merge/build/explore +
  物語フレーミング、"ゲームをプレイ" CTA）、Top War（約 58 秒、
  挑戦/意思決定フレーミング、Play Game）、Dada Ace（27 秒、
  「2026年最新STG登場！今すぐプレイしよう！」）。
- **美容/健康広告**: IHADA・d program・SK-II・Earthcare —
  ビフォーアフター・成分・使用感の訴求。
  証跡: `fb-beauty-ads.png`。
- **コマース/セール広告**: Amazon 商品広告（商品タイトル・説明・
  出品者・Shop Now）、楽天プロモーション（ポイント/初回特典、
  条件詳細コピー）。
- **アプリ/インストール広告**: WINTICKET — 30 秒動画 +
  アプリ導入の直接訴求。
- **リード/教育広告**: GFS 投資講座 — 1:16〜1:26 動画、
  著名人エンドース + 「100万人突破」ソーシャルプルーフ +
  無料講座の価値提示。
- **カルーセル形式**: Meta フィードの複数カード横スワイプ
  クリエイティブ。

### 分析: 広告が「実現していること」の違い

| カテゴリ | 主目的 | 実現すること |
|---|---|---|
| 映像/ブランド | 認知・好意 | 動画で製品を「見せる」、感情に訴える |
| ゲーム | インストール/プレイ | 画面内で遊ばせる・世界観を一瞬で伝える |
| 美容/健康 | 購買 | before/after・感覚的訴求・信頼材料 |
| コマース/セール | 購買 | 商品詳細・価格・限定性で即決を促す |
| リード/教育 | 見込み客獲得 | 権威・実績・無料価値で登録へ誘導 |
| インストール | DL | ストア型カードで導入を一手に |

### 実装への反映（第四パス）

フォーマットを 5 → **9 種** に拡張し、それぞれ異なる広告目的を
担わせた（`src/home/ads/units.tsx` / `placements.tsx`）:

1. **Leaderboard**（バナー）— 到達: Mic Level
2. **Link card**（フィードリンク広告）— 検討: QR Generator
3. **Carousel**（横スワイプ複数カード、ゲーム広告・Meta カルーセルの
   形式）— 複数 Tool を一括提示: Pomodoro / History Quiz /
   Code Type p5
4. **Video spot**（16:9 動画クリエイティブ風）— ProtoType
5. **Playable**（広告枠内で製品そのものをプレイ可能にする
   プレイアブル広告）— `/tools/pi-game` を iframe 埋め込み、
   ヘッダ「▶ Pi Memory Game」+「その場でプレイ」+ 下部 CTA
6. **Display rect**（フルブリード矩形）— ProtoType
7. **App-install**（アイコン+開発者+無料バッジ+インストール CTA の
   ストア型カード）— SVG to TSX
8. **Product/listing**（商品画像+長い商品タイトル+価格行 CTA の
   コマース型カード）— Fillgen
9. **Native card**（サムネイル+PR 表記のネイティブ型）— readmark

各ユニットは引き続き実 Tool の `/tools/<slug>` 実ルートへ遷移し、
ビジュアルはコミット済みの `public/tool-previews/<slug>.webp`
を使用。主張は全て実 Tool の事実（無料・登録不要・ブラウザ完結）
に限定し、架空の実績・割引・医薬品的効能は一切書かない。

### Fourth pass の検証

- 実ブラウザ 1440×900: 9 ユニット全て描画、プレイアブルの iframe が
  `/tools/pi-game`（chromeless シェル）をロード。h1 ×1、横スクロール
  なし。証跡: `final6-desktop-1440.png` / `final6-desktop-full.png` /
  `final6-mobile.png`（390×844）。
- `src/home` vitest: 215 pass。typecheck / biome clean。
- Storybook `home/Ads` stories を 9 件に更新（axe 対象）。
- `e2e/viewport/visual-diff.spec.ts` BREAKAGE_CSS に新 testid
  （carousel / playable / install / product）を追加。

### 残課題（正直な記録）

- 実広告の「画像の魅力」はキャンペーン予算とクリエイティブ制作の
  成果物であり、ツールのスクリーンショットを広告ビジュアルとして
  使う限界は残る。プレイアブル広告は「製品をその場で遊ばせる」
  形式として最も忠実な再現だが、残りのユニットは依然として
  スクリーンショット+コピーの合成であり、実ゲーム/美容広告の
  ような専用ビジュアル制作物ではない。
- 動画広告は静止画+再生ボタンの表現に留まる（実動画素材は
  未制作・未コミット）。

## Eighth pass — API 実データ・モーション・クレーム精査

### 変更点

1. **ツール広告だけにしない** — 広告の遷移先に Portfolio の実プロジェクトを
   追加。`src/routes/index.tsx` の loader が公開 API
   `listPortfolioProjects`（`/portfolio` 一覧と同じ読み取り）を呼び、
   表紙メディアを持つプロジェクトを `HomeAdProject`（slug / title /
   summary / coverUrl / coverAlt の狭い形）に写像して HomePage へ渡す。
   `home` は portfolio obligation を import しない（AGENTS.md §3）。
   API 障害時は `.catch(() => null)` で Tool のみのロースターに縮退。
   - レール: `AdPortfolioNative` / `AdPortfolioProduct` がプロジェクトを
     販売（実測: `/portfolio/kosen-fes-2025`・`/portfolio/tegaki-anime`・
     `/portfolio/seishun` が実データで描画）
   - カルーセル: プロジェクトカードを末尾に追加
   - フォールバック: プロジェクトが無い/表紙が無い場合は従来の Tool
     ユニットをそのまま表示
2. **動き** — 全広告スロットに `adReveal`（不透明度+上昇の一回きりの
   出現アニメーション）、動画スポットの再生ボタンとプレイアブルの
   TRY IT バッジに `adPulse`（2.4s の呼吸パルス）。Panda keyframes +
   `data-motion` フック + `usePrefersReducedMotion` のレンダー時分岐 +
   `src/styles.css` のレイヤー2セレクタという既存の reduced-motion
   契約（`scripts/check-reduced-motion.mjs`）に完全準拠。
   `AD_REVEAL_MOTION` / `AD_PULSE_MOTION` 定数を
   `src/editorial/reduced-motion.ts` に追加。
3. **クレーム精査** — 「無料・登録不要」など本来の趣旨と違う情報を除去:
   - Leaderboard の offer chip「無料・登録不要」→ 削除（chip を optional 化）
   - App-install の「rebuildup · 無料」バッジ → 「rebuildup」のみ
   - Product/listing の「無料」価格表示 → `priceLabel` optional 化し非表示
   - CTA「無料で使う」→「使ってみる」
   - Link card 説明文の「インストールも登録も不要です」→ 削除
   残るコピーは全て対象コンテンツの事実（機能・形式・制作物）のみ。

### Eighth pass の検証

- 実ブラウザ 1440×900: `data-motion="ad-reveal"` ×10・`ad-pulse` ×2、
  computed `animation-name: adReveal`、レールに実 Portfolio 3 件
  （`/portfolio/kosen-fes-2025`・`/portfolio/tegaki-anime`・
  `/portfolio/seishun`）、カルーセルに `/portfolio/*` ×2、
  h1 ×1、横スクロールなし。証跡: `final10-desktop-1440.png` /
  `final10-desktop-full.png` / `final10-mobile.png`。

## Ninth pass — 実広告との同条件比較レビューと修正

### 比較方法

参照広告の証跡（§1 の実測値・anatomy 記録）と実装画面を、
崩れの有無ではなく **構成・情報密度・視線誘導・訴求力・CTA・
余白・画像の扱い** の各軸で突き合わせた。実装側は Orca ブラウザで
1440×900 / 390×844 の DOM 実測（各ユニットの幅・高さ・リンク先・
computed style）を取得して評価した。

### 見つかった差分と対応

| 軸 | 実広告 | 修正前の実装 | 対応 |
| --- | --- | --- | --- |
| サイトクローム | リーダーボードは必ずサイトヘッダー（ロゴ+ナビ）の直下に置かれる | マストヘッドが存在せず、バナーが宙に浮いていた | **パブリッシャー・マストヘッドを追加**（`rebuildup` ワードマーク + Tools / Portfolio / About のナビ、ヘアライン下罫）。これで「この媒体の広告枠」という文脈が成立 |
| 遷移先の重複 | 同一ページで同じ広告主・同じ遷移先を隣接ユニットで繰り返すことは稀 | 動画スポットとディスプレイ矩形が両方 `/tools/prototype` を宣伝 | 矩形に `AdPortfolioRect` を追加し `adProjects[3]`（実測 `/portfolio/m5-clock`）へ。フォールバックは従来の Tool 版 |
| CTA | 行動動詞がオファーに即している（「Shop Now」「今すぐプレイ」「詳しくはこちら」） | 全ユニットが「ツールを開く」「使ってみる」の汎用ラベル | ベネフィット動詞へ: 「レベルを確認」「QR を作る」「変換する」「教材を生成」。動画「今すぐプレイ」・プレイアブル「フル画面で遊ぶ」・Portfolio「作品を見る」は既に適切で維持 |
| 動き | リッチメディアのみ動き、フィード/ネイティブ/ストア/商品系は静止 | （前パスで対応済み: 5 ユニットが個別 keyframes、5 ユニット静止） | 変更不要 — computed style で `adDrop`/`adSlideLeft`/`adScaleIn`/`adPop`/`adWipeLeft`/`none` の混在を再確認 |
| 角丸 | フォーマットごとに異なる | （前パスで対応済み: xs〜xl の差別化） | 変更不要 |
| 崩れ | — | リンクカードが `maxWidth: '160'`（未解決トークン）で 160px に潰れていた | 前コミットで `640px` に修正済み。今回の全ユニット再計測で他の崩れなし |
| 情報密度 | フック+ビジュアル+最小限の補助情報+単一 CTA | （前コミットで箇条書き・サブコピー削除、description を 2 行 clamp） | 変更不要 — ネイティブ/製品の Portfolio summary は `lineClamp: 2` で制限 |

### 全ページ構図の評価（広告ユニットと「現在地」の関係）

実 publisher 面の定石 — **マストヘッド → リーダーボード → 本文
（記事カラム + 常設 sponsored レール + インフィード広告）→ フッター**
— に対し、修正後のページは:

- masthead（今回追加）→ leaderboard（全幅）→ editorial hero
  「現在地」→ 記事カラム（CurrentProjects → リンクカード →
  Capabilities → カルーセル+動画 → Status → プレイアブル+矩形 →
  Contact）+ xl 以上で右端 sticky sponsored レール（ネイティブ×2・
  インストール・製品）

「現在地」は通常のフローコンテンツのまま、広告は別軸のレイヤー
として周囲を構成する関係が成立している。広告の遷移先は全て実在
ルート（`/tools/*` 11 種 + `/portfolio/*` 実データ）で、自己言及なし。

### Ninth pass の検証

- 実ブラウザ 1440×900: masthead 描画、`h1` ×1、横スクロールなし、
  rect のリンク先が `/portfolio/m5-clock`（実 API データ）に変化、
  CTA ラベルがベネフィット動詞に更新。証跡:
  `final11-desktop-1440.png` / `final11-desktop-full.png` /
  `final11-mobile.png`（390×844、横スクロールなし）。
- `tsc --noEmit` クリーン、biome クリーン、
  `publication:check` PASS（マストヘッドのリンクは全て公開
  スナップショット済みルート）。

## Tenth pass — 独立レビュー（Codex）と証跡の信頼性修正

### 証跡の信頼性

- **同意画面の遮蔽**: `final11-*` はアクセス解析同意バナー
  （`pos_fixed` フッター）が写り込んでいた。`拒否する` を選択して
  から再撮影し、`consent:false` を DOM で確認。
- **画像未読込**: `final12-*` では Portfolio カバー
  （`/media/portfolio/*`）がローカル開発データソースでは 404 となり、
  ネイティブ/製品/矩形カードが空白＋alt テキストに見えていた。
  `/portfolio` ページ自体でも同じ 7 件が broken であり、広告実装
  固有の問題ではなく開発データソースの制約（R2 実オブジェクトが
  ローカルに無い）。`dev:production-data`
  （`MY_WEB_2026_DATA_SOURCE=production-readonly` + remoteBindings）
  で再起動し、広告画像 13/13 の `naturalWidth>0` を確認した上で
  `final13-*` を撮影。**production では `composeMediaUrl` が解決
  するため本番表示に影響なし**。ローカル既定モードでの空白は
  プラットフォーム全体の既知の制約として記録する。
- モバイル証跡の「同じ流れが縦に複数回現れる」は、ページ高を
  viewport に合わせた全頁キャプチャの継ぎ目＋sticky レールの
  見え方であり、実ページの重複描画ではない（DOM 上ユニットは
  各1つ）。

### 独立レビュー（Codex に final12 + 参照広告7枚を読ませた結果）

実装エージェントとは別モデルによる画像レビューを実施。
主な指摘と対応:

| 指摘 | 対応 |
| --- | --- |
| Portfolio カバーが空白/alt のみで訴求力が最弱 | 上記の通り開発データソース起因。production-data で全画像読込を確認し final13 を再撮影 |
| 動画スポットの `0:32` 尺チップは存在しない動画を示唆する嘘 | **削除**。ユニット全体がリンクで `/tools/prototype`（実際に遊べる）へ遷移するため、再生ボタンは「その場で遊べる」導線として機能する。実動画素材が無い限り静的クリエイティブ＋リンクが最も誠実な表現と判断 |
| モバイルで leaderboard が縦積み巨大化し見出しが「か？」で孤立 | モバイルも横組みに変更（画像 112×80 の小サムネ + 本文）、見出し `xl`→`lg`、padding/gap を base で縮小。実測 390px で 282×237・横スクロールなし |
| カルーセルのカードが「画像+下テキスト」の弱い構成 | **画像全面 + 下端スクリム + ドメイン + 太字タイトルのオーバーレイ**に変更（rect/video と同じ実広告のクリエイティブ手法） |
| leaderboard に具体的オファーが無い | `sub` prop を追加し「OBS と同じ目盛り。適正ゲインをその場で提案。」を表示 — manifest の `description_ja` にある実機能（-14 dBFS 提案）のみを使用 |
| 「ポートフォリオに広告枠を足した印象」「編集上の連続性が無い」 | 認識は正しい。広告と現在地の接点は「同じ作品・ツールを宣伝する」事実上一致のみで、編集的な物語的接続は意図的に作っていない（広告は別軸という設計判断）。これは設計仮説であり、実広告媒体の「広告が記事内容と無関係に配信される」性質とは整合する |

### 観察事実 / 設計仮説 / 独自表現の区別

- **観察事実**: リーダーボードはサイトヘッダー直下、フィードカードは
  1.91:1 画像+ドメイン+太字見出し、カルーセルは画像主役の複数
  カード、動画広告はサムネイル+再生 affordance、ネイティブ/商品/
  ストア系は静的、ディスプレイ矩形は全面クリエイティブ+スクリム、
  プレイアブルは枠内で製品が動く、CTA は行動動詞、開示ラベル必須、
  フォーマットごとに角丸・モーションが異なる。
- **設計仮説**: 「広告ユニットが現在地コンテンツと同じ作品を
  宣伝する」ことで両者が互いの表現を強める、という仮説。
  Portfolio 広告（レール・カルーセル・矩形）が現在地で語られる
  制作物と同一ソース（公開 API）なのはこの仮説の実装。ただし
  「媒体らしさ」の編集的連続性は仮説の範囲を超える主張はしない。
- **このサイト独自の表現**: ツールの画面キャプチャを広告
  クリエイティブに使うこと、プレイアブルが実ツールの iframe で
  あること、広告主名が `rebuildup`/`rebuildup.dev` であること、
  全ユニットの遷移先が自サイト内の実ページであること。実広告の
  「他社商品を売る」構造を「自分の制作物を見せる」に転用した点は
  再現ではなく翻案であり、その差は残課題として正直に記録する。

### Tenth pass の検証

- 実ブラウザ（production-readonly データソース）1440×900 / 390×844:
  広告画像 13/13 読込、consent 非表示、h1 ×1、横スクロールなし、
  モバイル leaderboard が横組み小サムネ化。証跡:
  `final13-desktop-1440.png` / `final13-desktop-full.png` /
  `final13-mobile.png`。
- 独立レビュー: Codex（実装と別モデル）が final12 + 参照広告を
  画像として読み、A〜E の構造化批評を取得（本節に転記）。
- `tsc --noEmit` / biome クリーン。
