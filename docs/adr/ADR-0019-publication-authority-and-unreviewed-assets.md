# ADR-0019 — 公開権限は owner にあり、権利レビューは公開の前提ではない

- Status: **Accepted（政策）** — owner 決定 2026-11-02。実装は未着手で、この
  ADR の着地後に独立した Issue で行う
- Date: 2026-11-02
- Ticket: Issue #811（本 ADR / 台帳側の準備） / Issue #767（旧サイト移行の親）
- Target release: `release-0-8-1`（0.8.1 の範囲は **ADR と台帳の準備のみ**。
  コード・データ・公開面は変えない）
- Companion: [ADR-0018](ADR-0018-notion-as-portfolio-cms-source-of-truth.md)
  （取り込み境界）/ [`docs/verification/legal/asset-license-review.md`](../verification/legal/asset-license-review.md)
  （現行の fail-closed の実測記録）

> **決定の出所。** この ADR の政策部分は repository owner の 2026-11-02 の
> 発言による。agent が本 ADR を書いたこと・本行を編集したことは承認の証拠では
> ない（AGENTS.md §6 / `docs/runbook/issue-lifecycle.md`）。owner の発言は
> 逐語で引用し、そこから導いた**設計判断**（語彙の分割、gate の verdict、
> 要約の検証方法）は agent の仕事であり、owner 決定として提示しない。

owner の発言（Issue #811 body より逐語）:

> 旧サイトは全て移行する必要がある。権利がなんだとかは無駄

> 選別はいらない。全て公開する。

> slug 衝突は勝手に作った分でしょ？ 旧サイトのデータに合わせる

> 要約はしていいが、加筆してはならない。内容が嘘ばかりになる

## 1. Context

### 1.1 いまの規則と、それが前提にしていること

`src/legal/**`（Issue #497）は「権利が記録されていないバイトは、レビュー済み
としては公開できない」という規則を持つ。規則そのものではなく、その**前提**が
問題である。前提は「evidence が無い ⇒ 公開してはいけない」であり、これは
「公開の可否は evidence が決める」と言っているのと同じである。

規則が実装されている場所は 3 つある。

| 場所 | いまの振る舞い |
| --- | --- |
| `src/legal/contract.ts#evaluateAssetLicense` | `verification.method === 'none'` で `hold`（L017）。`hold` は他のすべての判定に優先する |
| `src/portfolio/notion/publish.ts#publishedMedia` | `rights === 'recorded'` 以外の media を**落とす**（URL も `<img>` も作らない） |
| `scripts/check-asset-licenses.mjs` | `hold` の記録が `publication: 'published'` を宣言していると **L010** を出す |

### 1.2 数字

`docs/migration/portfolio-2025-inventory.json`（2026-11-01 の実行記録）:

| 事実 | 値 |
| --- | --- |
| 旧サイトの項目 | 151 |
| 旧サイトの asset | 44 |
| `rights.recorded` | **0** |
| `rights.unrecorded` | 151 |

`src/legal` の判定は資産単位なので、いまの規則のままでは 151 件を全件移行
しても**公開される media は 0 件**になる。owner の「全て公開する」は、この
帰結を受け入れないという決定である。

### 1.3 何が問題なのか（規則の欠陥ではなく前提の欠陥）

`src/legal` は「未レビュー」と「公開しない」を**同じ状態**として扱う。その
ため、未レビューの資産が公開されると、システムはそれを「公開してはいけない
ものが公開されている」としか表現できない。所有者が公開を決めた世界では、
この 2 つは別の事実であり、同じ語で表してはいけない。

## 2. Decision

### 2.1 公開権限は owner に帰属する

バイトを公開するかどうかを決めるのは repository owner であり、リポジトリの
権利記録ではない。rights review は**公開の前提条件ではない**。

これは「gate を外す」ではない。gate の**問い**が変わる。

