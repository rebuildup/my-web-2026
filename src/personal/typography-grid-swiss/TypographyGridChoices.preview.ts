/**
 * Typography / grid / Swiss design influence record — preview data
 * (Issue #527).
 *
 * What this module is
 * -------------------
 * The *data* behind the Storybook preview of
 * `docs/influences/typography-grid-swiss-design.md`: the same strings
 * the Markdown carries, so the preview shows the record itself and not
 * a paraphrase of it.
 *
 * Why the strings live in two places
 * ---------------------------------
 * The Markdown is the record (the canonical text). This module is the
 * preview's copy of it. A copy drifts, so
 * `scripts/check-typography-grid-choices-preview-parity.test.mjs`
 * compares the two on every `pnpm run test`: the `##` headings, the
 * `###` headings, every list item and every paragraph have to match,
 * in both directions. A heading or a decision that exists on one side
 * only is a failure, not a difference to be settled by hand — the
 * difference is recorded in the Markdown as a held item, or the
 * preview is corrected.
 *
 * What this module is NOT
 * -----------------------
 * It is not HTML and not a second authoring surface: it holds strings,
 * not markup, and it imports nothing from the repository. The story
 * renders it with the shipped `editorial` primitives only, so the
 * preview cannot reach a foreign obligation (AGENTS.md section 3).
 */

/** What one section of the record is about. */
export type InfluenceSectionKind =
	| 'scope'
	| 'evidence'
	| 'concepts'
	| 'example'
	| 'counter-example'
	| 'decision'
	| 'comparison'
	| 'open';

/** What one block inside a section is. */
export type InfluenceBlockKind =
	/** A plain rule / note list. */
	| 'list'
	/** An existing expression that satisfies a concept. */
	| 'example'
	/** A case where the concept loses its effect. */
	| 'counter-example'
	/** The strings the one-screen comparison renders. */
	| 'strings'
	/** An adopted decision. */
	| 'adopted'
	/** A held decision: `理由` / `根拠` / `解除条件`. */
	| 'held'
	/** A rejected decision: `理由` / `根拠` / `代替`. */
	| 'rejected';

/**
 * One block of a section.
 *
 * `heading` is the `###` heading in the Markdown, or `null` when the
 * block sits directly under the `##`.
 */
export interface InfluenceBlock {
	readonly heading: string | null;
	readonly kind: InfluenceBlockKind;
	/** The list items, byte-identical to the Markdown `- ` items. */
	readonly bullets: readonly string[];
}

/** One `##` section of the record. */
export interface InfluenceSection {
	/** The `##` heading, byte-identical to the Markdown. */
	readonly heading: string;
	readonly kind: InfluenceSectionKind;
	/** The one paragraph under the heading, byte-identical to the Markdown. */
	readonly lead: string;
	readonly blocks: readonly InfluenceBlock[];
}

/** The document-level metadata the preview renders above the sections. */
export interface InfluenceDocument {
	readonly title: string;
	readonly status: string;
	readonly source: string;
	readonly verification: string;
	readonly preview: string;
}

