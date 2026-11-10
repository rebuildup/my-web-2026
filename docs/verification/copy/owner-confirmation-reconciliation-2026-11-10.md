# owner 承認記録の照合 — 35 件の実測（Issue #754）

> この記録は **agent の実測**である。owner 承認の記録ではない
> （AGENTS.md §6 / Issue #741 / `docs/runbook/issue-lifecycle.md`）。
> ここに書いた「確認できた」は「リポジトリの中で事実と一致している」という意味であり、
> **owner がその文言を承認した**という意味ではない。

- 測定日: 2026-11-10
- 測定ツリー: ブランチ `754`（base `origin/release-0-8-3` = `b8f32f82`）
- 正本: [`quality/copy-editorial-approvals.json`](../../../quality/copy-editorial-approvals.json)
  （以下 **copy 台帳**）、[`quality/stale-content-review.json`](../../../quality/stale-content-review.json)
  （以下 **鮮度台帳**）
- 手順: [`docs/runbook/copy-editorial-approval.md`](../../runbook/copy-editorial-approval.md) /
  [`docs/runbook/stale-content-review.md`](../../runbook/stale-content-review.md)

## 1. 台帳の実測値

| 台帳 | 件数 | `ownerConfirmation` | owner を指す artefact |
| --- | --- | --- | --- |
| copy 台帳 | 7 record | `decision: "pending"` 7 / 7、`reviewer: null` 7 / 7、`provenance: null` 7 / 7 | `ownerReference` 非 null **0** |
| 鮮度台帳 | 28 expression | `ownerConfirmation: "unconfirmed"` 28 / 28（`reviewedBy: "agent"`） | `ownerReference` 非 null **0** |
| 合計 | **35** | owner 確認済み **0** | **0** |

`pnpm run copy:stale:check` の出力（2026-11-10 実測）:

```
time-sensitive expressions: 45  (current 28, review pending 0, not scanned 17)
review records: 28  (owner-confirmed 0, awaiting owner confirmation 28)
review queue: empty — every scanned expression carries a record inside the window.
```

つまり **鮮度台帳は「記録はある・窓の内側・ただし owner 未確認」** という状態で、
gate は緑だが「owner が読んだ」とは主張していない（runbook §3.4 の設計どおり）。

## 2. 鮮度台帳 28 件 — 文面は今もコードに存在する

全 28 expression を、台帳が指すファイルの現在の内容と**バイト一致**で突き合わせた。

| 結果 | 件数 |
| --- | --- |
| expression が現在のファイルに**そのまま存在** | **28 / 28** |
| 存在しない（文面が書き換わった） | 0 |
| ファイル自体が無い | 0 |

したがって「台帳が指す文面」と「いま公開される文面」の間の drift は **0** である。
台帳の `reviewedAt` が古いことは「文面が変わった」ことを意味しない。

### 2.1 文面の性質による 3 分類

「時間で古びる」と一口に言っても、古び方は 3 種類ある。owner の読み直しが
必要なのは **B** である。

| 分類 | 意味 | 件数 |
| --- | --- | --- |
| **A. 条件付きの文面** | 文面自体は固定で、描画条件が render 時にデータから計算される。条件が偽なら文面は出ない | 14 |
| **B. 無条件の事実主張** | コードが変わらなくても、世界の側が変わると偽になる | 4 |
| **C. ラベル・凡例・機構の説明** | 語の意味や UI の仕組みの説明。世界の状態を主張しない | 10 |

#### B. 無条件の事実主張（owner の判断が要る 4 件）

| id | 文面 | 位置 | 何が変わると偽になるか |
| --- | --- | --- | --- |
| `about-video-commission-parked` | 「依頼制の映像 / デザイン制作を継続的に受ける mode は、現時点では parked。需要と制作余力が見合ったときに再開する。」 | `src/about/data.ts:87` | 受注を再開したとき |
| `contact-commission-not-accepted` | 「価格・制作依頼 (commission) のお問い合わせは、現時点ではこのページでは受け付けていません。」 | `src/contact/page.tsx:123` | 受注を再開したとき |
| `portfolio-seed-evidence-current-sale` | 「累計販売 500 本以上 (as_of: 2026-01)。download 数や現在販売状況は時間で変わるため…」 | `src/portfolio/seed.ts:140` | 数値が動いたとき（文面自身が `as_of` を明示している） |
| `keyboard-adoption-note` | 「macOS の Kanata 設定は key-map-kanata の最新 head ではなく、pc-setup installer が pin する config_ref を採用する。」 | `src/keyboard/sources/manifest.json:62` | upstream の installer が追随方式を変えたとき |