| | いまの問い | これからの問い |
| --- | --- | --- |
| gate | 「この資産は公開してよいか」 | 「この資産について、リポジトリは**何を知っていて、何を知らないか**を正しく言えているか」 |
| 公開 | 判定の結果 | owner の決定（入力） |
| 未レビュー | 公開不可 | **公開される。そして未レビューであると表示される** |

### 2.2 判定を 2 つの軸に分ける

1 つの enum に「公開してよいか」と「何を知っているか」を詰めると、未レビュー
と保留が同じ語になる。分ける。

**軸 A — `evidenceStatus`: リポジトリが権利について何を知っているか。**

| 値 | 意味 |
| --- | --- |
| `reviewed` | 根拠がリポジトリにあり、gate が存在と digest を確認した。**これは「許諾された」ではない** |
| `unreviewed` | 根拠が無い、または検証していない。`verification.method: none` の正直な表現 |
| `provider-terms` | コピーを配布しておらず、条件は提供側にある（現行と同じ） |
| `inconsistent` | 記録が**リポジトリ自身の事実と矛盾する**（§2.3） |

**軸 B — `publication`: 公開されているか。** これは owner が決めた入力であり、
gate が計算する値ではない（現行 `publication` フィールドの意味をそのまま使う）。

公開面に課す規則は 1 つだけである。

> **`evidenceStatus` が `reviewed` でない資産は、公開されるときにその状態を
> 表示する。** 黙って「cleared」として公開することはできない。

現行語彙との対応:

| 現行 `decision` | 新 `evidenceStatus` | 備考 |
| --- | --- | --- |
| `publishable` | `reviewed` | 語を言い換える。「公開可」という許可の語を捨てる |
| `hold`（L017 由来） | `unreviewed` | **これが今回変わる点**。公開を止めない |
| `hold`（L004/L005/L003/L007 由来） | `inconsistent` | §2.3。error のまま |
| `provider-terms` | `provider-terms` | 変更なし |

`hold` という語は**廃止する**。公開を止める語として使うと、owner の決定と
衝突したときにどちらが勝つのかを型で決められない。公開の有無は軸 B が持つ。

### 2.3 fail-closed のまま残るもの（記録の整合性）

未レビューは公開を止めない。しかし**記録が嘘をつくこと**は止め続ける。これらは
「レビューしていない」ではなく「リポジトリが自分のファイルについて誤ったこと
を言っている」であり、公開権限の話ではない。

| code | 何を検出するか | 変更 |
| --- | --- | --- |
| L003 | 既知でない SPDX 識別子 | error のまま |
| L004 | 根拠として宣言したファイルが存在しない | error のまま |
| L005 | 根拠ファイルの digest が記録と一致しない | error のまま |
| L006 | 第三者資産に根拠が 1 件も無い | **`inconsistent` から `unreviewed` に移す**（根拠が無いことは嘘ではない） |
| L007 | 表示義務があるのに表示文言が無い | error のまま |
| L010 | 保留の記録が公開中と宣言している | `hold` の語は消える。**`inconsistent` の記録が公開中と宣言している場合**に残す（矛盾は矛盾のまま） |
| L016 | 提供者 URL が https でない / 資格情報を含む | error のまま |
| L017 | 検証方法が `none` | error ではなく **`unreviewed` の理由**になる |
| L018 | 第三者を同梱しているのにライセンス未記録 | **`unreviewed` に移す** |

**gate の verdict は「未レビューでは落ちない」** になる。`validate:fast` は
未レビューの資産が増えても緑のままで、表示義務（§2.2）が果たされていない
ときにだけ赤くなる。これを **fail-visible** と呼ぶ。fail-open（何も言わない）
とは違う。

### 2.4 記録を捏造しない

`quality/asset-license-inventory.json` に `verification.method:
'repository-evidence'` を書いて L017 を消すことは**しない**。それは規則の
前提を変えるのではなく、記録を嘘にする。変えるのは**規則が何を問うか**で
あって、データではない。

