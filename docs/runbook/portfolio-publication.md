# 本番公開手順 — 旧サイト移植作品 60 件（Issue #811）

> **この runbook が扱うのは production への公開だけである。** 移行そのもの
> （D1 行の生成・メディアの R2 投入）は local で検証済みであり、その記録は
> [`docs/verification/portfolio/portfolio-publication.md`](../verification/portfolio/portfolio-publication.md)
> にある。決定の根拠は
> [`docs/domain/portfolio-migration-decisions.md`](../domain/portfolio-migration-decisions.md)。

## 0. この手順がChangingする対象

| 対象 | 変更 |
| --- | --- |
| production D1 `portfolio_project` | 60 行を追加（`visibility='public'`、`evidence_status='unreviewed'`）。slug が衝突する既存行があれば retire（削除しない） |
| production D1 `portfolio_link` | 103 行を追加（移行対象のリンクのみ） |
| production D1 `portfolio_media` | 130 行を追加（PR #852 / Issue #850 の成果物） |
| production R2 `MEDIA` | `portfolio/` prefix 配下に 116 object |
| production Worker | 変更しない（migration 0010 の適用のみ） |

**触らないもの**: Notion（ADR-0018 / Issue #814 の単発書き込みは本 Issue の
範囲外）、`quality/asset-license-inventory.json`（権利記録は捏造しない）、
production 以外の環境。

## 1. 必要な credential 名（値は出さない）

| credential 名 | 用途 | 備考 |
| --- | --- | --- |
| `CLOUDFLARE_D1_API_TOKEN` | production D1 への read / write | D1 専用。Worker deploy token とは別 |
| `CLOUDFLARE_API_TOKEN` | R2 object の put / list | R2 書き込み用 |
| `CLOUDFLARE_ACCOUNT_ID` | 対象 account の固定 | `scripts/_cloudflare-identity.mjs` が正とする値と一致すること |

- 値の入手元は **Infisical**（ADR-0015 §1）。本 runbook は**値を一切書かない**。
- agent は value-listing コマンド（`infisical secrets ...`、`wrangler secret:list
  --format pretty` 等）を実行しないこと（AGENTS.md §4「no value-listing of real
  secrets」）。値的比较が必要な場合は status-only の比較スクリプトを使う。

## 2. operator 認可の条件

production への書き込みは、次の**すべて**が満たされたときだけ実行する。

1. owner が Issue #811 の決定（§1 の引用）を**確認済み**であること。
   - 決定記録は `ownerConfirmation: "confirmed"` で、決定そのものは
     `docs/domain/portfolio-migration-decisions.md` にある。
2. 本 Issue の Draft PR が **merged** であること（migration 0010 が
   production に適用される前提）。
3. Issue #850 / PR #852（メディア移行）が **merged** であること
   （`portfolio_media` 行と R2 object の前提）。
4. operator が**この runbook の手順を 1 通実行する権限**を持つこと。
   AGENTS.md §6 により、agent は release PR を merge しない。本手順の
   production 実行は operator の実行である。

## 3. 実行順

```bash
# 0) 作業ツリーと migration の確認（読み取りのみ）
node scripts/d1.mjs list --target=production

# 1) dry-run（書き込みなし・credential 不要）
node scripts/migrate-portfolio-from-2025.mjs --dry-run \
  --ledger=docs/migration/portfolio-2025-to-2026-publication.json
node scripts/migrate-legacy-media.mjs --dry-run --target=production

# 2) 本番 D1 への適用（要 credential / 要 operator 認可）
node scripts/migrate-portfolio-from-2025.mjs --apply --target=remote
node scripts/migrate-legacy-media.mjs --apply --target=production --execute

# 3) migration 0010 の適用（Worker deploy と同じ pipeline で）
node scripts/d1.mjs apply --target=production --execute

# 4) 事後確認（status-only）
node scripts/d1.mjs query --target=production --sql \
  "SELECT COUNT(*) rows,
          SUM(visibility='public' AND status='published') published,
          SUM(evidence_status='unreviewed') unreviewed,
          SUM(status='archived') retired
     FROM portfolio_project"
```

**順序の理由**: テキスト移行（2 の前半）を先にしないと `portfolio_media`
行の外部キーが解決しない。`evidence_status` 列は migration 0010 で追加される
ので、**テキスト移行は 0010 の適用後に実行すること**（3 を 2 より先に
実行する。下の「順序の注意」を参照）。

