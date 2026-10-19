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
  | 公開SSR HTML | owner未承認のフィールド名・**3桁以上の小数**座標ペア・`geo:` URI が含まれない（`/` `/about` `/contact` `/portfolio` `/portfolio/<public>` `/tools` `/tools/text-counter` `/tools/prototype` `/design-system`）。粗い座標（`35.1, 139.7`）や整数座標は precision over recall の方針で検出対象外 |
  | 公開 JSON | `/api/v1/*` の 200 / 404 / 401 レスポンスに同じ語彙が含まれない |
  | Analytics | GA4 bootstrap は measurement ID のみ、`page_view` は `page_path` 系のみ |
  | 非公開状態（storage → 公開 response） | `PRIVATE_OWNER_RECORD` の値を持つ行が `visibility='draft'` で D1 に実在し、`/portfolio` と `/portfolio/<slug>` のレスポンスには title / venue / 座標が一切現れない。slug 直叩きは 404 |
  | 公開用代替表示 | 非公開でも surface は空にならない。`/portfolio` は `published + public` の行を提示し続ける。Home も既存の Activity capability を `planned` として提示し続ける |
  | 非空虚性 | 検出器が fixture に対して実際に発火する。加えて、private 行が D1 に**存在する**ことも assert する（書けていなければ「response に無い」は無意味になる） |

- **実行手順**

  ```bash
  pnpm exec vitest run test/integration/privacy-projection.test.ts
  ```

- **受け入れ条件の状態**

  Issue #511 の「非公開設定時に GPS・私的イベント名がレスポンスから
  消え、公開用代替表示が残る」は、**このリポジトリが出荷している
  publication boundary については検証済み**である。

  唯一の公開境界は portfolio の公開 projection
  （`src/portfolio/load.ts` の
  `status = 'published' AND visibility = 'public'`）で、suite は
  `PRIVATE_OWNER_RECORD` の値を持つ行を `visibility = 'draft'`
  で D1 に書き化し、次を request-level で assert する。

  1. その行が storage に実在し、検出器がその行に対して発火する
     （抑制の主張が空振りしないための非空虚性）。
  2. `/portfolio` は `published + public` の行を提示し続ける一方、
     private 行の title / venue / 座標がレスポンスに現れない。
  3. slug を直叩きしても `/portfolio/<private>` は 404 で、private
     記録のどの部分も運ばない。

  一方、**現在地 / 活動 / カレンダー slice 自体には publication
  policy が存在しない**。`visibility` 列は portfolio の公開列だけで、
  location / activity / calendar 用の `visibility` スイッチ・admin
  トグル・非公開スケジュール storage は `src/**` に無い。この slice を
  どの状態で公開するかは owner 決定であり、agent が意味を実装すれば
  Issue が要求していない機能を捏造することになる。

  よって条件は「**存在する publication boundary について met /
  未実装の slice について open**」。owner が次をどちらかに決めるまで
  latter は open のまま。

  - **(a) publication policy を実装する**: location / activity /
    calendar 用に `visibility` スイッチ / admin トグル / 非公開
    スケジュール storage を追加し、private-state の request-level
    case をこの suite に追加する（上の portfolio 側の case と同じ形）。
  - **(b) Issue #511 の当該 slice を明示的に descope する**: この PR を
    「公開面の回帰契約 + 検出器の非空虚性契約 + 出荷済み publication
    boundary の抑制契約」として受け入れる。

  なお `src/editorial/structured-data/contract.json` の
  `person.unapprovedProperties` は、同じ「公開するしない」を
  理由付きで宣言する既存の先例であり、**(a)** で publication policy を
  決めたときの置き場所は同ファイルである。

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

  `src/routes/**` の public route file ごとに 1 サンプル:
  `index.tsx` → `/`、`about.tsx` → `/about`、`contact.tsx` → `/contact`、
  `portfolio/index.tsx` → `/portfolio`、
  `portfolio/$slug.tsx` → `/portfolio/privacy-fixture-public`、
  `tools.index.tsx` → `/tools`、`tools.$slug.tsx` →
  `/tools/text-counter` と `/tools/prototype`、
  `design-system.tsx` → `/design-system`。

  `/about` と `/portfolio` は portfolio D1 schema を bootstrap する
  ことで 200 を返すので、**除外ではなくスキャン側に倒している**
  （schema は `test/integration/fixtures/portfolio-d1.ts`（Issue #422）
  の共有 fixture から使い、migration のコピーを二重に持たない）。