未レビューの資産は、未レビューのまま公開される。

### 2.5 公開面が負う義務

未レビューの資産を公開する以上、公開面はその事実を隠せない。最低限、次を
満たす（実装は別 Issue）:

1. 資産を表示する場所から、その資産の `evidenceStatus` に到達できる。
2. 「レビュー済み」と読める表示を、`reviewed` 以外の資産に出さない。
3. `inconsistent` の資産は、公開されていても未解決の不整合として一覧できる。

この 3 点が果たされているかを検査するのが、`§2.3` の fail-visible な gate で
ある。

### 2.6 slug は旧サイトを正とする

owner:「slug 衝突は勝手に作った分でしょ？ 旧サイトのデータに合わせる」

台帳の未決事項が示していた 2 択（`docs/migration/portfolio-2025-inventory.json#open_decisions`）
に対して、**(b) D1 の行を移行レコードに譲る**を採る。ただし台帳が書いていた
「text と media を先に移す」は不要である — 移行レコードこそが旧サイトのデータ
であり、**辻褄を合わせるべきは D1 の 3 行のほう**だからである。

| slug | いまの状態 | 決定 |
| --- | --- | --- |
| `aulymo-v01` / `aulymo-v02` / `multislicer` | D1 の行が勝ち、移行レコードが隠れる | 旧サイト slug を正とし、D1 の 3 行を移行時に退役させる |

`src/portfolio/load.ts` の衝突規則（D1 が勝つ）は**変えない**。変わるのは
どちらが D1 に居るかである。移行の実行は本 ADR の範囲外（§4）。

### 2.7 本文は要約のみ可、加筆は禁止

owner:「要約はしていいが、加筆してはならない。内容が嘘ばかりになる」

要約の許される操作を次に固定し、**機械的に検査できる形**にする。

| 操作 | 可 |
| --- | --- |
| 文・節の削除 | 可 |
| 文の順序変更 | 可（意味が変わらない範囲で） |
| 同じ文の連接による圧縮 | 可 |
| 語の置換・補足・言い換え・新しい文の生成 | **不可** |

検査（移行ツールの gate）:

1. 原文を句点・改行で**節**に分割する。
2. 要約の各文を、原文の連続した節の連接（空白・句読点の差のみ許容）と
   照合する。
3. 照合できない文が 1 つでもあれば **error**。どの文かを operator の出力に
   出す（公開面には出さない）。
4. 加えて、要約に現れる数値・年月・固有名詞が原文に現れることを確認する。

単語レベルの部分列一致では、語を並べ替えた無意味な文が通ってしまう。**節**
を単位にするのはそのためである。

## 3. なぜこの形なのか

| 案 | 判定 | 理由 |
| --- | --- | --- |
| **2 軸（採用）** | 採用 | 「何を知っているか」と「公開するか」は別の事実であり、別の主体が決める |
| 単一 enum に `published-unreviewed` を足す | 却下 | `hold` が「公開しない」と「知らない」の両方を背負ったまま残り、owner の決定と衝突したときにどちらが勝つかを型で表せない |
| gate を丸ごと外す | 却下 | 未レビューであることがどこにも残らない。これは fail-open であり、「嘘ばかりになる」を別の形で再生産する |
| 記録を捏造して gate を通す | 却下 | §2.4。規則の前提ではなくデータを変えることになる |
| 未レビューのまま fail-closed を維持し、移行しない | 却下 | owner の決定（全件移行）を実行できない |

## 4. Scope — 0.8.1 でやること / やらないこと

owner:「とりあえず現在の作業から広げないままをスコープとしておく。まだマージしない。」

**やること（本 Issue / 0.8.1）**

- 本 ADR。
- 台帳側の準備: `scripts/audit-legacy-portfolio.mjs` の `OPEN_DECISIONS` を
  「未決」から「決定済み + 決定の出所」に組み替え、対応する test を更新する。
  生成済みの `docs/migration/portfolio-2025-inventory.json` は **2026-11-01 の
  実行記録**として書き換えない（再生成は移行実行時）。

