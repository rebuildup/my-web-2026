# 旧サイト メディア移行 runbook (Issue #850)

> `my-web-2025` の SQLite `media` テーブルの BLOB を R2 `MEDIA` bucket へ
> 移し、`portfolio_media` 行を生成する手順。実行主体は
> `scripts/migrate-legacy-media.mjs`。
>
> **status-only 契約**が本 runbook の中心にある。出力は件数・byte 総計・
> skip 理由のみで、**media のバイト・row 本文・object key・credential を
> 一切出さない**（AGENTS.md §4、
> [`r2-media-key-set-audit.md`](r2-media-key-set-audit.md) と同じ契約）。

---

## 1. 何をするのか / 何をしないのか

| する | しない |
| --- | --- |
| 旧 `media` 行の BLOB を読み、sha256 を計算する | 旧 DB を書き換える（read-only で開く） |
| 決定的な R2 key で object を 1 度だけアップロードする | 公開の可否を決める（`visibility` は触らない） |
| `portfolio_media` 行を 1 media 行につき 1 行生成する | 既存の `portfolio_project` / `portfolio_link` 行を書き換える |
| 空 alt・非配信 content type を fail closed で skip する | skip した行を「0 件扱いに見せる」 |

**このスクリプトは「公開」しない。** 移行が作るのは
`visibility='draft'` の project に紐づく media 行であり、公開面に出るかどうかは
owner の publication 決定（`docs/migration/portfolio-2025-to-2026-classification.json`
と `docs/migration/portfolio-2025-role-overrides.json`）が握る。§9 参照。

## 2. 実測値（2026-11-02 計測 / `.reference/my-web-2025`）

| 項目 | 値 |
| --- | --- |
| 旧 DB | 151 個 |
| `media` 行 | 297 行 |
| 合計 byte | 114,953,553 |
| 異なる sha256 | 124 |
| `content_id` の無い行 | 25 行（§3 の帰属規則で解決） |
| MIME 構成 | PNG 258 / JPEG 33 / GIF 3 / WebP 2 / SVG 1 |

## 3. スコープ規則 — なぜ 297 行全部じゃないのか

`portfolio_media.project_id` は `portfolio_project(id)` への外部キーであり、
D1 は外部キーを強制する（実測: local D1 の `PRAGMA foreign_keys` = 1）。
したがって **project 行が無い item の media 行は書けない**。

project 行の有無は `scripts/migrate-portfolio-from-2025.mjs`（本文移行）が
決める。本スクリプトは**同じ規則**を使う。

| クラス | 本スクリプトの扱い | 件数（media 行） |
| --- | --- | --- |
| `eligible` / `rewrite_required` かつ `publication != 'rejected'` | 行を作る | 131 |
| `mechanical_drop`（`NEVER insert`） | `project_not_migrated` として skip | 166 |
| `new_candidate`（自動投入しない） | 同じく skip | 0 |
| `publication = 'rejected'` | 同じく skip | 0 |

skip された 166 行 / 4,135,229 byte は **`media-list-*` / `media-rt-*` /
`test-otu-*` という自動生成の test fixture** が全件である。portfolio の
作品として公開してはならないので、これらは project 行ごと作らない。

**`content_id` が無い行の帰属**: その行を含む DB は `contents` を 1 件だけ
持つため、DB 単位で 1 つの content に帰属する（推測ではなく、DB の
構造から決まる）。この補完で解決した行数は 25 行で、**すべて数えて報告する**
（`attributed rows`）。

## 4. 実行方法

### 4.1 dry run（既定・credential 不要・書き込みゼロ）

```bash
node scripts/migrate-legacy-media.mjs --dry-run
node scripts/migrate-legacy-media.mjs --dry-run --target=production
```

出力（実測）:

