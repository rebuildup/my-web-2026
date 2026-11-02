# production smoke の陳腐化した期待値 — 実測と修正（Issue #816）

- 対象: `scripts/prod-smoke-routes.mjs`、`e2e/prod-smoke.spec.ts`、
  `scripts/prod-smoke-routes.test.mjs`、`e2e/prod-portfolio.spec.ts`
- 契機: v0.8.0 の持ち越し「production smoke の期待値 5 件が陳腐化している」
  （owner 判断 D16「別 issue」）
- 状態: 実装・実測済み。陳腐化していた **3 件**を修正し、残る **3 件**は
  リリースブランチの事実（deploy 後に green になる）と確定した

## 1. 実測（着手前）

`release-0-8-1`（`4778028c`）の作業ツリーから、本番
`https://rebuildup.dev` に対して実行した。

```text
$ pnpm run e2e:prod            # Smoke #2 (versioned)
4 failed, 12 passed, 1 skipped

$ pnpm run e2e:prod:portfolio  # release-window post-publish
3 failed, 6 passed
```

失敗の内訳:

| # | test | 観測 | 原因 |
| --- | --- | --- | --- |
| 1 | Home `/` の documented default state | `<title>` が `my-web-2026 — rebuildup.dev`、期待は `/^my-web-2026$/` | **期待値が古い**（#418 で title に origin suffix が付いた） |
| 2 | 同上 | `homeSections=false`（本番 6 セクション、期待 7） | release branch の事実（#316 が未 deploy） |
| 3 | Tools `/tools` の documented default state | `<h1>` が `ツール / Tools`、期待は `/^ツール$/` | release branch の事実（#785 が未 deploy） |
| 4 | transport security (Issue #446) | `TypeError: res.headerValues is not a function` | **コードの誤り**（`request.get()` は `APIResponse` を返し、`headerValues()` を持たない） |
| 5 | PublicNav siblings | `/tools` に PublicNav が無い | release branch の事実（#785 が未 deploy） |
| 6–8 | portfolio OGP ×3 | `og:image` が `https://rebuildup.dev/media/...`、期待は `https://media.rebuildup.dev/...` | **期待値が古い**（#634 で配信が `/media` に移った） |

「5 件」という前提は実測と合わない。**古い期待値は 3 件**（1 / 4 / 6–8）、
残り 3 件は**未 deploy のリリースブランチの事実**である。#4 は期待値の
陳腐化ではなく、テストが一度も assertion に到達していなかった実行時エラー
だった（`headerValues` を呼んだ時点で TypeError）。

### 1.1 毎日の scheduled smoke も同じ 2 件で赤い

`.github/workflows/prod-smoke.yml` は `main` を checkout して
`pnpm run e2e:prod` を回す。#733 (V-4) の daily pass は、2026-11-01 の
run `41354996786`（`schedule`, `93b999dd`）で **failure** になっており、
失敗は次の 2 件だけだった。

```text
✘ Home — / serves its documented default state
  - HTTP /: <title> "my-web-2026 — rebuildup.dev" does not match /^my-web-2026$/
✘ the canonical origin serves a host-scoped HSTS directive
  TypeError: res.headerValues is not a function
```

`main` は `93b999dd`（= v0.8.0 の deploy commit）なので、セクション数や
`/tools` の h1 は本番と一致する。つまり **main の smoke を赤くしているのは
この 2 件だけ**であり、日次診断が「常に赤い」状態が続いていた。

## 2. 何を直したか（陳腐化 3 件）

1. `scripts/prod-smoke-routes.mjs` の `/` の `titlePattern` を
   `/^my-web-2026 — rebuildup\.dev$/` にした。`<h1>` は
   `/^my-web-2026$/` のまま（title と h1 は別の事実）。
   `scripts/prod-smoke-routes.test.mjs` の fixture も同じ title に直した
   （fixture は registry の pattern から導出しない方針なので手で書く）。
2. `e2e/prod-smoke.spec.ts` の HSTS 検査を `res.headersArray()` からの
   抽出に直した。`APIResponse` には `headerValues()` が無い。
   複数値（Cloudflare の zone-level HSTS と Worker の policy）を全部見る
   意図は変えていない。
3. `e2e/prod-portfolio.spec.ts` の `MEDIA_ORIGIN` を
   `https://rebuildup.dev/media` にし、`og:image` の正規表現と
   メッセージをそこへ揃えた。#634 以降、公開 media は Worker の
   `/media/<key>` が配信し、R2 custom domain `media.rebuildup.dev` は
   どのページからも参照されない残置である。

## 3. 判定（前 / 後）

| 時点 | `e2e:prod` | `e2e:prod:portfolio` |
| --- | --- | --- |
| 着手前（`release-0-8-1`） | 4 failed / 12 passed / 1 skipped | 3 failed / 6 passed |
| 修正後 | **3 failed** / 13 passed / 1 skipped | **9 passed** |

修正後の 3 件はすべて §1 の「release branch の事実」であり、
失敗メッセージから `<title>` と HSTS の行が消えている（＝陳腐化した
期待値は残っていない）。

## 4. 残る 3 件は修正していない（意図的）

| 項目 | 期待値 | いつ通るか |
| --- | --- | --- |
| Home のセクション数 7 | `EXPECTED_SECTION_COUNTS['/'] = { labelled: 7 }` | 0.8.1 が本番に deploy された後 |
| `/tools` の `<h1>` | `/^ツール$/` | 同上（#785） |
| `/tools` の PublicNav | chrome-nav route | 同上（#785） |

これらは**リリースブランチの事実**であり、deploy 前の本番に対して
赤くなるのが正しい。gate を弱めて通す（`transition` phase に落とす、
期待値を 6 に戻す）ことはしていない。根拠: 同じ `4778028c` の CI run
`41369142967`（push, `release-0-8-1`）は `validate` が success で、
ローカルの Playwright suite は 7 セクション（`e2e/smoke.spec.ts`）と
`/tools` の PublicNav（`e2e/nav.spec.ts`）を assert している。

## 5. 再現

```bash
pnpm run e2e:prod
pnpm run e2e:prod:portfolio
node --test scripts/prod-smoke-routes.test.mjs
```

`e2e:prod` / `e2e:prod:portfolio` は本番に対して read-only である
（D1 / R2 への書き込み、auth の変更、cookie の reset を行わない）。

## 6. 残るリスク

1. **deploy までは 3 件赤い。** 0.8.1 が main に届くまで、`release-0-8-1`
   からの `e2e:prod` は 3 件で赤くなる。deploy 後に green になることは
   ローカル suite と上記 CI run で裏づけられているが、本番での確認は
   deploy 後にしかできない。
2. **日次 smoke は main を見る。** 今回の 2 件の修正が main に届くのは
   0.8.1 の release 後である。それまでの daily pass は同じ 2 件で赤い
   ままになる（main を直接直す経路は採らない）。
3. **portfolio spec は release 時にしか走らない。** `e2e:prod:portfolio`
   を release 手順から外すと、この種の陳腐化は再び見えなくなる。
