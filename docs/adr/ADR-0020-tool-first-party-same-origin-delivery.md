# ADR-0020 — Tool を first-party 同一 origin で配信し、iframe sandbox を外す

- Status: **Accepted** — 本文の採択は **engineering decision**。owner が示した
  のは「全 Tool を利用可能にする」**要件だけ**であり、sandbox / iframe /
  本文の採否は owner の指示ではない（決定の出所は §0）。
- Date: 2026-11-02
- Accepted on: 2026-11-02（**本文の採択は engineering decision**。owner の
  指示は要件のみ — https://github.com/rebuildup/my-web-2026/issues/769 ）
- Ticket: Issue #769（判定）/ Issue #825
  （`refactor(tools): Tool を sandbox 付き iframe から first-party 同一 origin 配信へ変える`、実装）
- Target release: `release-0-8-1`（0.8.1）
- Implemented at: `src/tools/`（`manifest.json` / `manifest.schema.json` /
  `embed-policy.ts` / `registry.ts`）、`src/routes/tools.$slug.tsx`、
  `scripts/check-tools-manifest.mjs`（first-party の `sandbox` 宣言を
  `embed.sandbox.not-allowed-for-first-party` で拒否）、
  `docs/tools/embed-policy.md`
- Evidence: `.tmp/issue-825/probe.mjs` による production 実測（2026-11-02、
  `https://rebuildup.dev/tools/readmark`）。実装後の証跡は
  `docs/verification/tools/tool-first-party-delivery.md` に置く
  （agent 記録、owner 未確認）。
- Related: ADR-0006（Tool submodule / artefact namespace）、
  `docs/tools/embed-policy.md`、`docs/tools/embed-privacy.md`、
  Issue #465（embed policy）、Issue #498（third-party consent）、
  Issue #786（readmark の保存前提 — 本 ADR で設計方向を撤回）

> **決定の記録。** owner が 2026-11-02 に示したのは **「全 Tool を利用可能に
> する」**という要件だけである（Issue #769 本文に逐語引用）。**sandbox を外す
> こと / iframe を残すこと / 本文の採否は owner の指示ではなく**、AGENTS.md §8
> の決定優先順位から導出した engineering decision である（§0 の表）。
> agent がこの ADR を書き、本行を編集し、Status を Accepted にしたことは
> **owner 承認の証拠ではない**（AGENTS.md §6 /
> `docs/runbook/issue-lifecycle.md`）。実装は Issue #825、15 Tool ごとの終了
> 条件と実行順は
> [`../verification/tools/completion-inventory.md`](../verification/tools/completion-inventory.md)。

## 0. 決定の出所（Accepted の意味）

| 事項 | 誰が決めたか | 出所 |
| --- | --- | --- |
| 「全 15 Tool を利用可能にする」 | **owner** | Issue #769 本文（2026-11-02 の逐語引用） |
| `host_disabled` は恒久状態ではない | engineering decision | Issue #769 決定 1・2 / 本 ADR §2.6 |
| `same_origin_static` の sandbox を外す | engineering decision | 本 ADR §2.1 / §1.2 の測定 |
| iframe は URL / chrome / CSS の器であり security boundary ではない | engineering decision | 本 ADR §2.2 |
| `mic-level` を `same_origin_static` へ移す | engineering decision | 本 ADR §4.5 / Issue #769 決定 3 |
| 15 Tool の終了条件・実行順・担当 | engineering decision | `docs/verification/tools/completion-inventory.md` |

owner が出したのは**要件**（ツールを全て使えるようにすること）だけである。
sandbox / iframe / ADR 本文の採否は **owner の判断事項ではなく**
（AGENTS.md §8「決定の優先順位」）、本 ADR の Status を Accepted にすることは
**engineering decision** として行う。owner の artefact は Issue #769 の
コメントではなく**同 Issue 本文の逐語引用**（要件）であり、本 ADR の本文を
承認する owner の artefact は存在しない。**「Accepted」は owner 承認を意味
しない**（AGENTS.md §6 / `docs/runbook/issue-lifecycle.md`）。

## 1. Context

### 1.1 Owner 決定（原文）

2026-11-02、repository owner:

> サンドボックスに納める必要がそもそもない。勝手に iframe にしようとしているが、
> その必要があるのかは私は指示していない。

この判断は二つのことを言っている。

1. Tool を sandbox に収める必要はない。Tool は first-party の成果物である。
2. iframe にすること自体も owner の指示ではなかった。したがって「sandbox を
   外すが iframe は残す」を選ぶなら、その理由を測定で示さなければならない
   （§2.2）。

### 1.1.1 owner 要件（原文、2026-11-02 / Issue #769）

> ツールはサンドボックスが必要か不要かそんなことは私が判断する必要がないことだ。
> 他も同じ。**私が指示しているのはツールを全て使えるようにすることだ。**

この要件が**owner が実際に示した内容**であり、本 ADR の採否・sandbox の採否・
iframe の採否は**この要件を充足するための engineering decision** である
（§0）。したがって本 ADR だけ不能满足ではなく、**15 Tool すべてが利用可能に
なるところまでが要件**であり、終了条件と実行順は
[`../verification/tools/completion-inventory.md`](../verification/tools/completion-inventory.md)
が持つ。

