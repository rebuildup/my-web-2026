# 旧サイト移行の決定記録（Issue #811 / #766）

- 状態: **決定済み（owner 発言）**
- 決定日: 2026-11-02
- owner 確認: **confirmed**（owner 本人の発言。Issue #811 本文の原文を逐語で引用する）
- 関係: [ADR-0019](../../docs/adr/ADR-0019-publication-authority-and-unreviewed-assets.md)（公開権限の根拠）
  / [`docs/migration/portfolio-2025-to-2026-publication.json`](../migration/portfolio-2025-to-2026-publication.json)（151 行の台帳）
  / [`docs/runbook/portfolio-publication.md`](../runbook/portfolio-publication.md)（本番手順）

> **この記録の証拠について。** 引用は Issue #811 の owner 本人の発言をそのまま
> 写したもので、agent が書いた文言ではない（AGENTS.md §6 /
> `docs/runbook/issue-lifecycle.md`）。一方、**この記録の構成・文言・Measured
> 値の解釈は agent の仕事**であり、owner の決定として提示しない。owner が
> 自分の発言と違えば、owner の発言が優先する。

## 1. owner の発言（原文）

Issue #811 本文（2026-11-02）:

> 旧サイトは全て移行する必要がある。権利がなんだとかは無駄
>
> 選別はいらない。全て公開する。
>
> slug 衝突は勝手に作った分でしょ？ 旧サイトのデータに合わせる
>
> 要約はしていいが、加筆してはならない。内容が嘘ばかりになる

ADR-0019 §「決定の出所」が同じ発言を逐語で引用している。両者は独立に
発話ではなく、**Issue #811 の本文が一次の出典**である。

## 2. 決定（5 項目）

| # | 決定 | 意味 | 実装が属する場所 |
| --- | --- | --- | --- |
| D1 | **全件公開** | 151 件のうち「作品であるもの」を選別せず公開する | `scripts/migrate-portfolio-from-2025.mjs`（`visibility='public'`） |
| D2 | **権利レビューは公開の前提にしない** | 権利記録が無いことを公開の拒否理由にしない。ただし未レビューであることは公開面に表示し続ける | `src/legal/contract.ts` / `quality/asset-license-publication-decision.json` / `src/portfolio/components/PortfolioEvidenceNotice.tsx` |
| D3 | **slug は旧サイトを正とする** | 移行前に D1 が持っていた slug 衝突行は、移行レコード（= 旧サイトのデータ）へ譲る。衝突行は削除せず retired にする | `scripts/migrate-portfolio-from-2025.mjs`（collision retirement） |
| D4 | **本文は要約のみ可、加筆禁止** | 元の主張を超えてはならない。追加した文・数値・主張は不可 | `scripts/check-portfolio-summary.mjs` |
| D5 | **作品でない行は公開しない（91 件）** | 「選別」ではなく「その行が作品でない」という機械判定。根拠は台帳に 1 行ずつ残す | `docs/migration/portfolio-2025-to-2026-publication.json` |

### D1 — 全件公開

- 旧サイトの 151 件のうち、作品として実体のあるものは **60 件**
  （`eligible` 48 + `rewrite_required` 12）。この 60 件を**すべて**
  `visibility='public'` で公開する。
- 選別の意味では「選別していない」。migration script は
  `publication` 列（`approved` / `pending_owner` / `rejected`）を依然として
  読むが、`pending_owner` は「公開を待つ」ではなく「公開する」を意味する
  ようになった（owner 決定 2026-11-02）。`rejected` は依然として挿入しない。
- 決定前の挙動（`draft` に落とす）は `--visibility=draft` で再現できる。

### D2 — 権利レビューは公開の前提にしない（fail-visible）

- `src/legal/**` の「記録が無い = 公開不可」を、**2 軸**に組み替える
  （ADR-0019 §2.2）。
  - 軸 A `evidenceStatus`: `reviewed` / `unreviewed` / `provider-terms` /
    `inconsistent`（リポジトリが**何を知っているか**）。
  - 軸 B `publication`: 公開されているか（**owner が決める**）。
- `hold` という語は廃止した。「知らない」と「公開するな」を同じ言葉に
  同一个 enum に两个不同的主题を押し込んでいたから。
- owner 決定の有無は**リポジトリ内の記録**で判定する
  （`quality/asset-license-publication-decision.json`）。環境変数でも
  コマンドラインフラグでもない。実行時に付け替えられるスイッチは
  決定ではなくスイッチである。
