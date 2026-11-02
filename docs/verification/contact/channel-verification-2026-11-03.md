# /contact channel verification — 2026-11-03

Issue #832（親: #732 / 判断コメント `6567589098` の O-1）の実測記録。
対象は `src/contact/channels.json` の 4 channel。判断は「URL 到達性」と
「連絡可否」の 2 軸を**別々に**測り、片方だけの channel は公開しない、という
O-1 の規則に従う。

- 実測日時: 2026-11-03（JST）
- 実測手段: `curl` の HTTP 応答（`-A "Mozilla/5.0"`、25 秒 timeout）と
  GitHub REST API（`repos/rebuildup/my-web-2026`）
- この記録は**到達性と連絡可否の事実**だけを持つ。owner の意向・公開範囲の
  判断は持たない。

## 結果

| channel | URL 到達性 | 連絡可否 | 公開 | 根拠 |
| --- | --- | --- | --- | --- |
| `github-rebuildup` | 200 | 不可 | **非公開** | 組織プロフィールは疎通するが、問い合わせ導線が無い（org 自身の Issues / Discussions / 公開アドレスを持たない）。 |
| `github-rebuildup-my-web-2026` | 200 | 可 | 公開 | `has_issues: true` / `has_discussions: true`、`/discussions` も 200。Issue・Discussion は実際に書き込める導線。 |
| `yusuke-kim-com` | 200 | 不可 | **非公開** | サイト自体は疎通するが `/contact` は 404、`/about` は 308 → 200 で、公開アドレス（`mailto:` 等）を持たない。 |
| `rebuildup-dev` | 200 | 不可（自己参照） | **非公開** | このページ自身の origin。`/contact` はこのページであり、循環参照になる。 |

## 実測の生値

```text
https://github.com/rebuildup                      -> 200
https://github.com/rebuildup/my-web-2026           -> 200
https://github.com/rebuildup/my-web-2026/discussions -> 200
https://yusuke-kim.com                            -> 200
https://yusuke-kim.com/contact                    -> 404
https://yusuke-kim.com/about                      -> 308 (→ 200)
https://rebuildup.dev                             -> 200
https://rebuildup.dev/contact                     -> 200 (this page)

gh api repos/rebuildup/my-web-2026
  { "has_issues": true, "has_discussions": true, "archived": false, "private": false }

mailto: links found on the three non-repository pages: 0
```

## この記録が主張しないこと

- **owner が他の連絡経路を持っていないこと**は主張しない。ここで「不可」と
  したのは、その URL 単体に連絡導線が観測できなかったという事実だけである。
  非公開にした 3 件は `active: false` として残してあり、導線が用意されれば
  `verified_at` を実測日で更新して戻せる。
- 連絡の**応答性**（返信が返るか）は測っていない。測ったのは導線の有無だけ。
- 30 日の鮮度窓そのものの再評価は行っていない（O-2 / 別 Issue）。

## 鮮度の扱い（Issue #832 の禁止事項）

「実証なしの `verified_at` 延命は禁止」なので、4 件すべてについて
**2026-11-03 に実測した**という事実だけを `verified_at` に書いた。
延命のための日付更新はしていない。非公開にした 3 件も、実測日をそのまま
残している（`active: false` のため描画対象ではない）。