`portfolio-seed-evidence-current-sale` は **文面の中に `as_of` を持つ**ので、
読み手は数値の鮮度を自分で判断できる。残り 3 件は `現時点では` という語だけで
鮮度を示しており、**owner が「いまも真か」を答える以外に更新の契機がない**。

#### A. 条件付きの文面（14 件）

描画条件が render 時に決まるため、条件が成り立つ間は文面は偽にならない。
owner が読むべきなのは「条件が成り立ったときに、この言い方でよいか」である。

`about-narrative-subset-empty`（`AboutPage.tsx:426`）、
`projects-dotfiles-freshness-unavailable`（`DotfilesIntroductionPage.tsx:50`）、
`projects-dotfiles-stale-notice`（同 `:721`）、
`projects-dotfiles-missing-snapshot`（同 `:751`）、
`projects-unavailable-not-public` / `projects-unavailable-not-current-suffix` /
`projects-unavailable-fallback-notice`（`unavailable-copy.ts:12,36`）、
`home-current-projects-empty`（`CurrentProjects.tsx:423`）、
`keyboard-sync-age-warning`（`KeyboardPage.tsx:547`）、
`keyboard-unavailable-title` / `keyboard-unavailable-description`
（同 `:883,885`）、`keyboard-manifest-provenance-unverified`（`load.ts:186`）、
`contact-empty-state-832`（`contact/page.tsx:340`）、
`home-status-latest-reachability`（`tiles.tsx:66`）。

#### C. ラベル・凡例・機構の説明（10 件）

`about-current-heading`（`AboutPage.tsx:605`）、
`about-current-description`（`:606`）、
`about-active-parked-legend`（`:672`）、
`contact-intro-current-only` / `contact-intro-unpublished-excluded`（`contact/page.tsx:107,108`）、
`contact-channels-heading-title`（`:139`）、
`home-current-projects-heading`（`CurrentProjects.tsx:22`）、
`keyboard-provenance-description`（`KeyboardPage.tsx:769`）、
`home-contact-cta-832`（`composer.tsx:241`）、
`contact-meta-832`（`routes/contact.tsx:41`）。

## 3. copy 台帳 7 件 — 承認された文面のうち **10 segment が現存しない**

各 record の `comparisons[].after`（= 承認対象として記録された文面）を、
現在のファイル内容と突き合わせた。

| record | PR | segments | 現存 | **現存しない** |
| --- | --- | --- | --- | --- |
| `pr-661` | #661 | 5 | 5 | 0 |
| `pr-655` | #655 | 66 | 66 | 0 |
| `pr-644` | #644 | 20 | 18 | **2** |
| `pr-663` | #663 | 6 | 6 | 0 |
| `pr-667` | #667 | 3 | 3 | 0 |
| `pr-619` | #619 | 120 | 112 | **8** |
| `pr-819` | #819 | 8 | 8 | 0 |
| 合計 | — | 228 | 218 | **10** |

### 3.1 現存しない 10 segment の内訳

**(a) `pr-644` — GA4 同意文の言い換え（2 件、`src/editorial/analytics/AnalyticsConsent.tsx`）**

| 記録されていた文面 | 現在 |
| --- | --- |
| 「許可すると、Google の解析サービス（GA4）へ、閲覧したページのパス・参照元・ブラウザや端末の情報が送信されます。許可していないあいだは何も送信されません。拒否しても、このサイトの表示と操作は変わりません。」 | 別の文面に置き換わっている |
| 「許可したあいだは、閲覧したページのパス・参照元・ブラウザや端末の情報が Google の解析サービス（GA4）へ送信されます。広告用途の保存は有効にしていません。」 | 同上 |

**(b) `pr-619` — 消えた surface と書き換わった文面（8 件）**

