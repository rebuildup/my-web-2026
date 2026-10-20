# Project introductions

> Status: **Canonical contract**
> Visibility: public (MIT)
> Audience: contributor, agent, future-self
> Owner: `src/projects/**` (Issue #621)
> Enforced by: `pnpm run projects:check` (part of `validate:fast`), `pnpm run test`
> Operator reference: this document, §5–§7

## 1. 結論

`/projects/dotfiles` は外部リポジトリの README を **リクエスト時に取得しない**。
公開 README の限られた部分を offline で snapshot に変換し、その JSON を commit して配信する。

- 表示のたびに GitHub を呼ばない（Worker からの outbound 依存を作らない）。
- snapshot には **上流の commit SHA** と **README blob SHA** を記録する。
- 取得できなかった場合は、最後に確認できた内容を「最新」として提示しない。
- snapshot の生成・検証は `src/projects/**` ではなく `scripts/` の Node ツールが所有する。
  Worker 側は「読む・検証する・表示する」だけを所有する。

## 2. Allowlist

同期が読む URL は次の 3 つだけである（[`scripts/_project-introduction.mjs`](../../scripts/_project-introduction.mjs)
の `PROJECT_SOURCES` / `allowedRequestUrls` / `assertAllowedApiUrl`）。

| 目的 | endpoint |
| --- | --- |
| repository metadata（public / archived / default branch） | `https://api.github.com/repos/rebuildup/dotfiles` |
| 既定ブランチの commit SHA | `https://api.github.com/repos/rebuildup/dotfiles/commits/main` |
| その commit に固定した README | `https://api.github.com/repos/rebuildup/dotfiles/contents/README.md?ref=<sha>` |

制約:

- `Authorization` header を送らない。token を要求しない。
- `redirect: 'error'`。リダイレクト先を読まない。
- レスポンスは byte 上限で打ち切る。
- `README.md` 以外の path、submodule、`.gitmodules`、`docs/**`、`.infisical.json` などは読まない。
- Infisical の値、マシン固有の identity / config、任意の path は読まないし公開しない。

許可する README section は `principles` / `layout` / `agent-launcher` /
`agent-configuration` / `decisions-and-research` の 5 つ。見出しが一致しない
section は snapshot に含めない（空の section を捏造しない）。allowlist の更新は
別 ticket で行い、`projects:check` は section の欠落を「空の introduction」として
通さない（`introduction.sections` が空なら失敗する）。

## 3. Snapshot

`src/projects/snapshots/dotfiles.json` の schema は
`src/projects/types.ts#ProjectIntroductionSnapshot`。

来歴として次を持つ。

| field | 意味 |
| --- | --- |
| `source.commitSha` | 公開している README の内容が最後に変わった commit（40 hex） |
| `source.committedAt` | その commit の日時 |
| `source.readmeBlobSha` | その commit における `README.md` の blob SHA（40 hex） |
| `source.readmeUrl` | `<canonicalUrl>/blob/<commitSha>/README.md` に固定 |
| `verifiedAt` | 上流を最後に確認した時刻 |
| `appliedAt` | snapshot を最後に書き換えた時刻 |
| `contentDigest` | 抽出結果を commit 非依存に正規化した SHA-256（`sha256:<64 hex>`） |

`source.commitSha` は「最後の同期時の既定ブランチ head」ではない。README の blob が
変わらない間は前回の commit を据え置く。dependabot など README を触らない commit で
provenance や `appliedAt` が動くことはない。

`contentDigest` は抽出後の text と link target だけを対象にし、URL 中の commit SHA は
`<readme-commit>` に正規化してから hash する。したがって、既定ブランチが進んだだけ、
または公開対象外の README 部分だけが変わった場合は digest が変わらず、snapshot を
書き換えない。公開対象の text または link target が変わったときだけ digest が変わる。

`verifiedAt` は **heartbeat** でも進む。内容が同じでも 7 日ごとに再確認し、
`verifiedAt` だけを更新する。内容が変わったときは `appliedAt` も更新する。

## 4. Freshness と failure semantics

表示状態は 4 つ（`src/projects/snapshot.ts#evaluateFreshness`）。

| 状態 | 条件 | 表示 |
| --- | --- | --- |
| `current` | `verifiedAt` から 14 日以内 | 通常表示 |
| `stale` | 14 日超 | 内容は出すが「最新ではない」と明示 |
| `unavailable` | 上流が deleted / private / archived / ref 不一致 / README shape 不一致 | 最後の内容を出し、reason ごとの文言で「最新ではない」と明示 |
| `unknown` | snapshot が無い / 不正 / 日時を解釈できない | 内容を出さず、上流へのリンクだけ出す |

同期の失敗は 2 種類に分ける。この区別は公開コピーに直結する。

- **transport failure**（timeout / network / 401 / 403 / 429 / 5xx / byte cap 超過 /
  非 JSON body）: snapshot を書かない。既存 snapshot の `verifiedAt` が古くなり、
  やがて `stale` になる。一時的な GitHub の rate limit や欠けた body を
  「リポジトリが公開されなくなった」と公開しないための境界である。
- **source state failure**（404 / private / archived / default branch 変更 / README shape 変更）:
  `availability: "unavailable"` と理由・観測時刻を記録する。**introduction は保持する**。
  ページは「最後に確認できた内容」として出し、`current` とは表示しない。

`unavailable` の理由語彙は source state だけに限定する
（`not-found` / `not-public` / `archived` / `ref-mismatch` / `readme-shape`）。
ページ copy は `src/projects/unavailable-copy.ts` が所有し、
「現在公開されていない」は `not-found` / `not-public` にだけ使う。
`archived` / `ref-mismatch` / `readme-shape` はそれぞれ archive・既定ブランチ変更・
README 構成変更として説明する。未知の理由は「状態を確認できなかった」に倒す。

削除された repository を空の introduction として公開しない。読者に「内容が無い」と
「取得できない」を区別させるため、`unavailable` は独立した状態である。

## 5. Trigger と遅延

- GitHub Actions `Project introduction sync`（`.github/workflows/projects-sync.yml`）。
- `schedule`: 毎日 03:17 UTC。`workflow_dispatch` でも手動実行できる。
- 許容遅延: **最大 24 時間 + workflow queue**。page は snapshot の `verifiedAt` を
  そのまま表示するので、遅延を「現在」と偽らない。
- 内容が同じ日は commit しない。7 日経過したときだけ heartbeat として `verifiedAt` を更新する。
- 同期 PR の base は repository variable `PROJECTS_SYNC_BASE_REF`（sprint cut 時に
  active な `release-x-y-z` を設定する）。未設定なら workflow は base を推測せず停止する。
- workflow は merge / tag / release / deploy を行わない。PR の merge は人間の gate（AGENTS.md §6）。

## 6. Sanitization / publication boundary

README は **HTML sink に渡さない**。抽出結果は `RichTextNode`（text + 検証済み URL）だけであり、
`dangerouslySetInnerHTML` を使わない。

- `<script>` / `<style>` block、HTML tag は除去する。text node だけを残す。
- 相対 link は `https://github.com/rebuildup/dotfiles/blob/<sha>/...` に解決する。
- heading anchor は GitHub の slug 規則で解決する。
- 画像は hotlink せず、`raw.githubusercontent.com/.../<sha>/...` への link として出す。
- link は `https:` / `http:` / `mailto:` のみ。credential、localhost、`.local`、`.internal`、
  `*.secrets.*`、private / loopback / link-local IP は拒否する。
- 公開 boundary として、operator endpoint と machine-local config path は一般化する。
  現在の redaction は `scripts/_project-introduction.mjs#redactPublicationText` が所有する。

`pnpm run projects:check` は次を検証する。

1. schema version と必須 field、file name と `source.id` の一致
2. `source.id/owner/repo` が `dotfiles/rebuildup/dotfiles`
3. commit SHA / README blob SHA が 40 hex、README URL が commit に固定
4. `contentDigest` が実際の introduction と一致
5. すべての link が安全な scheme
6. section id が source ごとの plan（`principles` / `layout` / `agent-launcher` /
   `agent-configuration` / `decisions-and-research`）内で、重複なし
7. section の `sourceUrl` が `<readmeUrl>#<anchor>` に完全一致（`blob/main/` や
   別 commit を拒否）
8. `structure` が repository root の entry のみ（`/`、`..`、`.`、重複を拒否）
9. 公開されるすべての text（title / heading / summary / points / structure /
   related label）が `redactPublicationText` で変化しない

freshness は **advisory**（警告）であり、gate の失敗条件ではない。14 日を超えた snapshot は
`validate:fast` を赤にしない。古いことは表示状態であって、契約違反ではないため。

## 7. Operator runbook

### 手元で再生成する

```sh
pnpm run projects:sync
pnpm run projects:check
git diff -- src/projects/snapshots/dotfiles.json
```

`projects:sync` は status-only の出力（source / commit / verifiedAt）を出し、secret 値や
README 全文を stdout に流さない。

### snapshot を review する

- `source.commitSha` が「公開対象 README が最後に変わった commit」か（head と一致しなくてよい）。
- `contentDigest` が変わった理由が公開対象 text / link の意味ある変更か
  （heartbeat だけ、または head が進んだだけなら digest は同じ）。
- `availability` が `unavailable` のとき、理由が transport ではなく source state か。
  rate limit / 5xx / 非 JSON は snapshot を書かないため、ここには現れない。
- introduction に machine-local path / operator endpoint / 生 HTML が現れていないか。

### 失敗したとき

| 症状 | 対応 |
| --- | --- |
| `projects:check` が digest mismatch | `pnpm run projects:sync` で再生成する。手で JSON を編集しない |
| allowlist の section が欠けた | 上流 README の見出しを確認し、allowlist の更新を別 ticket で行う |
| `unavailable` が続く | 上流の公開状態を確認する。復旧すれば次回同期で `public` に戻る |
| GitHub Actions が base 未設定で停止 | `PROJECTS_SYNC_BASE_REF` を active release branch に設定する |

## 8. Ownership

- `src/projects/**` が page / snapshot reader / freshness を所有する。
- `scripts/_project-introduction.mjs` が allowlist・取得・抽出・redaction を所有する。
- `scripts/sync-project-introductions.mjs` が書き込み判断を所有する。
- `scripts/check-project-introductions.mjs` が offline gate を所有する。
- `src/http/seo/sitemap.ts` はこの route を **exclude** する。nav destination ではないため
  sitemap の「nav-linked」不変条件と衝突する。
- route は public read-only。loader は binding も outbound request も持たない。