export const TYPOGRAPHY_GRID_CHOICES: {
	readonly document: InfluenceDocument;
	readonly sections: readonly InfluenceSection[];
} = {
	document: {
		title: 'スイスデザイン・タイポグラフィ・グリッドの採否記録',
		status: 'Canonical influence record',
		source:
			'Issue #527 が引用する Miro の見出し語「好きなもの > デザイン > タイポグラフィ/グリッドシステム/スイスデザイン」',
		verification: 'scripts/check-typography-grid-choices-preview-parity.test.mjs',
		preview: 'src/personal/typography-grid-swiss/TypographyGridChoices.stories.tsx',
	},
	sections: [
		{
			heading: '1. この記録が扱うもの',
			kind: 'scope',
			lead: '本記録が扱うのは「3 概念それぞれを、このサイトの視覚判断の背景としてどう使うか」であり、「画面をどう組むか」ではない。採否の判断は §6 に、根拠となる具体例は §4 に、効果を失う場面は §5 に置く。',
			blocks: [
				{
					heading: '解くと決めたこと',
					kind: 'list',
					bullets: [
						'解くと決めたこと: タイポグラフィ・グリッドシステム・スイスデザインの 3 概念は、それぞれ何を担う概念で、どこが違うのか（§3）。',
						'解くと決めたこと: このサイトが出荷する表現のうち、どの概念を「採用済み」と記録し、どの概念を「保留」「却下」と記録するか（§4 / §5 / §6）。',
						'解くと決めたこと: 1 画面を使って、表現が効果的な場面と効果を失う場面をどう比較して示すか（§7）。',
						'解くと決めた結果: 採否（採用 / 保留 / 却下）を §6 に記録する。',
						'解くと決めた結果: 概念の実例と反例を §4 / §5 に記録する。',
						'解くと決めた結果: 3 概念を 1 つのラベル（表現の俗称「スイス風」）にまとめない（§3 / §6）。',
					],
				},
				{
					heading: '解かないこと',
					kind: 'list',
					bullets: [
						'解かないこと: 公開页面の構成・surface の追加・既存 route への接続は owner 決定であり、本記録では決めない。',
						'解かないこと: token / font / color の値の変更は本記録の対象外であり、別の Issue の領域である。',
						'解かないこと: visual language の最終 authority は owner が保持する（docs/personal/owner.md）。本記録は判断の材料と記録であり、決定の代行ではない。',
						'解かないこと: Issue #380 / #381 は参照先であり、本記録の前提条件ではない。',
					],
				},
			],
		},
		{
			heading: '2. 典拠と到達範囲',
			kind: 'evidence',
			lead: '典拠は Issue #527 本文が引用した Miro の見出し語「好きなもの > デザイン > タイポグラフィ/グリッドシステム/スイスデザイン」1 行と、このリポジトリが既に保持する設計文書だけである。Miro の付箋にはアクセスできないので、付箋の本文・年表・数値・作品一覧は書かない。',
			blocks: [
				{
					heading: '書かないもの',
					kind: 'list',
					bullets: [
						'Miro の付箋にある本文・年表・数値・作品一覧。',
						'「好きなもの」「デザイン」の各段に対する、owner 以外の者による解釈。',
						'owner が書いていない好み・評価・将来の方針。',
						'特定の歴史的個人・書籍・雑誌・展覧への帰属。誰の思想としてこの movement を語るかは、この記録では確かめられない。',
						'実装していない測定値・存在しないファイル・非公開の URL。',
					],
				},
				{
					heading: '代わりに使う典拠',
					kind: 'list',
					bullets: [
						'src/editorial/layout-system.md — このサイトが出荷する唯一のグリッド（12 列 / 4・8 分割 / spacing rhythm / 型の role 表）。',
						'src/editorial/tokens.ts — 出荷する size scale と font token。',
						'src/styles.css — 日本語の折り返し契約（word-break: auto-phrase / text-wrap: pretty）と metric 互換 fallback。',
						'src/home/capabilities/grid.tsx — 現状の capability 行の組合せ（stack 型の label / summary）。',
						'src/home/capabilities/registry.ts — 比較に用いる 4 行の実データ。',
						'src/home/status/tiles.tsx — 値の幅が読めない行（label / value / badge）の組合せ。',
						'docs/personal/owner.md — visual authority は owner が保持するという根拠。',
						'docs/personal/principles.md — 観測前の obligation を作らないという判断。',
					],
				},
				{
					heading: '未確認の扱い',
					kind: 'list',
					bullets: [
						'確認できない内容は「未確認（owner 確認待ち）」と書いて、断言を保留する（§8）。',
						'「わからない」を空欄にしない。空欄は「まだ何も決まっていない」と読まれる。',
					],
				},
			],
		},
		{
			heading: '3. 3概念の区別',
			kind: 'concepts',
			lead: '3 概念は「粒度が違う 3 つの層」であり、互いに置き換えられない。タイポグラフィは 1 つの文章の読み方、グリッドシステムは要素が座る座標、スイスデザインは その座標を決める姿勢である。1 つのラベルにまとめると、姿勢の判断が見えなくなる。',
			blocks: [
				{
					heading: 'タイポグラフィが答えること',
					kind: 'list',
					bullets: [
						'一つの文章がどう読まれるか: size scale・行間・字間・measure（1 行の長さ）・階層。',
						'階層をどう作るか: 大きさ / 太さ / 字間 / 余白のどれで差を出すのか。装飾で差を出さないのか。',
						'読む側の行長がどこで上限を持つか。',
						'単位: 最小（1 つの文・1 つの行）。',
					],
				},
				{
					heading: 'グリッドシステムが答えること',
					kind: 'list',
					bullets: [
						'各要素はどの列に、どの gutter で、どの幅で座るか。',
						'複数の section で同じ座標が再現されるか（左端の key line が揃うか）。',
						'段は内容に対して多すぎるか、足りないか。',
						'単位: 中位（1 つの版面）。',
					],
				},
				{
					heading: 'スイスデザインが答えること',
					kind: 'list',
					bullets: [
						'装飾と内容のうちどちらが主か（objective / 内容優先）。',
						'非対称（asymmetry）を強調するか、中心で揃えるか。',
						'グリッドは構成として組み込まれる invisible な構造か、見える線として描かれるか。',
						'「風」という呼称（見た目）で語れるか、それとも規則として語れるか。',
						'単位: 最大（設計の姿勢そのもの）。',
					],
				},
				{
					heading: '3 概念が混同されるとき',
					kind: 'list',
					bullets: [
						'「スイス風」とだけ言って画面を作り直すと、姿勢ではなく見た目のコピーになる。',
						'見た目のコピーは、このサイトの日本語本文・禁則処理・token 契約を変えない。見た目を写しても、既存の規則はそのまま残る。',
						'逆に「グリッドがある」だけでは充分ではない: 配置の再現性は必要だが、内容優先の姿勢（装飾の抑制）は別の判断である。',
						'本記録は 3 概念を別々の層として扱い、1 つのラベルにまとめない。',
					],
				},
			],
		},
		{
			heading: '4. サイトの具体例（採用済みの表現）',
			kind: 'example',
			lead: 'このサイトが出荷する visual 表現のうち、3 概念に相当するものは既に存在する。下の 4 例は「概念の採用」ではなく「既存表現の確認記録」であり、参照先はすべてこのリポジトリのファイルである。',
			blocks: [
				{
					heading: '具体例 1: グリッド — 12 列 / 4・8 分割',
					kind: 'example',
					bullets: [
						'参照: src/editorial/layout-system.md §3.1。',
						'表現: Container（max-width 1024px）がページ幅を拘束し、SectionHeading variant="spread" が 4/12 の title span と 8/12 の content span に分ける。',
						'効果: 複数の section で「見出しの左端」と「本文の左端」が同じ x に揃う（key line）。',
						'注記: 同文書は「Do not introduce a competing grid」と明言しており、 competing grid の追加は認めない。',
					],
				},
				{
					heading: '具体例 2: タイポグラフィ — 階層を size と字間だけで作る',
					kind: 'example',
					bullets: [
						'参照: src/editorial/layout-system.md §3.4。',
						'表現: section h2 は 2xl、card / row の h3 は xl、本文は md。階層は大きさと字間（h2 は -0.025em）で作り、色や枠で補強しない。',
						'効果: 「section 見出し → 行の見出し → 本文」が 1 つの scale の上で連続し、装飾が減る。',
					],
				},
				{
					heading: '具体例 3: スイスデザイン（内容優先の面）— 囲み罫線を公開面の装飾にしない',
					kind: 'example',
					bullets: [
						'参照: src/editorial/layout-system.md §1。',
						'表現: 公開面は box ではなく grid + 余白で組む。囲み罫線と背景は state のある UI（ボタン / 空・失敗 state / code block）にだけ残す。',
						'効果: 余白が section 間の距離を担い、枠がページから消える。装飾が内容より前に出ない。',
					],
				},
				{
					heading: '具体例 4: 効果の確認 — 数値は既存の測定記録だけを参照する',
					kind: 'example',
					bullets: [
						'参照: src/editorial/layout-system.md §3.1。',
						'表現: 同文書は「all public pages screenshotted at 1280 px and 375 px, element boxes measured with Playwright boundingBox()」と測定方法まで記し、title span 306.67px / content span 613.33px（1280px viewport）を数値で残す。',
						'効果: 「4/8 分割が視覚的に見えるか」を印象ではなく key line の座標で議論できる。',
					],
				},
			],
		},
		{
			heading: '5. 効果を失う場面（反例）',
			kind: 'counter-example',
			lead: '3 概念を「規則」として適用すると、表現の効果が失われる場面がある。下の 3 例は、このサイトの既存表現がその形である理由を、概念の側から説明するものである。いずれも「この規則を採らない」ではなく「この規則を既にある別の規則の所有者に重ねない」である。',
			blocks: [
				{
					heading: '反例 1: グリッドを型で固定すると、値の幅が読めない行が崩れる',
					kind: 'counter-example',
					bullets: [
						'参照: src/editorial/layout-system.md §3.1、src/home/status/tiles.tsx。',
						'場面: label / value / badge のように値の幅が読めない行に固定幅の段を当てると、桁の位置がそろわず比較しにくくなる。',
						'既存表現: status 行は label 列を内容に合わせて広げる（minmax(0, auto) minmax(0, 1fr) auto）ので、3 cell が 1 行に収まる。',
						'効果の喪失: グリッドの再現性（同じ左端）を優先すると、値の比較可能性（桁の桁揃え）を失う。',
						'教訓: グリッドは「再現される座標」であって「すべての段を同じ型にする」義務ではない。',
					],
				},
				{
					heading:
						'反例 2: 欧文向けの組版規則は、日本語の折り返しを既に所有している部分と二重になる',
					kind: 'counter-example',
					bullets: [
						'参照: src/styles.css（word-break: normal → auto-phrase、text-wrap: pretty）、src/editorial/layout-system.md §3.4。',
						'場面: 「1 行 45〜75 文字」のような欧文の組版経験則を日本語本文の measure 基準にそのまま当てると、ブラウザの phrase 解析（auto-phrase）と二重に歩く。',
						'既存表現: 日本語本文の折り返しはブラウザに任せ、title は text-wrap: balance、description は text-wrap: pretty で孤児行を避ける。measure は 640px の cap で制限する。',
						'効果の喪失: 欧文組版の規則を足すと、既に制御されている部分を二重に制御することになる（§7 で実測して示す）。',
						'教訓: 組版の規則を移植するときは、その規則が制御している対象を既に誰の担当かが決まっているかを確認する。',
					],
				},
				{
					heading: '反例 3: グリッドを線として描くと、構造が装飾になる',
					kind: 'counter-example',
					bullets: [
						'参照: src/editorial/layout-system.md §1 / §3.5。',
						'場面: 12 列の縦線やベースライン線を描くと、グリッドが「構造」ではなく「装飾」になる。',
						'既存表現: グリッドは key line（左右端の x 座標）として確認するもので、線は引かない。区切りは padding beat と、必要な場所だけの hairline である。',
						'効果の喪失: 構造を説明するために構造を出すと、余白が担っていた rhythm が壊れる。',
						'教訓: 「グリッドを構成として組み上げる」態度の実施は、グリッドを線にすることではない。',
					],
				},
			],
		},
		{
			heading: '6. 採否記録',
			kind: 'decision',
			lead: '3 概念それぞれについて、採用・保留・却下を記録する。判断の根拠は §4 の具体例と §5 の反例であり、visual language の最終 authority は owner が保持する（docs/personal/owner.md）。保留の各項目は「理由 / 根拠 / 解除条件」の 3 行で記録し、却下は「理由 / 根拠 / 代替」の 3 行で記録する。',
			blocks: [
				{
					heading: '採用',
					kind: 'adopted',
					bullets: [
						'採用: タイポグラフィ — 階層は size scale と字間だけで作る（§4 具体例 2）。既存表現の記録であり変更しない。',
						'採用: グリッドシステム — 公開面共通の 12 列 / 4・8 分割を唯一の座標系にする（§4 具体例 1）。既存表現の記録であり変更しない。',
						'採用: スイスデザイン（内容優先の面）— 公開面の装飾を grid + 余白に置き、枠を state のある UI だけに残す（§4 具体例 3）。既存表現の記録であり変更しない。',
						'採用: 効果の確認方法 — 印象ではなく key line の座標と測定記録で議論する（§4 具体例 4）。既存表現の記録であり変更しない。',
					],
				},
				{
					heading: '保留',
					kind: 'held',
					bullets: [
						'保留: 欧文の Grotesk 書体への差替え（見た目を Cleaner にする）。',
						'理由: visual appearance は owner の authority であり、書体の差替えは日本語 fallback チェーン（src/styles.css の metric 互換 fallback）と token を含む変更になるため、token 移植の Issue になる。',
						'根拠: 「スイス風」を欧文の見た目で表現する典型的な取り違え（§3 / §5）。token を持ち込むと Issue #527 の「token 移植ではない」方針に反する。',
						'解除条件: owner が visual authority として差替えの方向を表明し、token 移植の別 Issue が立ったとき。',
					],
				},
				{
					heading: '却下',
					kind: 'rejected',
					bullets: [
						'却下: 「スイス風」というラベルだけで見た目を模倣すること。',
						'理由: 3 概念は層が違い、見た目だけを模倣すると姿勢の判断を代替しない（§3）。既存表現のどれとも一致しない表現になる（§4 / §5）。',
						'根拠: 本サイトが出荷する具体例（§4）は、いずれも「見た目の特徴」ではなく「規則」として記述できる。規則として記述できないものを採用しない。',
						'代替: 採否は 3 概念ごとに §6 の形で記録し、画面は §7 の比較で規則の効果を確かめる。',
					],
				},
			],
		},
		{
			heading: '7. 1 画面の before / after',
			kind: 'comparison',
			lead: '採否の判断は画面の比較で確かめる。下の 2 画面は同じ文字列で、before は現状の組合せ、after は 3 概念を規則として適用した組合せである。どちらも既存 surface を変更しない。',
			blocks: [
				{
					heading: '比較対象の文字列',
					kind: 'strings',
					bullets: [
						'eyebrow: 01 — Capabilities',
						"見出し: できごと / What's here",
						'説明: 個人 Platform の機能領域。公開状態は各 capability の badge を正として、順に組み立てていく。',
						'行 1: ポートフォリオ / 主要な作品と、その解説・ソースへのリンク。 / live',
						'行 2: ツール / 単体で動作する Web ツール群。Tool Registry 経由で統合。 / live',
						'行 3: コンテンツ / 長めのノートや記事。RSS と JSON フィードで配信。 / planned',
						'行 4: アクティビティ / 最近のコミット・リリース・出荷した仕事を 1 本のタイムラインに。 / planned',
					],
				},
				{
					heading: 'before と after の違い',
					kind: 'list',
					bullets: [
						'before: 現状の組合せ。段は spread の 4/8、行は label と summary の積み上げ（src/home/capabilities/grid.tsx と同じ形）。',
						'after: 3 概念を規則として適用。行を content span 内の 1/3・2/3 の sub-grid に置き、label を support tier（小さい型 + 字間）に落として、value を主役にし、装飾を増やさない。',
						'変わらないもの: 文字列、token 値、Container の幅、spread の 4/8 分割、装飾を増やさないという方針そのもの。',
					],
				},
				{
					heading: '効果を失う場面の比較',
					kind: 'counter-example',
					bullets: [
						'反例 1: after と同じ固定 sub-grid を status 行（label / value / badge）に当てると、label 列が内容幅ではなく固定幅になり、value が折り返す。既存表現（src/home/status/tiles.tsx）は label 列を内容に合わせる。',
						'反例 2: 欧文向けの組版規則（measure を 45〜75 文字の基準で決め、leading を広げる）を日本語本文に足すと、auto-phrase と text-wrap: pretty が既に制御している部分と二重になり、同じ内容が行数だけ増える。',
						'見方: 同じ Storybook の中で、before / after と 2 つの反例を縦に並べて比較する。',
					],
				},
				{
					heading: '機械検証',
					kind: 'list',
					bullets: [
						'一致検証: scripts/check-typography-grid-choices-preview-parity.test.mjs が、Markdown の ## 見出し・### 見出し・箇条書き・段落と、preview データの heading / bullets / lead を突き合わせる。',
						'比較対象の文字列: 同じ test が、比較に用いた文字列が Markdown にも preview にも同じ形で存在することを確認する。',
						'検証画像: docs/verification/influences/typography-grid-choices.webp（shipped story を local harness で描画し、Playwright で撮影して sharp で WebP 化したもの）。',
						'再現: node scripts/capture-typography-grid-choices.mjs',
					],
				},
			],
		},
		{
			heading: '8. 未確認（owner 確認待ち）',
			kind: 'open',
			lead: '次は Miro にも owner にも確認できないため、現時点では 未確認（owner 確認待ち） とする。空欄にはしない。',
			blocks: [
				{
					heading: '未確認の項目',
					kind: 'list',
					bullets: [
						'Miro の付箋の全文。「好きなもの > デザイン > タイポグラフィ/グリッドシステム/スイスデザイン」以外の年表・数値・作品・評価。',
						'スイスデザインを visual language の目標として取り入れるか否か（visual authority は owner が保持する）。',
						'欧文 Grotesk 書体への差替えの是非（§6 保留）。',
						'比較対象の画面をどの section にすべきか（§7 は capabilities 系の section を素材にした）。',
						'この採否記録が owner の判断と一致しているか。',
					],
				},
				{
					heading: 'この Issue がやらないこと',
					kind: 'list',
					bullets: [
						'公開页面の追加・改稿、既存 surface への接続。',
						'token / font / color の値の変更。',
						'owner の承認記録の作成（copy editorial approval の承認は owner が書く）。',
						'Miro 由来の情報の創作。',
					],
				},
			],
		},
	],
};

