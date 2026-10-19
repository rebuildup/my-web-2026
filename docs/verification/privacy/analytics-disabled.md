# 解析の同意と拒否 — 拒否状態でも読めるサイト (#495)

- 対象: `src/editorial/analytics/**`（`consent.ts` の判定契約、
  `AnalyticsGate` / `AnalyticsConsentControl`、GA4 bootstrap）と、
  その結線 `src/routes/__root.tsx`
- Issue: #495（`privacy(data): 解析Cookieと同意/拒否の挙動を検証`）
- 成果物: `docs/verification/privacy/analytics-disabled.webp`
- 状態: **本 Issue で実装・検証済み**。残る未決事項は §8 に列挙

## 1. 何を撮ったか（条件・対象範囲）

| 項目 | 値 |
| --- | --- |
| 描画対象 | `src/editorial/analytics/AnalyticsConsent.stories.tsx` の `Editorial/AnalyticsConsent` → `AllStates`（shipped story を harness が直接 import して描画） |
| capture 手段 | `pnpm run capture:analytics-consent`（`node scripts/capture-analytics-consent.mjs`。`.tmp/` に Vite harness を生成 → loopback 配信 → Playwright Chromium → `sharp` で WebP 化） |
| 描画 CSS | リポジトリの Panda 設定（`postcss.config.mjs` → `panda.config.ts`）を harness の Vite build に渡したもの。すなわち実際の `src/styles.css` |
| viewport / DPR | 1280 x 900 / 1（`fullPage` 撮影） |
| 生成物サイズ | 1280 x 1722 px、**60 kB** WebP（quality 80、budget 300 kB、最大幅 1600） |
| 再現性 | **encode 段は決定的、ブラウザ撮影は byte 再現ではない**。再生成は視覚的に同一であることを目標とする |
| 本番非破壊 | 既定で外部通信なし。local harness build と loopback 配信のみ。deploy / remote binding / secret 値の読み出しは無い |

Issue は `docs/verification/privacy/analytics-disabled.png` を指定しているが、
本リポジトリの検証画像は **WebP** で commit する規約であり、
`scripts/capture-error-state-gallery.mjs`（Issue #501）がその先例である。
`scripts/capture-analytics-consent.mjs` は `.webp` 以外の出力先を拒否し、
中間 PNG は `.tmp/` に置いて削除する。この差分は PR 本文にも記載する。

## 2. 画面が示している状態

画像の 5 段が、来訪者が取りうる同意状態に対応する。いずれも
`AnalyticsConsentPanel` の実物で、文言・操作は `AnalyticsConsent.tsx`
の定数そのものである。

1. **未選択（初回訪問）** — `unset`。計測タグは読み込まれず、何も
   送信されない。拒否しても画面と操作は変わらないことを明示する。
2. **許可** — `granted`。許可するのは **解析ストレージのみ**。
   広告・個人化ストレージは拒否のままであることを文言で示す。
3. **拒否** — 保存済みの `denied`。読み込み済みのタグも停止する
   （§5 の `ga-disable` + Consent Mode `update`）。
4. **ブラウザのオプトアウト（DNT / GPC）** — ブラウザ指定が保存値より
   優先される。許可ボタンは提示しない（押しても保存値が効かないため）。
5. **保存の拒否** — `localStorage` が書き込みを拒否した状態。記録が
   無いので計測もしない、という結論をパネル自身が表示する。

この画像は **状態の copy と affordance のレポート**であり、計測タグの
不在そのものの証明ではない。不在の証明は §4 の request-level suite が
担う（画像で「タグが無い」ことは撮れない）。

## 3. 判定基準