| 対象 | 件数 | 状態 |
| --- | --- | --- |
| `src/tools/embed-consent-notice.tsx` | 6 | **ファイルが存在しない**（Issue #911 / PR #914 で click-to-load 同意ゲートごと削除） |
| `src/home/composer.tsx` | 1 | リアクション Cookie の説明が書き換わった |
| `src/routes/tools.$slug.tsx` | 1 | 埋め込みポリシーの説明が書き換わった |

`embed-consent-notice.tsx` の 6 segment は、**その surface 自体がもう無い**ので
「承認されていない」ではなく「**承認の対象が消えた**」である。台帳からは
「未確認の承認待ち」に見えるが、実際には判断の必要が無い。

### 3.2 ここから言えること

- **7 record のうち 5 record（`pr-661` / `pr-655` / `pr-663` / `pr-667` / `pr-819`、
  88 segment）は、承認対象の文面が今もそのまま公開されている。** owner が読めば
  そのまま `approved` にできる。
- **`pr-644` の 2 segment と `pr-619` の 2 segment（composer / tools）は、
  記録された文面が現存しない。** これらの record を `approved` にしても、
  いま公開されている文面は承認されない。**現在の文面には記録が無い**
  （= 新しい diff としては `not run`）。
- **`pr-619` の 6 segment は対象 surface が削除済み。** 判断は不要で、
  record を「superseded」として閉じるのが正しい。

## 4. owner の判断が要るもの（優先順）

| 優先 | 対象 | 何を決めるか |
| --- | --- | --- |
| 1 | 鮮度台帳の **B 4 件** | 「いまも真か」。偽なら文面を直す（コード変更 + 新しい record） |
| 2 | copy 台帳の **5 record / 88 segment** | そのまま `approved` でよいか。`proposal` は全件 `ran: true`、`comparisons` は全 segment に `verdict` + `note` がある |
| 3 | copy 台帳の **`pr-644` 2 件 / `pr-619` 2 件** | 記録された文面が現存しない。**現在の文面を新しく読む**必要がある |
| 4 | copy 台帳の **`pr-619` 6 件** | 対象 surface が削除済み。`superseded` として閉じてよいか |
| 5 | 鮮度台帳の **A 14 件 / C 10 件** | 「条件が成り立ったとき、この言い方でよいか」。文面は固定なので急がない |

## 5. この記録がしないこと

- **`ownerConfirmation` を `confirmed` にしない。** 台帳の書き換えは行っていない。
  agent が「リポジトリ内で一致している」ことを確認しても、owner の承認にはならない
  （`docs/runbook/copy-editorial-approval.md` §3.4）。
- **`decision` を `approved` にしない。** 同上。
- **文面を書き換えない。** 誤りと判定できる文面は無かった（B 4 件は「真偽不明」で
  あって「偽」ではない）。
- **Issue #754 を close しない。** 受入条件は owner の確認であり、未達である。

## 6. 再現手順

どちらも read-only で、リポジトリの外に何も書かない。

```bash
# 鮮度台帳: 28 expression が現在のコードに存在するか
node -e '
const fs=require("fs");
const b=require("./quality/stale-content-review.json");
let ok=0; const bad=[];
for (const r of b.expressions) {
  let t=""; try { t=fs.readFileSync(r.path,"utf8"); } catch { bad.push([r.id,"file-missing"]); continue; }
  if (t.includes(r.expression.trim())) ok++; else bad.push([r.id,"changed"]);
}
console.log({ total: b.expressions.length, present: ok, absent: bad });'

# copy 台帳: 承認対象の文面（comparisons[].after）が現在も存在するか
node -e '
const fs=require("fs");
const a=require("./quality/copy-editorial-approvals.json");
let t2=0,p2=0,a2=0;
for (const r of a.records) {
  let present=0, absent=0;
  for (const c of r.comparisons ?? []) {
    if (c.after === null) { present++; continue; }
    let t=""; try { t=fs.readFileSync(c.path,"utf8"); } catch {}
    if (t.includes(c.after.trim())) present++; else absent++;
  }
  t2+=present+absent; p2+=present; a2+=absent;
  console.log(r.id, { segments: (r.comparisons ?? []).length, present, absent });
}
console.log({ total: t2, present: p2, absent: a2 });'
```

期待される出力: 鮮度台帳 `present: 28`、copy 台帳 `total: 228, present: 218, absent: 10`。