### 順序の注意（重要）

`portfolio_project.evidence_status` は **migration 0010** で追加される列で
ある。移行 script はこの列に値を書き込むので、**migration 0010 を適用して
から**移行 script を実行すること。逆順（移行 → 0010）では、列が無い状態で
書こうとして失敗する。

```bash
# 正しい順序
node scripts/d1.mjs apply --target=production --execute      # 0010 を含む
node scripts/migrate-portfolio-from-2025.mjs --apply --target=remote
node scripts/migrate-legacy-media.mjs --apply --target=production --execute
```

## 4. 実行後に確認する状態

| 実測項目 | 期待値 |
| --- | --- |
| `portfolio_project` の `legacy_%` 行数 | 60 |
| そのうち `visibility='public' AND status='published'` | 60 |
| そのうち `evidence_status='unreviewed'` | 60 |
| `portfolio_link` の `legacy_link_%` 行数 | 103 |
| `portfolio_media` の `legacy_media_%` 行数 | 130 |
| `portfolio_media` の `is_cover=1` 行数 | 23（media を持つ project と同数） |
| retire された行 | slug 衝突した行だけ（0 行でもよい） |
| `GET /portfolio` の掲載件数 | 60（+ 既存の本サイト分の行） |
| `GET /portfolio/<slug>` | 200、`data-evidence-status="unreviewed"` を含む |
| `GET /media/<r2_key>` | 200 / 配信可能 MIME |

## 5. rollback

3 つの段階を、影響の小さい順に並べる。**どれかを実行するたびに、台帳
（`docs/migration/portfolio-2025-to-2026-publication.json`）を更新する。**

### 5.1 公開だけ戻す（本文・画像は残す）

```bash
node scripts/d1.mjs query --target=production --sql \
  "UPDATE portfolio_project
      SET visibility='draft'
    WHERE id LIKE 'legacy\_%' ESCAPE '\'"
```

### 5.2 行を消す

```bash
# media 行 → link 行 → project 行 の順（外部キー）
node scripts/d1.mjs query --target=production --sql \
  "DELETE FROM portfolio_media WHERE id LIKE 'legacy_media_%'"
node scripts/d1.mjs query --target=production --sql \
  "DELETE FROM portfolio_link WHERE id LIKE 'legacy_link_%'"
node scripts/d1.mjs query --target=production --sql \
  "DELETE FROM portfolio_project WHERE id LIKE 'legacy\_%' ESCAPE '\'"
```

### 5.3 R2 の key を消す

key は決定的に再計算できる（`portfolio/<slug>/<legacy-content-id>/<media-id>-<file>`）。
削除は **production bucket の prefix を確認し、`portfolio/` 配下だけ**を
対象にする。`scripts/r2-media-key-set-audit.mjs` 相当の監査を先に走らせる。

```bash
cf r2 object list --bucket-name my-web-2026 --prefix portfolio/   # 出力は operator 限り
# 1 件ずつ削除する（prefix 全体の一括削除は禁止）
```

### 5.4 retire を取り消す

`5.1` で公開を戻すだけなら、retire した行は戻さなくてよい（公開されない
行である）。元の slug へ戻す必要がある場合のみ、retire 時の
`<slug>-retired` を記録から読み、元の slug に戻す（§5.2 の後に限る）。

## 6. この手順が触らないもの

- **Notion**: ADR-0018 / Issue #814 の単発書き込みは本 Issue の範囲外。
  この手順は Notion に一切書き込まない。
- **権利記録**: `quality/asset-license-inventory.json` は変更しない。
  未レビューは未レビューのまま公開され、その状態は公開面に表示される。
- **production の secret**: 値の表示・取得をしない。

## 7. 関連

- [`docs/domain/portfolio-migration-decisions.md`](../domain/portfolio-migration-decisions.md)（決定）
- [`docs/verification/portfolio/portfolio-publication.md`](../verification/portfolio/portfolio-publication.md)（local の実測）
- [ADR-0019](../../docs/adr/ADR-0019-publication-authority-and-unreviewed-assets.md)
- `docs/runbook/legacy-media-migration.md`（Issue #850 のメディア手順。PR #852 で追加される）