**やらないこと（別 Issue、ADR の着地後）**

- `src/legal/**` の語彙変更（`hold` の廃止、`evidenceStatus` の導入）。
- `src/portfolio/notion/publish.ts#publishedMedia` の filter 撤去。
- `scripts/check-asset-licenses.mjs` の verdict 変更。
- 公開面の未レビュー表示（§2.5）。
- 151 件の移行の実行、D1 3 行の退役、要約の生成。
- `quality/asset-license-inventory.json` の変更（**記録は触らない**）。
- `AGENTS.md` §3 の legal 段落の改訂。同段落は「権利未記録の資産は、レビュー
  済みとして自分を提示できない」と書いており、これは §2.2 と両立する。しかし
  「公開しない」まで含意して読める箇所があるため、コードを変える Ticket が
  同じ commit で §3 を改訂する。**この ADR だけでは §3 を変えない。**

## 5. Consequences

### 5.1 良くなること

- owner の決定（全件公開）が、規則と衝突せずに実行できる。
- 「未レビュー」が、公開を止める理由ではなく**表示される事実**になる。
- 記録の不整合（存在しない根拠、digest 不一致）は引き続き error であり、
  規則を緩めたことにはならない。

### 5.2 コスト / 危険

- **未レビューのバイトが実際に公開される。** 第三者バイトの再配布条件を
  確認しないまま公開することを、owner が明示的に選んだ。この ADR はそれを
  正当化しない。記録しているだけである。
- 公開面の表示（§2.5）が実装されるまで、未レビューであることは**読者には
  見えない**。したがって `src/legal/**` と `publish.ts` の変更は、表示の
  実装と同じ PR で行う必要がある。これが「コード変更は ADR の後」の意味である。
- `hold` の廃止は `src/legal/**` の公開語彙（`DECISION_LABEL` など）に触る。
  既存の test（`contract.test.ts`）も同時に書き換える。
- slug の決定は公開 URL を 3 件動かす。移行時に 301 を置くかは別途決める。

## 6. Open questions（この ADR は決めない）

1. **未レビュー表示の形** — 資産ごとの注記か、ページ単位の一覧か、両方か。
   §2.5 の 3 点を満たす最小の形を、表示の実装 Issue で決める。
2. **`reviewed` の意味の再定義** — 現行の「公開可」から「根拠を確認した」へ
   言い換える際、既存の 44 資産のうち `reviewed` になるのはどれか。
3. **slug 301 の要否** — 旧 URL からの流入があるかどうかは owner の判断。
4. **要約の生成主体** — 誰が（または何が）要約を作るか。§2.7 は検証方法だけを
   決めており、生成方法は決めていない。
5. **`quality/asset-license-inventory.json` の将来** — 未レビューのまま公開する
   資産について、記録を増やすのか、`unknown-provenance` のまま置くのか。

## 7. References

- Issue #811 — 本 ADR の ticket（owner 決定の原文）
- Issue #767 — 旧サイト移行の親
- [`src/legal/contract.ts`](../../src/legal/contract.ts) — 現行の判定
- [`src/portfolio/notion/publish.ts`](../../src/portfolio/notion/publish.ts) — media の filter
- [`scripts/check-asset-licenses.mjs`](../../scripts/check-asset-licenses.mjs) — offline gate
- [`scripts/audit-legacy-portfolio.mjs`](../../scripts/audit-legacy-portfolio.mjs) — 台帳の `OPEN_DECISIONS`
- [`docs/verification/legal/asset-license-review.md`](../verification/legal/asset-license-review.md) — 現行規則の実測
- [ADR-0018](ADR-0018-notion-as-portfolio-cms-source-of-truth.md) §2.6 — 権利未記録の資産を公開しない、という現行記述（本 ADR が置き換える）
