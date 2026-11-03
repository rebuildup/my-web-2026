# 情報アーキテクチャ提案 — direction B

> 状態: **提案のみ（未実装）**。Issue #764 Phase 2 の入力であり、
> owner 承認でも、実装計画の確定でもない。ここに書いた統合・分離は
> すべて「決めるべき論点」であって決定ではない。

## 1. この文書の目的

Phase 1（Issue #764）は色の役割を direction B に置き換えた。
Phase 2 は「どの面で何を決められるか」を整理する。色を抑えても、
1 ページに判断が詰まりすぎていれば direction B の意図
（1 画面 1 つの決定、色は 1 行・1 語・1 ピル）は成立しない。

この文書は現行の公開ルートを実際に読み、各面が抱えている判断を
1 行で書き出し、direction B に沿った IA の方向を提案する。
ルートの削除・統合・ redirect は **行わない**。

## 2. 測定方法

- ルート一覧: `src/routes/**` のファイルルート（`*.tsx`）を列挙。
- ナビ到達性: `src/editorial/nav/PublicNav.tsx` の
  `NAV_ITEMS`（公開ナビ）と `src/editorial/nav/route-labels.ts`
  （パンくず）を突き合わせ。
- 各面の判断: ルートが描画するページコンポジション
  （`src/home/composer.tsx`、`src/about/components/AboutPage.tsx`、
  `src/portfolio/components`、`src/tools`、`src/keyboard`、
  `src/projects`、`src/contact`）のセクション見出しを数えた。
- sitemap / index boundary: `src/http/seo/sitemap.ts` と
  `scripts/_index-boundary.mjs` の扱い。
- 2026-11-03 時点の `origin/release-0-8-1` を基準にした。

## 3. 現行の公開面（実測）

「この面で決められること」は、そのページを見た訪問者が
**その場で下せる判断**を 1 行にしたもの。セクション数は
見出し（`SectionHeading` / `h2`）の数。

| ルート | 公開ナビ | セクション数 | この面で決められること | 主な行き先 |
| --- | --- | --- | --- | --- |
| `/` | あり（ホーム） | 6 + hero + footer | 「この人は今なにをしていて、どこまで動いているか」を掴む | 各面への入口、reaction、contact |
| `/about` | あり（自己紹介） | 5（identity / interests / current / future / experience） | 「この人に仕事を頼めるか、何者か」を判断する | portfolio detail、contact、keyboard |
| `/portfolio` | あり（ポートフォリオ） | 1（一覧 + facet） | 「どの制作物を読むか」を選ぶ | `/portfolio/<slug>` |
| `/portfolio/<slug>` | パンくずのみ | 1 作品 | 「この作品が自分の課題に合うか」を判断する | repository / release / 次の作品 |
| `/projects/dotfiles` | なし（About から） | 1 プロジェクト紹介 | 「dotfiles を自分の環境に使えるか」を判断する | upstream README |
| `/tools` | あり（ツール） | 2（使える / 準備中） | 「どのツールを今すぐ使うか」を選ぶ | `/tools/<slug>` |
| `/tools/<slug>` | パンくずのみ | 1 ツール | 「このツールを信頼して開くか」を判断する（iframe / block / disabled） | ツール本体 |
| `/keyboard` | なし（About から） | 4（基本 / HUB / 記号 / 自動化） | 「このキー配列を自分の環境で再現するか」を判断する | — |
| `/contact` | あり（お問い合わせ） | 1（channel 一覧） | 「どの経路で連絡するか」を選ぶ | 外部チャネル |
| `/design-system` | あり（デザインシステム） | 9 | 「この visual language をどう使うか」を確認する（開発者向け） | `colors.md` |

補足（実測で分かったこと）:

- **`/legal` と `/privacy` というルートは存在しない。** 法務の
  asset-rights review は `src/legal/AssetLicenseReview.tsx` という
  コンポーネントで、公開ルートに接続されていない。privacy notice は
  `src/home/privacy-notice.tsx` として Home の footer に埋め込まれている。
- `/keyboard` と `/projects/dotfiles` は indexable だが sitemap から
  除外され、公開ナビにも出ない。About からのみ到達する。
- `/design-system` は公開ナビの 6 番目に入っている。開発者向けの
  showcase であり、一般訪問者の判断には寄与しない。
- Home は 6 つのセクション（Now / Capabilities / System status /
  Reactions / Counter / Contact）と privacy notice を 1 面に持つ。
  direction B の「1 画面 1 決定」から最も遠い面である。

## 4. 観測した問題

1. **ナビが「制作物」と「開発者向け showcase」を同列に並べている。**
   `/design-system` は訪問者の判断ではなく実装者の参照面であり、
   公開ナビの枠を 1 つ消費している。
2. **`/portfolio` と `/projects/dotfiles` が同じ問いに答えている。**
   どちらも「この人の制作物を読む」面だが、片方はナビにあり、
   片方は About の奥にある。訪問者から見ると同じ列に並ぶべきものが
   2 つの異なる経路に分かれている。