| 対象 | 基準 | 固定している test |
| --- | --- | --- |
| 同意判定 | `granted` は保存値 `granted` かつ off-switch 無しのときだけ。それ以外（未保存・不明値・空文字・空白・`setItem` throw）は `unset` = 非計測 | `src/editorial/analytics/consent.test.ts`（19） |
| GA4 bootstrap | 許可が解決するまで `GoogleAnalytics` は描画されない。描画後も `analyticsMeasurementAllowed()` が偽なら page_view を送らない | `GoogleAnalytics.test.tsx`（26） |
| 拒否の実効性 | withdraw で `window['ga-disable-<ID>'] = true` と `gtag('consent','update',{…denied})` の両方が発行される。再許可でフラグが false に戻る。保存拒否時は記録も計測も残らない | `AnalyticsConsent.client.test.tsx`（12） |
| 公開 SSR HTML | `/` `/about` `/contact` の document に `googletagmanager.com` / `gtag(` / consent test id が一切含まれない。query / cookie では武装できない。`/admin/login` は同意 UI もタグも出さない | `test/integration/analytics-consent.test.ts`（5）、`test/integration/privacy-projection.test.ts`（26） |
| 公開する情報 | 生きた `page_view` の param は `page_path` / `page_location` / `page_title` のみ。query は strip され、owner 未承認データの検出器に掛からない | `privacy-projection.test.ts` の granted case |

## 4. 実行手順

```bash
# 判定契約・GA4 bootstrap・request-level 要件（workerd pool）
pnpm exec vitest run src/editorial/analytics \
  test/integration/analytics-consent.test.ts \
  test/integration/privacy-projection.test.ts

# DOM / localStorage を伴う同意 UI の挙動（happy-dom pool）
pnpm run test:client

# 画像 artefact の再生成
pnpm run capture:analytics-consent
```

2026-10-20 時点の実測: 上記 workerd 側 4 files / 76 tests passed、
client 側 7 files / 50 tests passed。`validate:fast` は `pnpm run test`
（workerd pool）を含む。`test:client` は gate には載っていない
（§8 #3）。

## 5. 保存する状態・Consent Mode・停止の実装

| 項目 | 実装 |
| --- | --- |
| 保存先 | `localStorage` の 1 キー `my-web-2026:analytics-consent`。値はリテラル `granted` / `denied` のいずれか。識別子・時刻・訪問者情報・fingerprint は保存しない |
| cookie / sessionStorage | **使わない**。cookie は新しい追跡面になり、session スコープはタブごとに再質問になるため |
| 保存値の扱い | 不明値はすべて `unset`（非計測）へ縮退する。`granted` へは決して縮退しない |
| Consent Mode `default` | タグを載せる時点で `analytics_storage: 'granted'`、`ad_storage` / `ad_user_data` / `ad_personalization` / `functionality_storage` / `personalization_storage` / `security_storage` は `denied`。許可の対象は解析ストレージだけである |
| 拒否（withdraw） | `gtag('consent','update', { …全 storage: 'denied' })` に加えて `window['ga-disable-<measurementId>'] = true`。**この 2 つは片方だけでは足りない**: 前者は保存・送信を止めるが、後者は以降の collect 自体を止める |
| 再許可 | `window['ga-disable-<ID>'] = false`。次の `page_view` から通常どおり記録される |
| 保存拒否 | `setItem` が throw した場合、document 内の状態を `unset` に戻し、計測も停止し、パネルに「設定を保存できませんでした / このセッションでは計測しません」を表示する |
| DNT / GPC | `navigator.doNotTrack === '1'` と `navigator.globalPrivacyControl === true` は hard off-switch。保存値 `granted` でも上書きしない |
| `/admin/**` | `AnalyticsGate` も `AnalyticsConsentControl` も描画しない。運用面に訪問者向けの同意質問を出さない |
| SSR | 同意判定は storage を読めないため、SSR document にはタグ・inline gtag・同意 UI のいずれも含まれない。判定は mount effect 以降にだけ行われる |

`analytics_storage: 'granted'` を `default` に置くのは、この時点で
「訪問者の明示的な許可が既に存在する」ことがタグ描画の前提になっている
ためである。許可が無い document では `default` 自体が実行されない。