```text
[legacy-media] target           local
[legacy-media] databases        151
[legacy-media] media rows       297 (114953553 bytes)
[legacy-media] unique sha256    124
[legacy-media] attributed rows  25
[legacy-media] scoped projects  60
[legacy-media] uploads          116
[legacy-media] portfolio_media  130
[legacy-media] skips            content_type_not_deliverable=1 project_not_migrated=166
[legacy-media] dry-run: nothing was uploaded and no row was written.
```

### 4.2 local 適用

前提: 本文移行が先に走っていること（project 行が無いと FK が拒否する）。

```bash
node scripts/migrate-portfolio-from-2025.mjs --apply --target=local
node scripts/migrate-legacy-media.mjs --apply --target=local
```

preflight が「対象 project 行が target D1 に無い」を検出した場合は
**何も書かずに exit 3** で止まる。

### 4.3 production

```bash
# --execute 無し → 拒否（exit 2）。何も起きない。
node scripts/migrate-legacy-media.mjs --apply --target=production
```

実測の拒否メッセージ:

```text
[legacy-media] refusing a production apply: --execute is required. …
```

`--execute` を付けた production 実行は credential（R2 token / D1 token）を
要求する。**この runbook の手順では production を実行しない**（§11）。

## 5. 決定性

| もの | 規則 |
| --- | --- |
| R2 key | `portfolio/<slug>/<legacy-content-id>/<media-id>-<safe-filename>` |
| row id | `legacy_media_<project-id>_<legacy-media-id>` |
| project id | `legacy_<slug>`（本文移行と同じ） |
| cover | project 内の先頭 1 行のみ `is_cover = 1`（順序は `created_at`、同値は id） |
| `display_order` | project 内の 0 始まり連番 |
| `created_at` | 旧 `media.created_at` の ms 値（不明なら 0） |

`<safe-filename>` は `[A-Za-z0-9._-]` 以外を `-` に置換した結果。旧ファイル名
には空白と日本語が含まれる（`Web 1920 – 2.png`、
`スクリーンショット 2025-12-13 145044.png`）。key の一意性は media id が
担保するので、ファイル名的衝突は起こらない。

**再実行しても同じ key に同じ byte を書き、同じ行を upsert する**ので、
中断した直後に同じコマンドをもう一度走らせれば足りる。

## 6. バイト重複の扱い

旧 corpus には**同一バイトが複数行**ある（同じスクリーンショットが 1 item に
2 回、test fixture が item ごとに 1 回）。

| 範囲 | 扱い |
| --- | --- |
| 同じ project 内の同一 sha256 | object は **1 回だけ**アップロード。行は **media 行ごとに作る**（重複を勝手に削らない） |
| 別の project の同一 sha256 | project ごとに object を持つ（key namespace が project 単位であり、行が自分の key を所有する） |

行を消さないのは、**重複は旧 item の事実**であり、移行が事実を削除する
権利を持っていないためである。実測で 130 行 / 116 object（重複 14 行分）。

## 7. fail closed になる規則

| 条件 | 結果 | 件数（実測） |
| --- | --- | --- |
| `mime_type` が空 | `content_type_missing` で skip | 0 |
| `mime_type` が配信不能（`image/svg+xml` など） | `content_type_not_deliverable` で skip | 1 |
| alt / description / ファイル名のどれも無い | `alt_unavailable` で skip | 0 |
| 帰属先の content が決まらない | `project_unattributable` で skip | 0 |
| 公開 prefix が key を拒否する（`..` を含む等） | `key_not_publishable` で skip | 0 |

配信不能 type を skip する理由: `src/http/media/router.ts` が配信する
MIME type を限定しており、限定外の object を持つ `portfolio_media` 行は
**永久に壊れた画像**になる。行を作らない方が正しい。

## 8. 検証手順（local）

実測手順と実測値:

```bash
# 1) 本文移行 → 60 project 行（すべて draft）
node scripts/migrate-portfolio-from-2025.mjs --apply --target=local

# 2) メディア移行 → 116 object + 130 行
node scripts/migrate-legacy-media.mjs --apply --target=local

# 3) 行の集計
node scripts/d1.mjs query --target=local --sql \
  "SELECT COUNT(*) rows, COUNT(DISTINCT r2_key) keys, SUM(is_cover=1) covers, COUNT(DISTINCT project_id) projects FROM portfolio_media"
# → rows=130, keys=116, covers=23, projects=23

# 4) project ごとに cover が 1 件だけであること
node scripts/d1.mjs query --target=local --sql \
  "SELECT project_id, COUNT(*) n, SUM(is_cover=1) c FROM portfolio_media GROUP BY project_id HAVING c <> 1 OR n > 1"
# → c <> 1 の行は 0 件（n > 1 の project でも cover は 1 件）

# 5) R2 の object 数と byte 総計
#    cf r2 objects list --bucket-name my-web-2026 --local --persist-to .tmp
#    → 116 object / 97,132,761 byte / prefix は portfolio/ のみ
```

### 8.1 画像が実際に表示されること（preview）

移行した project は `visibility='draft'` なので、そのままだと
`/portfolio/<slug>` は 404 になる（公開面に出ないことが正しい状態）。
**表示の検証だけ**は local D1 で 1 件だけ public に倒して行う。

```bash
node scripts/d1.mjs query --target=local --sql \
  "UPDATE portfolio_project SET visibility='public' WHERE id='legacy_propose'"
pnpm exec vite dev --port 3123
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3123/portfolio/propose
# → 200
curl -s -o /dev/null -w '%{http_code} %{content_type} %{size_download}\n' \
  "http://127.0.0.1:3123/media/portfolio/propose/propose/media_1762429544596_aa78lp7qm-vlcsnap-2025-11-06-20h45m24s212.png"
# → 200 image/png 1640389
```

実測: ページの `<img>` は `naturalWidth=1080` / `naturalHeight=1920` で
**デコード済み**（壊れた画像ではない）。スクリーンショットは WebP で
`.tmp/legacy-media-portfolio.webp` に保存した（worktree の外・追跡外）。

検証が終わったら public への倒しを戻す:

```bash
node scripts/d1.mjs query --target=local --sql \
  "UPDATE portfolio_project SET visibility='draft' WHERE id='legacy_propose'"
```

## 9. 公開は owner の決定

移行後の 60 project は**すべて `visibility='draft'`** のまま。これは
`publication` が 60 件とも `pending_owner` だからであり、移行スクリプトが
判断したわけではない。owner が publication を `approved` に替えたとき、
project は公開され、本 runbook の §8.1 と同じ経路で画像が配信される。

## 10. rollback

```bash
# 行を消す（media 行だけ。project / link 行には触れない）
node scripts/d1.mjs query --target=local --sql \
  "DELETE FROM portfolio_media WHERE id LIKE 'legacy_media_%'"

# object を消す（key は §5 の規則で再計算できる）
cf r2 object delete portfolio/<slug>/<legacy-content-id>/<media-id>-<safe-filename> \
  --bucket-name my-web-2026 --remote
```

local store なら `.tmp/` を削除すればよい。**production の rollback は
owner の承認が必要**（§11）。

## 11. 本番実行の注意点

1. **R2 custom domain が付いている間は、bucket 内の key は匿名で取得できる。**
   `docs/security/r2-media-visibility.md` が recording しているとおり、
   `portfolio/` は公開 prefix なので、**production への upload は公開と
   同じ結果**になる。移行対象の中に公開してよいものだけが入っていないか
   を、実行前に確認すること。
2. **`--execute` は owner の承認を前提とする。** この runbook の手順は
   production を実行しない。実行する場合は §4.3 の拒否が解除される
   `--execute` を明示し、credential は Infisical から注入する
   （`docs/runbook/infisical-secrets.md`）。値を出力しないこと。
3. **project の `visibility` は本スクリプトが触らない。** production で
   移行するとしても、公開は owner の publication 決定を経る。
4. **production D1 / R2 への書き込みは不可逆である。** §10 の rollback に
   よるbject 削除は、key の再計算に基づく手作業になる。