3. **Home が判断を詰め込みすぎている。** Now / Capabilities /
   Status / Reactions / Counter / Contact が 1 面にあり、
   「今なにをしているか」を掴むという主目的が、
   運用 transparency と交流機能に埋もれる。
4. **`/contact` が独立している理由は強い。** 「どの経路で連絡するか」
   という単一の判断しか持たず、Home の CTA からも到達する。
   これは統合対象ではなく、維持すべき分離である。
5. **`/keyboard` は About の付属物として正しい。** 一般的な訪問者の
   判断には寄与せず、本人の環境に関心がある読者だけが辿る。
   公開ナビに出すと、ナビの意味が「作品」から「個人メモ」へ薄まる。

## 5. direction B の IA 提案

原則: **ナビの 1 項目 = 訪問者が下す 1 つの判断**。
面の数ではなく、判断の種類でグループを作る。

### 5.1 提案するナビ（5 項目）

| 新ナビ | 吸収する現行ルート | 訪問者の判断 |
| --- | --- | --- |
| ホーム | `/` | 「この人は今なにをしているか」を掴む |
| 作品 | `/portfolio`、`/portfolio/<slug>`、`/projects/dotfiles` | 「どの制作物を読み、どれを自分の課題に使うか」 |
| ツール | `/tools`、`/tools/<slug>` | 「どのツールを今すぐ使うか」 |
| 自分 | `/about`、`/keyboard` | 「この人に頼めるか、この人の環境を参考にするか」 |
| 連絡 | `/contact` | 「どの経路で連絡するか」 |

`/design-system` はナビから外し、footer の「開発者向け」リンクに
移す。showcase は残すが、訪問者の判断面とは宣言しない。

### 5.2 統合するもの

- **`/projects/dotfiles` → 作品の一項目。** 独立したトップレベル面では
  なく、`/portfolio` の一覧に「dotfiles」として並べるか、
  `/portfolio/dotfiles` として同じ詳細テンプレートに載せる。
  どちらも「制作物を読む」という同じ判断である。
- **`/keyboard` → 自分の付属面。** 独立ナビをやめ、`/about` から
  リンクする現行の到達性を維持する。sitemap 除外も維持。
- **Home の System status / Counter / Reactions → 1 つの
  「サイトの状態」セクションに圧縮。** 3 つの別セクションを
  1 つの判断（「このサイトは今動いているか」）にまとめ、
  Reactions と Counter はその中または footer へ退避する。
  Home の主目的を「今なにをしているか」に戻す。

### 5.3 分離したまま維持するもの

- **`/contact`** — 単一判断・単一目的。Home の CTA からも到達する。
- **`/portfolio/<slug>` と `/tools/<slug>`** — 一覧の子ではなく、
  それぞれ独立した「採用 / 信頼」の判断面。詳細テンプレートは
  共有してよいが、URL は残す。
- **privacy notice** — Home footer に置く。独立ルートにしない
  （独立させると「読む義務」の面になり、方向 B の判断面と競合する）。
- **`/legal` を作らない** — asset-rights review は現状コンポーネント
  であり、公開ルートを持たない。ルート化するかは owner 判断。

### 5.4 変えないもの（この提案の範囲外）

- ページのコンポジション（Phase 1 のスコープ外。Issue #764 の
  PR では Home / About / Portfolio / Tools の構成を変更していない）。
- ルートの削除・redirect・canonical の変更。
- sitemap / index boundary の変更。
- 公開コピーの変更（Issue #506 の owner レビュー対象）。

## 6. 実装順序（Phase 2 の案、未着手）

1. **計測のやり直し** — 統合後に同じ手法で「面あたりの判断数」を
   測り、Home が 6 → 2、ナビが 6 → 5 になることを確認する。
2. **ナビの変更** — `/design-system` を footer へ。`作品` の
   ラベルと到達先を決める（`/portfolio` のままか、`/works` にするか）。
3. **`/projects/dotfiles` の位置づけ** — portfolio 一覧への追加か、
   `/portfolio/dotfiles` への移設か。redirect の要否を決める。
4. **Home の圧縮** — status / counter / reactions の統合。
   これはページコンポジションの変更なので、独立した Issue にする。
5. **検証** — ナビ到達性、sitemap、パンくず、公開コピーゲート
   （Issue #506）をそれぞれ再実行する。

## 7. 決めていないこと

- ナビのラベル（「作品」「自分」が日本語として適切か）。
- `/projects/dotfiles` を portfolio に統合するか、`/works` のような
  新しい名前空間を作るか。
- `/design-system` を公開のまま footer に残すか、認証下に移すか。
- `/legal` を公開ルートにするか、コンポーネントのままにするか。
- Home の Reactions / Counter を残すか、廃止するか。
- 統合に伴う redirect の恒久化（SEO 上の扱い）。

これらはすべて owner 判断であり、この文書は選択肢と実測だけを置く。