### 1.2 現在の契約

Tool は `same_origin_static` / `external_exception` / `host_disabled` の三状態で
配信される（`src/tools/manifest.json`、`docs/tools/embed-policy.md` §1）。
2026-11-02 時点で実際に frame を出すのは `prototype` と `readmark` の 2 件だけで、
どちらも `same_origin_static`、`sandbox: "allow-scripts"`、
`referrer_policy: "no-referrer"` を宣言している。`mic-level` は
`host_disabled` で、**`same_origin_static` として卒業する**ための休眠中の
`iframe` 宣言（`sandbox: "allow-scripts"`、`allow: "microphone"`）を持つ
（卒業先は §4.5 で決定）。

`allow-same-origin` は Issue #465 の policy で**常に拒否**されている。理由は
policy のコメントに書かれているとおりで、Tool の成果物は host と同じ origin
から配信されるため、`allow-same-origin` を付けると sandbox は「何も隔離しない
属性」になるからである。つまり現状の選択肢は次の二つしかなかった。

- **opaque origin**（`allow-scripts` のみ）: 隔離はあるが、`indexedDB` /
  `localStorage` / `sessionStorage` は `SecurityError` になる。
- **`allow-same-origin` を付ける**: storage は動くが、sandbox は完全な嘘になる。

owner はこの二択自体を拒否し、三つ目 — **sandbox を付けない** — を選んだ。

### 1.3 測定された帰結（production、2026-11-02）

`.tmp/issue-825/probe.mjs` を `https://rebuildup.dev/tools/readmark` に対して
実行した結果:

| frame | URL（document） | `indexedDB.open()` | `localStorage.setItem()` | 表示 |
| --- | --- | --- | --- | --- |
| top | `https://rebuildup.dev/tools/readmark` | ok | ok | host の chrome + 同意 band |
| child | `https://rebuildup.dev/` | `SecurityError` | `SecurityError` | `... 読み込み中…` |

child の document URL が `/tools/readmark/app/...` ではなく
`https://rebuildup.dev/` になっているのは、pinned readmark の
`BrowserRouter` が `basename="/"` で、`*` を `<Navigate to="/" replace/>` に
割り当てているためである。sandbox の opaque origin ではその `replaceState` は
frame の document URL だけを書き換える。

同時に記録された console error:

```text
Access to XMLHttpRequest at 'https://rebuildup.dev/cdn-cgi/rum?' from origin 'null'
  has been blocked by CORS policy ...
```

`origin 'null'` が opaque origin の証拠である。Cloudflare の RUM beacon も
opaque origin からは送れない。readmark は library の読み込みで storage を
要求するため、`読み込み中…` のまま止まる。

### 1.4 sandbox は何のためにあったか

sandbox は「Tool のコードを host のコードより信頼しない」ための防御であった。
Issue #465 は Tool の manifest を fail-closed にし、`allow-same-origin` を
禁止し、`referrer_policy` と `frame-ancestors 'self'` を要求した。これは
「Tool は第三者が書いたかもしれない」という前提に立つ。

その前提は、この repository の実際の配信経路と一致していない。

- `same_origin_static` の Tool は **submodule の pinned SHA** から
  `scripts/build-tools.mjs` が build する。手で成果物を置く経路はない。
- `pnpm run tools:provenance:check` が pin と provenance を、
  `tools:artifact:check` が license と dependency set を、
  `sbom:check` が SBOM を検査する。
- pin を上げることは review される PR の diff そのものである。

つまり first-party の Tool は、host の `src/**` と同じ review / build / release
の境界の内側にある。sandbox はその境界の外にいるコードのためのものであり、
内側にいるコードに被せても、storage を壊すだけの属性になる。

### 1.5 直してはいけない罠

`allow-same-origin` を足すのは、この決定の**代替ではない**。同一 origin の
成果物に `allow-same-origin` を付けると、sandbox 属性は残ったまま何も隔離
しなくなる（§1.2）。「sandbox を外す」と「`allow-same-origin` を足す」は
ブラウザの権限としてはほぼ同じだが、**review の読みやすさが正反対**である。
前者は「隔離しない」と明示し、後者は「sandbox で隔離している」と誤読させる。
本 ADR は前者を選び、後者を明示的に禁止し続ける。

## 2. Decision

### 2.1 D1 — `same_origin_static` の Tool は sandbox なしで配信する

`same_origin_static` の Tool は host と同じ origin の first-party 文書として
配信する。`delivery.iframe.sandbox` は宣言できない。宣言しても
build-time gate と runtime policy の両方が拒否する（fail closed）。

- manifest schema: `same_origin_static` の `iframe` は
  `referrer_policy` を必須とし、`sandbox` / `sandbox_rationale` を持たない。
- `src/tools/embed-policy.ts`: `same_origin_static` に `sandbox` が現れたら
  `embed.sandbox.not-allowed-for-first-party` を返す。
- `src/routes/tools.$slug.tsx`: `sandbox` 属性を描画しない
  （summary の `sandbox` は `undefined`）。

### 2.2 D2 — iframe は layout / URL の器であり、security boundary ではない