## 6. 適用法の判断

`consent.ts` の module docstring が参照する節。

**本リポジトリは、どの法域のどの規定が特定の訪問者に適用されるかを
コードで断定しない。** これは実装の省略ではなく、owner の判断事項である。
サイトは 1 origin で、訪問者の居住地・法的地位はリクエストから信頼できる
形では分からない。IP から地域を推定して分岐する実装は、推定誤り・
共有 IP・VPN に対して「同意なしで計測する」側へ倒れる可能性を持つ。

代わりに実装は、**どの法域でも防御可能な 2 状態**だけを持つ。

- **明示的な許可がある** → 解析ストレージのみ有効。
- **それ以外（未選択・拒否・不明値・保存不能・DNT/GPC）** → 何も
  送信しない。

同意先行型の法域（例: 欧州経済領域の ePrivacy 運用）の訪問者には
「同意するまで何も送らない」がそのまま成立し、opt-out 型の法域の
訪問者にも「拒否すれば止まる」が成立する。per-region の分岐は無い。
特定の法令への適合性判断、プライバシーポリシー文言、保存期間の
決定は **owner / 法務の判断**であり、本 Issue のスコープ外とする。

## 7. 外部通信と依存（同意前 / 同意後）

| 相手 | 通信 | 起動条件 | 可読性に必要か |
| --- | --- | --- | --- |
| Google Fonts | stylesheet + font file | 全公開ページ、**同意の有無に関係なく** | 不要（platform font で読める） |
| Google Analytics 4 | `gtag.js` + collect | **`granted` が解決した document のみ** | 不要 |
| 第三者 API | 無し | — | — |

同意前に残る第三者通信は Google Fonts だけである（`src/routes/__root.tsx`
の非同期 stylesheet）。これは計測ではなく表示用フォントの取得であり、
IP は Google に渡る。同意 UI の文言は「解析」についてのみ述べており、
フォント取得を計測と同じ同意の対象とは扱っていない。この整理を
変えるか（セルフホスト化を含む）は §8 #2 の未決事項である。

## 8. 残存リスク / 未決事項

1. **同意の実効性はクライアント側の実装に依存する**。SSR document に
   タグが無いことは request-level で固定しているが、「granted の
   document で必ず 1 回だけ page_view が送られる」ことはブラウザ実行を
   伴うため、`test:client`（gate 外）と runbook の手順で確認する。
2. **Google Fonts は同意前に取得される**（§7）。計測ではないが第三者
   通信であり、セルフホスト化・`font-display` 方針と合わせて owner が
   判断する。本 Issue では挙動を変えず、事実として記録する。
3. **`test:client` は `validate:fast` / CI に載っていない**。GA4 の
   停止・再許可は DOM と `localStorage` を必要とするため workerd pool
   では検証できず、gate へ足すかは quality profile の変更（別 decision）。
   現状は §5 の契約を unit test（workerd）と client test（手元）の
   二段で固定している。
4. **`ga-disable` はグローバル変数であり、タグ側の実装に依存する**。
   Google の `gtag.js` はこのキーを見て collect を止めるが、将来の
   スクリプト変更で無視された場合、Consent Mode の `update` だけが
   残る。両方を発行しているのはこのためで、片方の退行を test が検出する。
5. **未選択の訪問者への提示は、許可が視覚的な primary、拒否が
   secondary である**（画像の 1 段目）。どちらも同じパネル内で
   1 クリックで選べ、拒否を選んでも画面と操作は変わらない。一方で
   この視覚的な重みの差を dark pattern と見るか、product / legal の
   判断であり、本 Issue では変えていない。既定の状態は
   「未選択 = 非計測」であり、何もしない訪問者は計測されない。
6. **画像 artefact の再生成は手元実行**。`capture:analytics-consent` は
   `.tmp/` に harness を生成するため repo には残らず、CI では撮らない。
   suite が正であり、画像は補助資料である。