/** One row of the compared screen. */
export interface ComparisonRow {
	/** The row's Japanese label — the shipped `labelJa` value. */
	readonly label: string;
	/** The row's Japanese summary — the shipped `summaryJa` value. */
	readonly value: string;
	/** The shipped badge word (`live` / `planned`). */
	readonly status: string;
	/** The badge tone the shipped section uses for that status. */
	readonly tone: 'accent' | 'neutral';
}

/** The one screen the record compares, before and after. */
export interface ComparisonScreen {
	readonly eyebrow: string;
	readonly title: string;
	readonly description: string;
	readonly rows: readonly ComparisonRow[];
}

/**
 * The compared screen.
 *
 * The strings are the SHIPPED ones — `src/home/capabilities/registry.ts`
 * holds the four rows and `src/home/capabilities/grid.tsx` holds the
 * section heading — so the comparison is between two treatments of the
 * same content, not between two invented contents.
 *
 * The row order, the label, the summary and the badge word are the
 * shipped ones; the Markdown's "比較対象の文字列" block lists the same
 * strings, and the parity test proves the two agree.
 */
export const COMPARISON_SCREEN: ComparisonScreen = {
	eyebrow: '01 — Capabilities',
	title: "できごと / What's here",
	description:
		'個人 Platform の機能領域。公開状態は各 capability の badge を正として、順に組み立てていく。',
	rows: [
		{
			label: 'ポートフォリオ',
			value: '主要な作品と、その解説・ソースへのリンク。',
			status: 'live',
			tone: 'accent',
		},
		{
			label: 'ツール',
			value: '単体で動作する Web ツール群。Tool Registry 経由で統合。',
			status: 'live',
			tone: 'accent',
		},
		{
			label: 'コンテンツ',
			value: '長めのノートや記事。RSS と JSON フィードで配信。',
			status: 'planned',
			tone: 'neutral',
		},
		{
			label: 'アクティビティ',
			value: '最近のコミット・リリース・出荷した仕事を 1 本のタイムラインに。',
			status: 'planned',
			tone: 'neutral',
		},
	],
};