iframe を残す。理由は隔離ではなく、次の 3 つであり、いずれも測定できる。

1. **URL の封じ込め（測定済み）。** pinned readmark の router は
   `basename: "/"` で、未知の path を `/` に `replace` する。iframe の中では
   この `replaceState` は frame の document URL だけを書き換える（§1.3 の
   child URL がその実測）。同じ bundle を `/tools/readmark` の**トップレベル
   文書**として配信すると、同じコードが**アドレスバーの URL を `/` に書き換える**。
   つまり「ホームページを表示している」と URL が主張しながら、実際には
   readmark が表示され、reload すると tool から離れる。これは host 側では
   直せない。Tool 側に relocatable な base（Vite `base` + router `basename`）
   が入るまで、iframe が URL 変更を封じ込める唯一の器である。
2. **host chrome と scroll の分離。** `/tools/<slug>` は host の nav / footer /
   同意 band を持ち、tool の領域だけがその下で scroll する。direct 配信は
   chrome を失い、別の product surface になる。
3. **CSS / DOM の封じ込め。** tool は別 document なので、host の global CSS と
   tool の CSS が互いに漏れない。これは security ではなく layout の性質である。

したがって本 ADR は「iframe を残すが、**iframe を security boundary とは
呼ばない**」と決める。`sandbox` 属性は外し、`frame-ancestors 'self'` は残す
（後者は「誰がこの文書を frame してよいか」の inbound policy であり、Tool を
host から隔離する制御ではない）。

**規範（本 ADR の一部）**: この repository の文書・コードコメント・UI コピー・
PR 本文は、`/tools/<slug>` の iframe を「隔離」「sandbox」「security boundary」
として記述してはならない。iframe が提供するのは次の 3 つだけである。

1. 別 document の URL の封じ込め（§2.2 の測定）。
2. host chrome / scroll のレイアウト分離。
3. CSS / DOM の document 分離。

security boundary は §3.1 の build / review / release の境界であり、frame では
ない。`sandbox` 属性は存在しないので、frame に「隔離」を期待する記述は事実と
して誤りになる。

direct 配信（`/tools/<slug>` を tool 自身のトップレベル文書にする）は
**この ticket では行わない**。owner の決定は「sandbox を外す」であり、
surface の変更ではない。direct 配信は relocatable base と chrome の扱いを
決める別の product 決定として残す（§8）。

### 2.3 D3 — `external_exception` は sandbox を残す

`external_exception` は host が build していない foreign origin の文書である。
first-party build という前提が成り立たないため、sandbox の規則は**そのまま
残す**（`allow-scripts` 必須、`allow-same-origin` ほかは禁止、conditional
token は `allow` + `sandbox_rationale` 必須）。現時点で live な
`external_exception` は 0 件である。

`host_disabled` の休眠 `iframe` 宣言は**前方宣言**であり、`referrer_policy` と
`allow` だけを持つ。`sandbox` は持たない。卒業先の kind が決まった時点で、
`same_origin_static` なら sandbox なし、`external_exception` なら sandbox 付きの
宣言に置き換える。`mic-level` は `disabled_reason` が
`same_origin_static` への卒業を明記しているため、休眠宣言から `sandbox` を
外す（`allow: "microphone"` と `referrer_policy` は残す）。この規則は
`scripts/check-tools-manifest.mjs` が検査する。

### 2.4 D4 — 残す規則と消す規則

| 規則 | `same_origin_static` | `external_exception` | owner |
| --- | --- | --- | --- |
| `sandbox` | **禁止**（新規 violation） | 必須・既存 grammar のまま | `embed-policy.ts` |
| `sandbox_rationale` | 持たない | conditional token に必須 | `embed-policy.ts` |
| `referrer_policy` | 必須（`no-referrer` / `same-origin` / `strict-origin`） | 同左 | `embed-policy.ts` |
| frame origin | root-relative のみ。URL parse で同一 origin を確認 | `https` の `external_url` のみ | `embed-policy.ts` |
| `host_message` | 残す。`'self'` は host origin に解決され、**初めて runtime で成立する** | 残すが、sandbox により opaque origin のまま（§4.3） | `embed-policy.ts` |
| third-party origin 宣言 + consent | 残す。**trust gate としての意味が強くなる**（§3.4） | 同左 | `embed-privacy.ts` |
| `allow`（Permissions-Policy） | 残す | 残す | `registry.ts` / `server.ts` |
| `frame-ancestors 'self'` | 残す（inbound policy） | 残す | `public/_headers` / `server.ts` |

### 2.5 D5 — manifest / 型 / 描画の変更点

- `PublicToolSummary.iframe.sandbox` は `string | undefined` になる。
- `toSummary()` の既定値は `{ referrer_policy: '' }` になる
  （`sandbox: ''` を捏造しない）。
- route は `sandbox={summary.iframe.sandbox}` を渡す。`undefined` のとき
  React は属性を出力しない。`same_origin_static` の entry が sandbox を
  宣言していた場合は policy が `blocked` にするので、frame は描画されない。
- `docs/tools/embed-policy.md` §1–§2 と §5a を書き直す。§5a の
  「すべての frame は opaque origin」という記述は first-party には
  成り立たなくなる（external には成り立つまま）。