- **gate は fail-visible**（fail-open ではない）:
  - 未レビューであること自体は **赤にしない**（owner が公開を決めた）。
  - その状態が**公開面に表示されていない**ことは **赤**（`L022`）。決定記録が
    (display 場所, marker) を持ち、gate がそのファイルの marker を実読する。
- 権利記録は捏造しない。`quality/asset-license-inventory.json` の
  `verification.method` を書き換えることも、owner 承認を書き足すことも
  しない。`verification.method: 'none'` のまま「未レビュー」として扱う。

### D3 — slug は旧サイトを正とする

- 旧サイトの slug を正とし、移行前に D1 が持っていた同 slug の行は
  **retire** する（`status='archived'`, `visibility='draft'`、slug は
  `<slug>-retired` へ退避）。削除はしない。URL が答えていた事実は台帳に
  残る。
- 同じ `id` の行は、移行レコードが**同じ行を上書き**する（=row の同一性）。
- `src/portfolio/load.ts` の衝突規則（D1 優先）は変えない。変わるのは
  どちらが D1 に居るかだけである。

### D4 — 本文は要約のみ可、加筆禁止

- 検査単位は**節**（行、または `。`/`！`/`？` で終わる文）。単語レベルの
  部分列では、語を並べ替えた無意味な文が通ってしまう（ADR-0019 §2.7）。
- 移行後の各節が「元の一節」または「元の連続した節の連接」または「元の
  順序を保つ部分列」であれば要約として受理する。いずれも「元の語を元の
  順に並べたもの」でしかありえない。
- 数値・年月も照合する。元の本文に無い数値は **error**。
- 判定できないものは warning として**件数を出す**（黙って通さない）。
- 意味的同一性は判定しない。判定できないものとして数える。

### D5 — 作品でない行（91 件）

「選別」ではなく、**その行が作品でない**ことの機械判定である。根拠は
`scripts/classify-portfolio-from-2025.mjs` の規則そのままで、判定の
**出所と内訳を台帳に 1 行ずつ残す**。

| 内訳 | 件数 | 判定の根拠（機械的） |
| --- | --- | --- |
| メディア足場行 | 80 | legacy id が `media-list-*` / `media-rt-*` で始まる（`isMediaScaffold`） |
| テスト用フィクスチャ | 9 | legacy id が `test-*` で始まる |
| プレースホルダ | 2 | `draft` かつリンク 0 件・本文 0 件 |
| **合計 not-a-work** | **91** | |
| **公開（作品）** | **60** | `eligible` 48 + `rewrite_required` 12 |

> **訂正（监督者メモとの差分）。**  Issue #811 の監督メモは「91 件は
> `media-list-*` の足場行」と書いていたが、実測は **足場行 80 件**で、
> 残り 11 件は `test-*` 9 件とプレースホルダ 2 件である。合計 91 件という
> 数は変わらないが、**内訳は実測値を採った**。台帳は内訳を区別して
> 記録する。

## 3. この Issue が「公開」するものの境界

| 対象 | 扱い |
| --- | --- |
| 旧サイト 151 件の作品 60 件 | **公開する**（D1） |
| 旧サイト 151 件の作品でない 91 件 | 公開しない（D5。台帳に理由つきで記録） |
| 移行後に追加する候補 8 件（`new_candidate`） | **本 Issue の対象外**。旧サイト 151 件に含まれない。自動挿入しない |
| Notion | **触らない**。ADR-0018 / Issue #814 の単発書き込みは本 Issue の範囲外 |
| production D1 / R2 | **本 Issue では書き込まない**。手順は runbook に書く |

## 4. 実測（local）

`docs/verification/portfolio/portfolio-publication.md` に記録した。

## 5. 関連

- Issue #811（本 Issue）/ #766（旧サイト移行の親）/ #850（旧メディア移行）
- [ADR-0019](../../docs/adr/ADR-0019-publication-authority-and-unreviewed-assets.md)
- [ADR-0018](../../docs/adr/ADR-0018-notion-as-portfolio-cms-source-of-truth.md)
- [`src/legal/contract.ts`](../../src/legal/contract.ts) / [`src/legal/inventory.ts`](../../src/legal/inventory.ts)
- [`scripts/check-asset-licenses.mjs`](../../scripts/check-asset-licenses.mjs) /
  [`scripts/check-portfolio-summary.mjs`](../../scripts/check-portfolio-summary.mjs)
