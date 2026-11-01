# Runbook — Notion MCP（読み取り専用の構造確認）

Issue #788。Portfolio の Notion 同期（Issue #765 / PR #775）を実データで走らせる前に、
**Notion 側の実構造**を確認するためのローカル MCP サーバーの運用手順。

この runbook が扱うのは「Notion を読んで構造を確かめる」ことだけである。
同期の書き込みは `scripts/sync-portfolio-notion.mjs` だけが行う。

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

## 6. 使い方（読み取り専用）

構造確認に使う最小の操作:

| 目的 | 操作 |
| --- | --- |
| integration が誰として動いているか | `API-get-self` |
| database の property 名と型 | `API-retrieve-a-database`（`NOTION_PORTFOLIO_DB_ID`） |
| data source の property 名と型 | `API-retrieve-a-data-source` |
| page 本文の block 構成 | `API-retrieve-a-block` / children |
| 対象範囲の page 一覧 | `API-post-database-query` |

**書き込み系の操作は使わない。** 同期は同期 script の責務である。

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

- token の値を表示する操作（`printenv`、`infisical secrets list`、`--show-values`）
- グローバル install（`npm i -g` / `pnpm add -g`）
- MCP 経由での Notion 書き込み
- `prod` の secret への接続