### 2.6 D6 — `host_disabled` は恒久状態ではない

`host_disabled` は **Tool が利用できないことの一時的な記録**であり、
**公開される Tool 集合の決定ではない**。owner の要件は「全 Tool を
利用可能にする」こと（§1.1.1）であり、`host_disabled` を恒久的な状態として
扱うことはその要件への未達である。

したがって次の 3 つを契約とする。

1. **各 Tool は終了条件を持つ。** 「何が足りないか（リポジトリ / ビルド /
   権限 / 配信経路）」「どう測れば終わるか」を
   [`../verification/tools/completion-inventory.md`](../verification/tools/completion-inventory.md)
   に実測付きで记录的。終了条件の無い `host_disabled` は無い。
2. **各 Tool は追跡 Issue を持つ。** 1 Tool 1 Issue（既存 Issue を使い、
   重複を起票しない）。進捗はそこで持つ。
3. **実行順と担当は本 repository が決める。** owner への提示を待つ必要はない
   （AGENTS.md §8）。順序の根拠（リスクの低さ / 依存 / 到達可能性）は
   同記録に書く。

`host_disabled` の Tool を公開済みにしないのは、§3.6 の release 前条件を
満たさないまま公開すること的后果を避けるためであり、**公開しないことが
目的ではない**。

## 3. Security boundary

### 3.1 何が boundary になるか

ブラウザの sandbox が boundary でなくなる代わりに、**build / review / release
の境界**が boundary になる。

| 層 | 何を保証するか | 実装 |
| --- | --- | --- |
| 出所 | Tool のコードが pinned な checkout と一致する | submodule + `tools:provenance:check` |
| 依存 | 宣言された license / dependency set と一致する | `tools:artifact:check` / SBOM |
| 成果物 | pinned checkout から build され、手編集されない | `scripts/build-tools.mjs` |
| review | pin bump は diff として review される | GitHub PR |
| 第三者通信 | 宣言された origin 以外と通信しない**宣言**がある | `embed-privacy.ts` + consent |
| server | 認証・認可・CSRF は server が決める | Hono / TanStack middleware |
| 応答 | 誰が frame してよいか、referrer、Permissions-Policy | `_headers` / `server.ts` |
| 観測 | tool の要求も同じ anomaly monitor が見る | `http/middleware/anomaly-monitor.ts` |

この boundary は**組織的・build-time の境界**であり、runtime の隔離ではない。
「review された first-party コードだけが `/tools/<slug>/app/` に置かれる」ことが
前提である。

### 3.2 失うもの（明示）

sandbox を外すと、Tool の文書は host と同じ origin の完全な権限を持つ。
悪意ある、または侵害された Tool build は次ができる。

- `localStorage` / `sessionStorage` / IndexedDB / CacheStorage を
  `https://rebuildup.dev` の名前空間で読み書きする。
- `document.cookie` を読む（**HttpOnly でない** cookie のみ）。
  reactions の actor cookie と Better Auth の session cookie は HttpOnly
  なので直接は読めない（`src/home/reactions/cookie.ts`、
  `src/cloudflare/auth/session-cookie-contract.ts`）。
- 同一 origin の `fetch` / XHR を、ブラウザが HttpOnly cookie を付けた状態で
  送る。TanStack Start の CSRF middleware は foreign origin を拒否するが、
  same-origin の Tool は foreign origin ではない。**server 側の認証・認可だけが
  最後の境界**になる。
- `window.parent.document` を読み書きする（host の DOM を改変できる）。
- `window.top.location` を変更する、popup を開く、form を送信する、
  download を発生させる。
- `/tools/<slug>/app/` の scope で service worker を登録する
  （origin root の service worker にはならない）。

要するに、Tool の XSS は host origin の XSS になる。

### 3.3 失わないもの

- HttpOnly cookie の**値**は `document.cookie` から読めない。
- server 側の認証・認可は変わらない。Tool が別 user の session を偽造することは
  できない。
- CSRF middleware は foreign origin を引き続き拒否する。
- `frame-ancestors 'self'` により、第三者の site が Tool の成果物を frame
  することはできない。
- 他の origin の data は読めない（same-origin policy はそのまま）。
- Permissions-Policy は powerful feature を引き続き制限する。

### 3.4 補償制御と残存リスク

| リスク | 補償 | 残るもの |
| --- | --- | --- |
| 悪意ある pin bump | PR review + provenance gate | gate は SHA の一致を見るだけで、コードの安全性は見ない。review が唯一の制御。 |
| upstream の侵害 | review + pin | 同じ。 |
| Tool の XSS | なし（runtime） | host origin の XSS。 |
| host DOM の読み出しと外部送信 | 宣言された third-party origin + consent | 宣言外の origin への `fetch` は runtime では止まらない（artifact に CSP はない）。 |
| 認証済み API の悪用 | server 側の認可 | same-origin の要求は CSRF では止まらない。 |

将来の hardening（本 ticket の範囲外）: `/tools/<slug>/app/**` に
`delivery.privacy.third_party_origins` から導出した CSP の `connect-src`
allowlist を付ける。これは「宣言された origin 以外と通信しない」を宣言から
強制に変える。ただし artifact の CSP は未実装であり、本 ADR はその設計を
約束しない。