- **対象外**

  - `/admin/**`。auth boundary の内側であり公開面ではない。admin 経路に
    位置情報を載せる場合の publication 判断は owner 決定待ち（**(a)**）。
  - publication policy の実装そのもの（location / activity / calendar
    slice の `visibility` スイッチ、admin トグル、非公開スケジュール
    storage）。owner 決定が必要で、本 PR では実装しない。
  - 多言語表示。
  - この suite の D1 bootstrap が production と一致しない差分。
    `reaction_images`（`0003`）と access counter の
    `0002`/`0005`/`0006` を作らない。加えて
    `src/home/access/load.ts` は `/api/v1/access/*` へ self-call するが、
    この pool では outbound fetch が pool 外に出るため
    （`[home.access.*] upstream failed`）、`/` の access-counter
    タイルは空 / 縮退表示になる。いずれも「どの行があるか」の差であり、
    公開面が持ちうる owner 未承認データの差ではない。portfolio 側は
    private 行を**意図的に**持つため、ここだけは production と違い、
    それが検出の前提になっている。

- **将来の手作業**

  1. 位置情報 / 活動 feature の着地時、実装側が `PRIVATE_OWNER_RECORD` を
     参照して「公開 projection に含めてはいけない」を test から強制する。
  2. publication policy を owner が確定したら、同じ検出器を admin 経路と
     storage 境界にも拡張し、private-state の request-level case を
     この suite に追加する（**(a)**）。既存の portfolio 側の case が
     そのときの実装范例になる。
  3. public route を追加したら `PUBLIC_SSR_PATHS` に path を足す
     （route file ごとに 1 サンプル）。逆に 200 を返さなくなった path を
     黙って外さない。
  4. 「`docs/verification/**` の生成器を commit するか」を owner が決定したら、
     本レポートの生成器を `scripts/` へ移す。

---

## `publication-redaction-review.webp` / `.md`

Issue #494 — 移行（Miro / 旧サイト / Notion）した文章と画像について、
個人情報（住所・連絡先・第三者の人物名・画像メタデータ）の候補を機械的に
抽出し、公開可否は owner だけが決められるようにする review。

- **判定基準**

  | 対象 | 基準 |
  | --- | --- |
  | private サンプル | 候補を持つ record は `decision` が `approved` / `review_required` / `rejected` のいずれかでなければ公開 bundle に出ない。承認には `decided_by: "owner"` と空でない `basis` が必要 |
  | public bundle | owner 承認済みの record だけが `title` / `text` / `images` を**まるごと**提供する。字段単位の redact は提供しない（部分書き換えは残った参照が壊れるため） |
  | 公開 content root | `copy` / `public` / `src/about` / `src/portfolio`。保留 record の内容が現れれば `E001`、承認済み record がカバーしない候補が現れれば `E005` |
  | 検出規則 | `D001`-`D011`。各規則は「意図的に一致させないもの」を持つ（precision over recall） |
  | 非空虚性 | 検出器が 1 つも候補を作らない corpus は `E008` で fail。正の fixture（private サンプル）と負の fixture（clean record）の両方が発火 / 非発火であることを test が固定する |
  | 非公開 | レポートと CI 出力に出るのは規則 id・フィールド・オフセット・masked 形状のみ。生の候補値はプロセス外に出ない |

- **実行手順**

  ```bash
  pnpm run publication:redaction:check   # gate（validate:fast の一部）
  pnpm run publication:redaction:write   # レポートの再生成
  pnpm run verify:publication-redaction-screenshot
  node --test scripts/check-publication-redaction.test.mjs
  ```

- **スクリーンショットの意味**

  `publication-redaction-review.webp` は上記 gate の HTML レポートを
  chromium で撮影した検証画像である。表示しているのは
  (1) 公開する情報、(2) 外部通信（なし）、(3) 依存（`node:fs` のみ）、
  (4) 監査対象、(5) 検出規則表、(6) レコード別 review 結果、
  (7) findings。**Private sample の生値は写っていない**（masked 形状のみ）。

- **残存リスク（画像の範囲）**

  OCR は行わない。顔・撮影された書類・手書きの住所は画像の中に残り、
  owner の目視判断が必要になる。`public/share/**`（`/share/<slug>/` の
  static document surface）は対象外で、その理由は
  `scripts/check-publication-redaction.mjs` と
  `quality/profile.yaml#personal_data_review` に明記している。

- **詳細**

  [`docs/security/personal-data-redaction.md`](../../security/personal-data-redaction.md)
