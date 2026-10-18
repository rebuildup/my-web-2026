# Verification artifacts

Each file here is the **record of one verification run**, not a
substitute for it. The suite named in each report is the authority:
re-run it and the artifact is regenerated, and if the artifact and the
suite disagree, the suite wins.

## `location-private-fallback.webp`

Issue #511 — owner-unapproved location / schedule data must not reach
public SSR HTML, `/api/v1/*` JSON, or the GA4 analytics payload, and
the surface must still show something when the data is private.

- **判定基準**

  | 対象 | 基準 |
  | --- | --- |
  | 公開SSR HTML | owner未承認のフィールド名・座標ペア・`geo:` URI が含まれない（`/` `/contact` `/tools` `/tools/text-counter` `/design-system`） |
  | 公開 JSON | `/api/v1/*` の 200 / 401 レスポンスに同じ語彙が含まれない |
  | Analytics | GA4 bootstrap は measurement ID のみ、`page_view` は `page_path` 系のみ |
  | 公開用代替表示 | 非公開でも surface は空にならない（Home は Activity を `planned` として提示し続ける） |
  | 非空虚性 | 検出器が fixture に対して実際に発火する |

- **実行手順**

  ```bash
  pnpm exec vitest run test/integration/privacy-projection.test.ts
  ```

- **受け入れ条件の状態**

  Issue #511 の「非公開設定時に GPS・私的イベント名がレスポンスから
  消え、公開用代替表示が残る」は、publication policy
  （`visibility` スイッチ / 非公開スケジュール storage / admin トグル）が
  `src/**` に存在しないため、**この PR では検証していない（未達・owner 決定）**。
  この suite が固定するのは次の 2 つであり、「非公開時に抑制される」
  ことの実証ではない。

  1. 現存する公開面（SSR HTML・`/api/v1/*` JSON・GA4 payload）が
     owner 未承認の location / schedule データを運ばない**回帰契約**。
  2. その判定に使う検出器が fixture に対して実際に発火する
     **非空虚性契約**。

  条件を満たすには owner が publication policy を決定し、
  private-state の request-level case を suite に追加する必要がある。
  それまでは「公開面に非公開データが無い」ことだけを保証する。

- **画像について**

  CI レポート形式のレンダリング結果。dev サーバーは Infisical の
  secret に依存するため、このリポジトリの作業環境からは実画面を
  起動できない。画像は補助資料であり、判定は CI の `validate` job
  が担う。

  生成手順は「vitest の JSON 出力 → report HTML → Chromium で
  1440px 撮影 → WebP (quality 80)」だが、その helper は `.tmp/` 配下
  （gitignore 対象）に置いており **未 commit**。同種のアーティファクトでは
  `scripts/make-d1-verification-report.mjs`（Issue #452）が生成器を
  commit している。「`docs/verification/**` の生成器を commit するか」は
  owner の規約決定として未確定のため、ここでは判断せず記録のみ行う。

- **スキャン対象の公開SSR HTML**

  `/` `/contact` `/tools` `/tools/text-counter` `/design-system`。
  `/tools/$slug` は loader が build 時 Tool manifest を読むだけ、
  `/design-system` は loader を持たず、どちらも D1 を要求しないので
  この pool で 200 を返す。公開 nav に載る面なので「未スキャン」を
  受け入れる側ではなくスキャン側に倒している。

- **対象外**

  - `/about` / `/portfolio` / `/portfolio/$slug` の HTML（loader が
    portfolio D1 schema を要求し、対象 suite は reactions のみ
    bootstrap するため 500）。該当 route の描画は既存の D1 / R2
    integration suite が所有。この除外は
    `describe('excluded surfaces stay excluded')` で「非 200 であること」
    として assert してあり、主張を prose だけにしない。
  - publication 設定の実装（`visibility` スイッチ、admin トグル、
    非公開スケジュール storage）。owner 決定が必要で、本 PR では
    実装も private-state の検証もしない。
  - 多言語表示。
  - この suite の D1 bootstrap が production と一致しない差分。
    `reaction_images`（`0003`）と access counter の
    `0002`/`0005`/`0006` を作らない。加えて
    `src/home/access/load.ts` は `/api/v1/access/*` へ self-call するが、
    この pool では outbound fetch が pool 外に出るため
    （`[home.access.*] upstream failed`）、`/` の access-counter
    タイルは空 / 縮退表示になる。いずれも「どの行があるか」の差であり、
    公開面が持ちうる owner 未承認データの差ではない。

- **将来の手作業**

  1. 位置情報 / 活動 feature の着地時、実装側が `PRIVATE_OWNER_RECORD` を
     参照して「公開 projection に含めてはいけない」を test から強制する。
  2. publication policy を owner が確定したら、同じ検出器を admin 経路と
     storage 境界にも拡張し、private-state の request-level case を
     この suite に追加する（Issue #511 の条件はその時点で初めて検証可能になる）。
  3. `/about` `/portfolio` `/portfolio/$slug` も HTML スキャン対象にする場合は、
     portfolio D1 schema の bootstrap をこの suite へ追加するか、共通 fixture へ
     切り出す。
  4. 「`docs/verification/**` の生成器を commit するか」を owner が決定したら、
     本レポートの生成器を `scripts/` へ移す。