### 3.5 前提と、前提が崩れる条件

本 ADR の前提:

> `/tools/<slug>/app/` に置かれる成果物は、pinned な checkout から host の
> release が build した first-party のコードであり、host の `src/**` と同じ
> review を受ける。

次のいずれかが起きたら、この前提は崩れ、本 ADR は無効になる。

- 成果物が pinned checkout 以外から来る（手置き、remote fetch、user upload）。
- Tool が review されていない third-party script を実行する。
- Tool が信頼できない HTML / Markdown / SVG をそのまま描画する。
- Tool を「信頼しないコード」として扱う必要が生じる。

その場合は sandbox を戻すか、Tool を別 origin
（例: `tools.rebuildup.dev`）へ移す（§6.3）。

### 3.6 必須の安全条件（release 前条件）

この節は推奨ではなく **gate** である。`same_origin_static` の Tool を有効化
（`host_disabled` から移す、または新規に公開する）する release は、次の全項目を
満たし、その証跡を `docs/verification/tools/` に残さなければならない。1 項目でも
欠けたら有効化しない。

#### (a) 権限前提を明示的に扱う

sandbox のない同一 origin の Tool script は、**parent DOM / 同一 origin の
storage / 同一 origin の API に到達できる**ものとして扱う。これは「リスクが
ある」という注意ではなく、実装と review の前提である。

- `/tools/**` の host chrome に secret・個人情報・認可判断の材料を描画しない。
- Tool から呼ばれる同一 origin の API は、server 側の認可だけで守る
  （CSRF middleware は same-origin の要求を止めない）。
- Tool の XSS は host origin の XSS として扱い、severity を下げない。

#### (b) 宣言の適格性（未許可の 3rd-party / upstream を `same_origin_static` と宣言しない）

`same_origin_static` は「出所が pinned で review 済み」という**主張**である。
その主張が成り立たないコードを、便宜的に `same_origin_static` と宣言して
配信してはならない。次に該当するものは `same_origin_static` にしない。

- pin のない checkout、手置きの成果物、remote fetch、user upload。
- review されていない third-party script を実行するもの。
- 信頼できない HTML / Markdown / SVG をそのまま描画するもの。

該当する場合は `host_disabled`（公開しない）か `external_exception`（sandbox
付き）を選ぶ。

#### (c) pin / source provenance

- submodule の SHA が pin され、`pnpm run tools:provenance:check` が緑。
- pin bump は review される PR の diff であること。

#### (d) build review

- 成果物が pinned checkout から `scripts/build-tools.mjs` で build され、
  手編集されていないこと（`tools:artifact:check` / `sbom:check` が緑）。
- 依存 set と licence が review 済みの記録と一致すること。

#### (e) 共有 origin 権限の検査

有効化の review は、その Tool が host origin で何に到達できるかを列挙して
確認する。

- 読める cookie（HttpOnly か否か）と storage の名前空間。
- 呼び出す同一 origin の API と、その認可。
- 読み書きする host DOM（`window.parent`）。

列挙した結果は review の記録に残す。新しい到達先が増える変更（API 追加、
`window.parent` の利用、cookie 設計の変更）は、その review をやり直す。

#### (f) CSP / Permissions-Policy の実測

- `/tools/<slug>/app/**` の応答 header を実測し、CSP の有無と
  `connect-src` / `frame-ancestors` の状態を記録する。現時点で artifact に
  CSP はない（§3.4 の将来 hardening）ため、「CSP なし」を暗黙にせず記録する。
- manifest の `allow` が iframe の `allow` 属性と応答の `Permissions-Policy`
  の両方に反映されていることを実測する。

#### (g) クリック同意と外部通信の確認

- `delivery.privacy.third_party_origins` の宣言と `click_to_load` の同意が
  実際に機能すること（有効化前は要求 0 件、同意後に宣言 origin のみ）。
- 同意前・同意後それぞれの network log を実測し、宣言外の origin への要求が
  0 件であることを記録する。
- 宣言と実測が食い違う場合は有効化しない（宣言を直すか Tool を直す）。

#### (h) 外部 origin の sandbox 規則を壊さない

(a)–(g) は `same_origin_static` の条件である。`external_exception` の
sandbox token 規則（`allow-scripts` 必須、`allow-same-origin` 禁止、
conditional token は `allow` + `sandbox_rationale` 必須）は**変更しない**。
first-party の決定を理由に external の規則を緩めてはならない。

## 4. 残る契約の詳細

### 4.1 `host_message` は first-party で初めて成立する

`expected_origin: "self"` は host origin に解決される。sandbox がなければ
frame の `event.origin` は `https://rebuildup.dev` になり、`event.source ===
iframe.contentWindow` と `data.type ∈ allowed_types` の 3 条件が初めて同時に
成立する。`src/tools/embed-policy.ts` の「declare できるが runtime では
決して一致しない」という注記は first-party については削除する。

### 4.2 iframe は URL の器であり、境界ではない

`src/routes/tools.$slug.tsx` のコメントから「sandbox で隔離する」という
記述を削除し、「sandbox は付けない。iframe は URL / chrome / CSS の器であり、
security boundary ではない」と明記する。`docs/security/security-headers.md`
§3 も同じ区別に合わせる。