/**
 * The Japanese paragraph the typographic comparison measures.
 *
 * It is the record's own section 5 lead paragraph, so the comparison
 * uses text this repository already owns, and the parity test proves
 * the two are the same string.
 */
export const COMPARISON_PARAGRAPH: string =
	'3 概念を「規則」として適用すると、表現の効果が失われる場面がある。下の 3 例は、このサイトの既存表現がその形である理由を、概念の側から説明するものである。いずれも「この規則を採らない」ではなく「この規則を既にある別の規則の所有者に重ねない」である。';

/** One row of the home status surface. */
export interface StatusRow {
	/** The service label the status surface shows. */
	readonly label: string;
	/** The binding name the status surface shows next to the label. */
	readonly binding: string;
	/** The service description the status surface shows. */
	readonly detail: string;
}

/**
 * The status rows the first counter-example renders.
 *
 * The strings are the SHIPPED ones — `src/home/status/services.ts` holds
 * them — so the counter-example compares two treatments of the shipped
 * status rows. The parity test reads the shipped registry and proves
 * that these three rows are exactly it.
 */
export const STATUS_ROWS: readonly StatusRow[] = [
	{
		label: 'External boundary',
		binding: 'Hono',
		detail: 'Public REST endpoints at /api/v1/*.',
	},
	{
		label: 'Internal data',
		binding: 'D1',
		detail: 'Structured content queried via createServerFn.',
	},
	{
		label: 'Media',
		binding: 'R2',
		detail: 'Blob storage for media and assets.',
	},
];
