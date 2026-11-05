# Runbook — Notion MCP（構造の確認と編集）

Issue #788。Portfolio の Notion CMS（Issue #765 / PR #775）を運用するための
ローカル MCP サーバーの手順。

**読み取りと書き込みの両方を扱う。** 用途は 2 つある。

1. **構造の確認と整備** — database の property、page 本文の block 構成を読み、
   同期の語彙に合うように database を整える。
2. **旧サイトからのコンテンツ投入** — Issue #766 の移行データはエージェントが
   Notion に書き込む。owner が 1 件ずつ手入力する運用はしない。

一方で、**同期の向きは変えない**。`scripts/sync-portfolio-notion.mjs` は
Notion → repository（snapshot 生成）の一方向であり、MCP はここに関与しない。

## 1. なぜ要るか

`scripts/sync-portfolio-notion.mjs --dry-run` は、語彙に合わない page を
`refused page=… code at=…` として**理由コードだけ**返す。理由コードは
「何が足りないか」を 1 件ずつ列挙するが、「database に実際どんな property があるか」
「page 本文がどんな block 構成か」は分からない。MCP はそこを埋める。

## 2. 導入済みの構成

- package: `@notionhq/notion-mcp-server`（devDependency。**グローバル install しない**）
- 設定: リポジトリ直下の `.mcp.json`（Claude Code の project scope）
- token: **ファイルに書かない。** server の起動を `infisical run` で包み、
  `NOTION_TOKEN` は Infisical `dev` / path `/` からのみ注入する

```json
{
	"mcpServers": {
		"notionApi": {
			"command": "infisical",
			"args": [
				"run",
				"--log-destination",
				"stderr",
				"--env=dev",
				"--path=/",
				"--",
				"./node_modules/.bin/notion-mcp-server"
			]
		}
	}
}
```

`--log-destination stderr` は必須である。Infisical CLI は既定で
`INF Injecting N Infisical secrets …` を **stdout** に書くため、そのままだと
MCP の stdio フレームを壊す。

## 3. 前提

| 前提 | 確認方法 |
| --- | --- |
| `pnpm install` 済み | `ls node_modules/.bin/notion-mcp-server` |
| Infisical CLI がログイン済み | `infisical user`（値は出ない） |
| `dev` に `NOTION_TOKEN` がある | 下の §4 の status-only 確認 |
| Notion 側で integration が対象 database に接続されている | MCP の `API-get-self` / database 取得で 403 にならないこと |

## 4. token の存在確認（値を出さない）

```bash
cd <worktree>
infisical run --env=dev --path=/ -- node -e \
  "console.log('NOTION_TOKEN:', process.env.NOTION_TOKEN ? 'PRESENT' : 'MISSING')"
```

`PRESENT` / `MISSING` 以外を出力しない。値の確認・列挙は AGENTS.md §4 で禁止されている。

## 5. 有効化の確認

```bash
claude mcp list
```

`notionApi` が project scope で表示されればよい。接続に失敗する場合は §7 を見る。

## 6. 使い方

### 6.1 読む

| 目的 | 操作 |
| --- | --- |
| integration が誰として動いているか | `API-get-self` |
| database の property 名と型 | `API-retrieve-a-database`（`NOTION_PORTFOLIO_DB_ID`） |
| data source の property 名と型 | `API-retrieve-a-data-source` |
| page 本文の block 構成 | `API-retrieve-a-block` / children |
| 対象範囲の page 一覧 | `API-post-database-query` |

### 6.2 書く（owner が 2026-11-01 に認可）

| 目的 | 操作 | 条件 |
| --- | --- | --- |
| database の property を整える | `API-update-a-database` | **Portfolio database だけ**。§6.3 の語彙に合わせる |
| 旧サイトの content を入れる | `API-post-page` + block append | Issue #766 の範囲だけ |
| 既存 page の修正 | `API-patch-page` / `API-patch-block-children` | 対象 page を先に読み、差分を説明できること |

### 6.3 書き込みの統制

書き込みが許されるのは次の条件をすべて満たすときだけである。

1. **対象が Portfolio database**（`NOTION_PORTFOLIO_DB_ID` が指す 1 つ）。
   他の database・他の page には書かない。
2. **書く前に読む。** 現在の値を取得し、何をどう変えるかを先に説明できること。
3. **削除はしない。** archive / delete は owner の明示指示があるときだけ。
4. **property 名と選択肢は `src/portfolio/notion/contract.ts` の語彙に一致させる。**
   実装に無い語彙を Notion 側に発明しない。逆に、Notion 側の語彙を勝手に
   実装へ持ち込まない（正は repository 側の契約）。
5. **公開可否を Notion の操作で決めない。** `status` / `visibility` を書くことはあるが、
   権利・公開の最終判定は repository 側の記録が行う（ADR-0018）。

### 6.4 権限の前提

書き込みには Notion integration の capability が **Update content / Insert content**
である必要がある。足りない場合 `403 restricted_resource` を返す。

## 7. 失敗時の読み方

| 症状 | 原因 | 対処 |
| --- | --- | --- |
| `claude mcp list` に出ない | `.mcp.json` が無い / JSON が不正 | `node -e "JSON.parse(require('fs').readFileSync('.mcp.json'))"` |
| server が即終了する | `infisical` が未ログイン、または `node_modules/.bin/notion-mcp-server` が無い（`pnpm install` 前） | それぞれ確認。**token の値を出して確かめない** |
| 応答が壊れる（パースできない） | `--log-destination stderr` が抜けて stdout にログが混ざった | §2 の args に戻す |
| `401 unauthorized` | token が無効・失効 | Infisical の値を更新する（値は表示しない） |
| `404 object_not_found` | integration に対象 database が共有されていない、または id が別物 | Notion の UI で integration を接続し直す |
| `403 restricted_resource` | integration の capability 不足（Read content が必要） | Notion の integration 設定で capability を確認 |

## 8. やらないこと

- token の値を**この repository の追跡ファイル**に書くこと（owner は 2026-11-01 に
  「Git remote に上げない限り露出してよい」と述べているが、`.mcp.json` は §2 の
  Infisical 経由のままで足りるため、値を持つ必要が無い）
- token の値を**エージェントの transcript** に出すこと（AGENTS.md §4）
- グローバル install（`npm i -g` / `pnpm add -g`）
- Portfolio database 以外への書き込み（§6.3）
- `prod` の secret への接続