### 4.3 external の `host_message` は引き続き成立しない

`external_exception` は sandbox を残すので opaque origin のままである。
`event.origin === "null"` になり、literal な `https://…` の宣言は一致しない。
この制約は external のためのものとして `docs/tools/embed-policy.md` §5a に
残す。first-party と external で同じ段落に書かない。

### 4.4 同意は trust gate として残る

`embed-privacy.ts` の third-party origin 宣言と `click_to_load` は変更しない。
ただし意味が変わる。以前は「opaque origin の frame がどの origin と通信するか」
の開示だった。今後は「host origin の権限を持つ文書が、どの origin と通信するか」
の開示であり、同意は**信頼の gate** でもある。文言の変更は product / copy の
決定であり、本 ADR では行わない（必要なら別 Issue + `copy:approval:check`）。

### 4.5 `mic-level` は `same_origin_static` へ移し、マイク取得を維持する

`mic-level` は `getUserMedia` によるマイク取得を**維持**する。本 ADR は
「sandbox を外す」決定であり、機能を落とす決定ではない。`host_disabled` に
据え置くことは、owner の要件「全 Tool を利用可能にする」（§1.1.1）への
未達として扱う（§2.6）。したがって `mic-level` は **§3.6 の release 前条件を
満たしたうえで `same_origin_static` へ移す**。卒業先の kind はここで決める。

前提条件は 4 つ。**4 つのうち 3 つは host 側で既に満たされている**（測定値と
その出所を併記する）。

1. **https（secure context）**: `getUserMedia` は secure context を要求する。
   本番 origin は `https://rebuildup.dev`（ADR-0014）であり、満たされている。
2. **Permissions-Policy（容器側）**: `src/tools/registry.ts` の
   `toolRouteSecurityPolicy()` が manifest の `delivery.iframe.allow`
   （`mic-level` は `"microphone"`）を読み、
   `src/http/security-headers.ts` が
   `Permissions-Policy: microphone=(self "https://rebuildup.dev")` を
   `/tools/mic-level` の応答に付ける。**既に実装済み**（manifest の
   `delivery.iframe.allow` と `public/_headers` の
   `/tools/mic-level/app/*` 規則の**両方**が一致している —
   `scripts/check-security-headers.mjs` がこの一致を gate している）。
3. **明示同意**: マイク取得は**無言で起きない**。pinned `5df7ac6` の
   `src/MicLevelClient.tsx:416`（ボタン「マイクを使用する」）→ `:364`
   （`handleRequestPermission`）がユーザー操作を起点にする。host 側は
   この明示同意を**妨げない**（同意 band で置き換えない）。
4. **権限拒否時の非破壊 fallback**: `NotAllowedError` / `SecurityError` /
   `NotFoundError` / `OverconstrainedError` で**状態を破壊しない**。pinned
   `5df7ac6` の `src/MicLevelClient.tsx:287` 以降は `permission` を
   `denied` / `unsupported` に遷移させ、メッセージを出して **`stream` を
   止める**。sandbox を外してもこの fallback は壊れない（この Tool は
   storage を使わない）。

`host_disabled` のまま残す期間に付ける **休眠宣言**（§2.3）：
`iframe` から `sandbox` を外し、`allow: "microphone"` と `referrer_policy`
は残す。これは有効化ではない。

#### 4.5.1 卒業に要る host 側の変更（#825 の後に 1 本）

- `src/tools/manifest.json`: `delivery.kind` を `same_origin_static` にし、
  `artifact_path: "/tools/mic-level/app"` と `entry_html` を追加する。
  `iframe` は `referrer_policy` と `allow: "microphone"` を持ち、**`sandbox`
  は持たない**（§2.1 / §2.3）。
- submodule の追加と `source.pinned_sha` の bump（upstream の merge SHA）。
- `quality/tool-artifact-inventory.json` の再生成（現状 license / dependencies
  は `unverified` なので、build 後に measured 値へ更新する）。
- `public/_headers` の `/tools/mic-level/app/*` 規則は**そのまま使う**
  （manifest 側の `allow` を消すと `check-security-headers.mjs` が落ちる）。

#### 4.5.2 検証可能な卒業条件（e2e）

`mic-level` が「利用可能」と宣言されるのは、次の**すべて**を**実測**した
ときだけである。証跡は `docs/verification/tools/` に置く。

| # | 条件 | 測定方法 | 期待値 |
| --- | --- | --- | --- |
| 1 | 許可経路 | Playwright で microphone 権限を許可して `/tools/mic-level` を開く | `getUserMedia` が解決し、Tool が「許可済み」状態を表示する。レベル表示が更新される |
| 2 | 拒否経路 | microphone 権限を**明示的に拒否**して同じ URL を開く | `NotAllowedError` で失敗し、Tool が**破壊せず**拒否状態を表示する。未処理例外が無い |
| 3 | Permissions-Policy（容器側） | `GET /tools/mic-level` の応答ヘッダを実測 | `Permissions-Policy` に `microphone=(self "https://rebuildup.dev")` が含まれる |
| 4 | Permissions-Policy（文書側） | `GET /tools/mic-level/app/index.html` の応答ヘッダを実測 | 同上（`public/_headers` の `/tools/mic-level/app/*` 規則が応答している） |
| 5 | 許可属性 | `/tools/mic-level` の HTML を実測 | `<iframe allow="microphone">` が出る（manifest の `delivery.iframe.allow` と一致） |
| 6 | sandbox 不在 | 同 iframe の属性を実測 | `sandbox` 属性が無い（§2.1） |
| 7 | frame origin | frame 内の `window.origin` を実測 | host origin（`https://rebuildup.dev`）と一致する（§4.1 / §4.2） |

