# R2 公開配信ゲート — `/media/<key>`（Issue #634）

> R2 の公開配信経路が、公開承認済み key だけを返すことを
> **リクエストレベル**で示す検証記録。あわせて、このリポジトリが
> 閉じられない範囲（custom domain の edge 配信）を明示する。

- 実装: [`src/http/media/router.ts`](../../../src/http/media/router.ts)、
  [`src/cloudflare/media-visibility.ts`](../../../src/cloudflare/media-visibility.ts)
- 運用契約:
  [`docs/security/r2-media-visibility.md`](../../security/r2-media-visibility.md)
- 画像:
  [`r2-public-delivery-gate.webp`](./r2-public-delivery-gate.webp)
- 生成: `pnpm run r2:public-delivery:report`

## 1. 何を確かめたか

Issue #634 の受入条件は「配信時に未承認 key を拒否する」ことである。
Issue #459 / PR #633 は検出（`auditPublicMediaPublication`）と
可視性ドキュメントまでを入れたが、production の配信経路は
custom domain の edge に任されていた。本 Issue は Worker が
`/media/<key>` を配信する経路を追加し、次の 5 段をリクエストの
たびに実行する。

| 段 | 実装 | 拒否時 |
| --- | --- | --- |
| 1. key grammar / namespace | `createPublicMediaDelivery` → `classifyMediaKey` | 404（bucket に触れない） |
| 2. 所有者の承認 | `isApprovedMediaKey` → `src/portfolio/media-approval.ts` / `src/http/reactions/images.ts` | 404（bucket に触れない） |
| 3. bucket read | `c.env.MEDIA.get(key)` | 404 |
| 4. content type | `isDeliverableMediaContentType` | 404（415 ではない） |
| 5. 配信 | route response | 200 + `nosniff` |

段 2 が「モデル」ではなく実経路になった点が本 Issue の中心である。
承認は配信ルートが持つのではなく、**その object を公開している
obligation** が D1 で答える。portfolio は
`portfolio_media ⋈ portfolio_project` に対し
`status = 'published' AND visibility = 'public'` を問い、
reactions は `reaction_images` の行を問う。ルートは 2 つの
namespace 名だけを知り、「公開中とは何か」を知らない。

段 4 は same-origin 配信ゆえの防壁である。`/media/…` から
`text/html` を返すと、置き忘れた object が `rebuildup.dev` 上の
XSS primitive になる。producer が書くメディア型だけを返し、
それ以外は「存在しない」ものとして扱う（415 を返すと存在が漏れる）。

## 2. 検証環境

| 項目 | 内容 |
| --- | --- |
| runtime | workerd（`@cloudflare/vitest-plugin` の pool） |
| 入口 | `SELF.fetch('https://example.com/media/…')` — Worker entry から |
| D1 | local `applyPortfolioSchema` + 本テストが作る `reaction_images` |
| R2 | local `env.MEDIA.put`。合成バイト列のみ |
| 本番 | **一切触れない**。deploy も remote binding も使わない |
| 秘密 | 扱わない。fixture に credential は無い |

fixture の bucket には**拒否ケースごとに object を置いてある**。
draft project の object、archived かつ `visibility = 'public'` の
project の object、連番の隣、private namespace、未宣言
namespace、行の無い reaction object、`text/html` の承認済み
object — どれも実在する。したがって 404 は「object が無かった」
偶然ではなく、ゲートが拒否した結果である。

## 3. 実行したケース

| リクエスト | fixture の状態 | 期待 | 観測 |
| --- | --- | --- | --- |
| `portfolio/published/cover.webp` | published project | 200 + stored metadata | PASS |
| `reactions/<sha256>.webp` | `reaction_images` の行あり | 200 immutable | PASS |
| `portfolio/draft/cover.webp` | draft project（object は実在） | 404 | PASS |
| `portfolio/archived/cover.webp` | archived project かつ `visibility = 'public'`（object は実在） | 404 | PASS |
| `portfolio/published/cover-2.webp` | 連番の推測（object は実在） | 404 | PASS |
| `private/secret.webp` | 宣言済み private namespace | 404 | PASS |
| `unlisted/thing.webp` | 未宣言 namespace | 404 | PASS |
| `reactions/<sha256>.webp` | 行の無い reaction object | 404 | PASS |
| `portfolio/published/page.html` | 承認済みだが `text/html` | 404 | PASS |
| `GET`/`HEAD` の差 | 承認済み key | HEAD は空 body | PASS |

すべての**key 付き**拒否は**空 body + `cache-control: no-store` の同一
404** である。403 も reason code も返さない — 区別できる拒否は
「その object は存在する」ことを伝える oracle になる。

key の無い prefix（`/media/`）は `:key{.+}` に一致しないため
この route には到達せず、外部 HTTP 境界の not-found
（`src/http/hono.ts` の JSON 404 + boundary の `no-store`）が
答える。この行は「route が空 key を受理しない」ことの確認であり、
上の「同一 404」契約の対象外である。

2026-10-20 の実行で `src/http/media/router.test.ts`（17 件）と
`test/integration/media-delivery.test.ts`（11 件）の計 28 件が
すべて成功した。画像の件数と時間はこの実行の JSON reporter 出力
そのものである。

## 4. キャッシュ契約

| 状況 | 返す値 |
| --- | --- |
| object に stored `Cache-Control` がある | その値（producer の決定が最優先） |
| `reactions/`（SHA-256 addressing） | `public, max-age=31536000, immutable` |
| `portfolio/`（非 addressing、unpublish が効く必要がある） | `public, max-age=3600` |
| 拒否 | `no-store` |

external boundary の既定 `no-store` は適用されない。ハンドラが
常に `cache-control` を設定するためで、`src/server.ts` の
「handler が設定したヘッダーを尊重する」規則に沿う。

## 5. 失敗時の挙動

| 条件 | 結果 |
| --- | --- |
| 不正な key（`..`、先頭 `/`、空白、query 文字、512 文字超） | 404。bucket に触れない |
| 宣言済み private namespace | 404。bucket に触れない |
| 未宣言 namespace | 404。bucket に触れない |
| public namespace だが未承認（draft・private project） | 404。bucket に触れない |
| 承認済みだが object 不在 | 404 |
| 承認済みだが content type がメディア型でない | 404 |
| 承認済み・実在・メディア型 | 200 + `content-type` / `cache-control` / `nosniff` / `etag` |

## 6. ロールバック

`wrangler.production.jsonc#vars.MEDIA_PUBLIC_BASE_URL` を
`https://media.rebuildup.dev` に戻すと、`composeMediaUrl` が
custom domain の URL を再び生成する。**コード変更なしで戻せる**が、
これは break-glass であり、custom domain の edge が key 存在=配信で
応答する状態（本 Issue が除去した状態）に戻ることでもある。

## 7. 残課題（リポジトリ外）

custom domain が bucket に接続されている限り、その hostname への
anonymous GET は Cloudflare edge が処理し、本リポジトリのコードは
1 行も実行されない。この経路を閉じるのは
**custom domain の detachment（または redirect）という operator 作業**
であり、Cloudflare アカウント設定であるため、リポジトリからは
検証できない（Decision 5 の release 前提として記録済み）。

production は `MEDIA_PUBLIC_BASE_URL` を Worker 経路に切り替えた
ため、サイトが描画する画像 URL はすべて本ゲートを通る。残るのは
「旧 hostname がまだ生きているか」だけである。

`docs/security/r2-media-visibility.md` の
[What the code does not do](../../security/r2-media-visibility.md#what-the-code-does-not-do)
に、この残課題とロールバックが同じ形で書かれている。