1 と 2 は **許可 / 拒否の両方**を測る。片方だけの測定は「利用可能」の根拠に
ならない。3 と 4 は**応答ヘッダの実測**であり、manifest の宣言だけでは
満たせない。5・6・7 は配信された HTML と frame の**実測値**であり、
「宣言している」だけでは足りない。

旧選択肢 B（storage を使わない設計に寄せる、`getUserMedia` 前提を崩す）は
**却下**する。§6.2 と同じ理由であり、原因は sandbox であって設計ではない。

## 5. 移行（Issue #825）

### 5.1 手順

1. `src/tools/manifest.json`: `prototype` / `readmark` /
   `mic-level` の `delivery.iframe.sandbox` を削除する（`mic-level` は
   `host_disabled` の前方宣言であり、`disabled_reason` が
   `same_origin_static` への卒業を明記している）。`referrer_policy` と
   `allow` は残す。live な `external_exception` は 0 件で、manifest から
   `sandbox` キーが 0 になる。
2. `src/tools/manifest.schema.json`: `same_origin_static` の `iframe` から
   `sandbox` / `sandbox_rationale` を削除し、`required` を
   `["referrer_policy"]` にする。`external_exception` の branch は不変。
3. `src/tools/embed-policy.ts`: `same_origin_static` + `sandbox` を拒否する
   1 code を追加する。external の token 規則は残す。`host_message` の
   opaque-origin 注記を first-party / external に分ける。
4. `src/tools/registry.ts`: summary の `sandbox` を optional にし、
   `toSummary()` の既定値から `sandbox: ''` を外す。
5. `src/routes/tools.$slug.tsx`: `sandbox` を optional にし、属性を
   `undefined` のとき出力しない。コメントと blocked 文言を更新する。
6. テスト: `embed-policy.test.ts` の sandbox token suite を external 用に
   残しつつ、first-party の「sandbox 禁止」test を追加する。
   `registry.test.ts`、`lazy-media-contract.test.ts`、`e2e/tools-prototype.spec.ts`、
   `scripts/check-tools-manifest.test.mjs`、fixture 生成 script を追随させる。
7. docs: `docs/tools/embed-policy.md` §1–§2 / §5a、`docs/tools/runbook.md`、
   `docs/tools/inventory.md`、`docs/security/security-headers.md` §3、
   ADR-0006 の Re-evaluation triggers に本 ADR への参照を追記する。
8. 検証: `pnpm run validate:fast`（`.tmp/supervisor/bin/vfast` 経由）、
   `pnpm run validate:integration`、production 相当の browser 実測。
   有効化を伴う release では §3.6 の (a)–(h) の証跡を
   `docs/verification/tools/` に残す。実装 spec は
   `docs/tools/tool-first-party-delivery-implementation-spec.md`。

### 5.2 受け入れ測定

実装 worker は次を**測定値で**報告する。

1. `/tools/readmark` の frame に `sandbox` 属性が**ない**。
2. frame の `window.origin` が host origin（`https://rebuildup.dev`）と一致する。
3. frame 内の `indexedDB.open()` と `localStorage.setItem()` が成功する
   （`SecurityError` でない）。
4. `/tools/readmark` が pinned 906c90e の空 library 文言
   「ライブラリは空です。上のボタンから文書を追加してください。」に到達する。
   **import は pinned build では無効のまま**であり、この ticket は import を
   有効にしない（§7）。
5. `/tools/prototype` は activation 前に consent notice を出し、third-party
   origin への要求が 0 件である。activation 後は frame が sandbox なしで
   描画され、要求先は宣言された 4 origin に一致する。
6. manifest の `same_origin_static` に `sandbox` を足すと
   `pnpm run tools:check` が非 0 で失敗する（negative control）。
7. `pnpm run validate:fast` と `validate:integration` が緑。
8. 画面証跡: `/tools/readmark` の 1440 / 390 を WebP で
   `docs/verification/tools/` に置く。
9. §3.6 の (a)–(h) のうち、本 ticket で該当する項目の実測 evidence を
   `docs/verification/tools/tool-first-party-delivery.md` に記録する。
   `mic-level` の**卒業自体**（`host_disabled` → `same_origin_static`）は本
   ticket の受け入れに含めない — 卒業は §4.5.2 の 7 条件を実測してから
   別 ticket（Issue #360 / #769）で行う。

### 5.3 Rollback

data migration はない。manifest / policy / route の revert で sandbox が戻る。
実装後に作られた Tool の storage は host origin の名前空間に残るが、
sandbox を戻すと読めなくなる（opaque origin になるため）。rollback 時に
その旨を release note に書く。

## 6. Rejected alternatives

### 6.1 `allow-same-origin` を付ける

不採用。§1.5 のとおり、隔離はゼロなのに属性は残り、review が誤読する。
既存 policy が明示的に禁止している規則を、より悪い形で復活させることになる。

### 6.2 storage を使わない UX に作り直す（Issue #786 の設計）

不採用（**撤回**）。storage が使えない原因は sandbox であり、sandbox を外せば
原因は消える。Tool の主要機能（library、読書位置の復元）を捨てる必要はない。
`786-fallback-wip` と #786 に投稿した storage-free 設計は実装しない。
同じ理由で、Issue #598 の文脈における旧選択肢 B（storage / 機能前提を崩して
sandbox に合わせる設計）も却下する（§4.5）。
pinned 906c90e が足場であること（import 無効）は別の問題であり、upstream の
pin bump として別 ticket で扱う。

### 6.3 別 origin（`tools.rebuildup.dev`）で配信する

不採用（現時点）。これが唯一「隔離を保ったまま storage も動かす」案である。
Tool は自身の origin を持つので、host の cookie / storage には触れず、
Tool 自身の storage は使える。しかし次の決定が要る。

- 新しい hostname / zone / TLS / Worker route（Cloudflare の設定変更）。
- cookie を共有しない設計（host と tool で別 session）。
- `postMessage` による host↔tool 通信、`frame-ancestors` の再設計。
- 既存の `/tools/<slug>/app/` の配信 path と、release の build 経路の変更。

owner の決定は「sandbox に収める必要がない」であり、新しい origin の運用を
求めてはいない。first-party 前提が崩れたとき（§3.5）に再検討する。

### 6.4 direct 配信（iframe を外す）

不採用（この ticket）。§2.2 のとおり、pinned readmark の root-based router が
トップレベル URL を書き換える。relocatable base と chrome の扱いを決める
別の product 決定が必要である。

### 6.5 COOP / COEP を足す

不採用。`SharedArrayBuffer` を使わないので不要であり、storage の問題とも
無関係である。`crossOriginIsolated` は要求しない。

## 7. Consequences

- readmark は storage を使えるようになり、pinned build の空 library まで到達する。
  import は pinned build では無効のままで、upstream main への pin bump は
  別 ticket（#786 の残作業）。
- ProtoType の `safeStorage` は「storage が使えれば使う」実装なので、挙動が
  「毎回 no-op」から「localStorage に保存する」に変わる。host は third-party
  origin を宣言していないので、保存は端末内に閉じる。この変化は release note に
  書く。
- Tool が host の DOM を読めるようになるため、`/tools/<slug>` の host chrome に
  表示される情報（visitor の状態など）は Tool から見える。現時点で機微な
  表示はないが、今後 `/tools/**` に secret を描画しない、という制約が生まれる。
- `mic-level` は §4.5 の条件を満たしたうえで `same_origin_static` へ移す。
  卒業時に変わるのは **container 側と document 側の Permissions-Policy の
  実測値**（`microphone=(self "https://rebuildup.dev")`）と frame の
  `sandbox` 不在であり、**Tool 側の明示同意と拒否時 fallback はそのまま
  使う**（pinned `5df7ac6` に既に実装済み）。旧 Issue #598 の問い
  （`allow-same-origin` を付けるべきか）は、本 ADR の採用により**前提ごと
  解消する**（§6.1 / §6.2）。
- `host_message` の最初の consumer を作るとき、first-party なら origin は
  host origin でよい。external なら opaque origin の別契約が必要。

## 8. Re-evaluation triggers

- Tool の成果物が pinned / reviewed でなくなった（§3.5）。
- Tool を untrusted として扱う必要が生じた（user content、third-party script、
  remote config）。
- `/tools/<slug>` を SEO index する、top-level navigation を持たせるなど、
  direct 配信が product 要件になった。
- `tools.rebuildup.dev` のような別 origin を運用する決定が出た。
- Tool 由来の security incident が発生した。
- artifact に CSP（`connect-src` allowlist）を入れる設計が決まった。

## 9. References

- `src/tools/embed-policy.ts` / `src/tools/embed-privacy.ts` /
  `src/tools/registry.ts` / `src/tools/manifest.json` /
  `src/tools/manifest.schema.json`
- `src/routes/tools.$slug.tsx`、`public/_headers`、`src/server.ts`
- `docs/tools/embed-policy.md`、`docs/tools/embed-privacy.md`、
  `docs/tools/runbook.md`、`docs/security/security-headers.md`
- 実装 spec: `docs/tools/tool-first-party-delivery-implementation-spec.md`
- ADR-0006（Tool submodule policy、Re-evaluation triggers）
- Issue #465（embed policy）、#498（third-party consent）、
  #598（`mic-level` の `allow-same-origin` 論点 — 本 ADR の採用で解消）、
  #769（判定・15 Tool の終了条件と実行順）、
  #786（readmark storage）、#825（本 ADR の実装）
- 15 Tool の終了条件・実行順・担当:
  [`../verification/tools/completion-inventory.md`](../verification/tools/completion-inventory.md)
- production 実測: `.tmp/issue-825/probe.mjs`（2026-11-02）
