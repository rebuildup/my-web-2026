/**
 * Brand name meanings preview data (Issue #521).
 *
 * What this file is
 * -----------------
 * The read-only content of the "361do" brand naming note
 * (`docs/brand/361do-name-meanings.md`), kept as DATA so the Storybook
 * preview and the document cannot drift apart. Every `heading` below is
 * byte-identical to the `##` heading of the same section in that
 * document, and every `points` entry is byte-identical to one bullet
 * line of that section.
 *
 * The parity between the two is not a convention: it is checked by
 * `scripts/check-brand-name-meanings-preview-parity.test.mjs`, which
 * fails when a section, a heading or a bullet exists on one side only.
 *
 * What this file is NOT
 * ---------------------
 * It is not approved site copy. The "公開案（短い説明の候補）" section
 * holds CANDIDATES; which one (if any) is published is an owner
 * decision that has not been made, so every card says so.
 *
 * The internal deliberation — the long-form drafts, the open questions
 * and the note about not-yet-rejected candidates — lives in the
 * document's held sections and is deliberately ABSENT from this file.
 * A held section's wording appearing here would publish an
 * undecided position, so the parity test fails on that too.
 *
 * Why the words live here and not in the component
 * -----------------------------------------------
 * The component file renders this data; it does not own it. That
 * separation is what makes the document the source of truth and this
 * file its projection, and it keeps the preview importable from a
 * story without pulling in a route.
 */

/** The name as it is written. */
export const BRAND_NAME = '361do';

/**
 * The state of a 361do mark / symbol.
 *
 * No 361do mark asset exists in this repository. `public/favicon.svg`
 * is the Issue #285 placeholder (a plain blue disc) and the app icons
 * are generated from it, so neither is a 361do mark. Whether a mark is
 * adopted at all is Issue #61's decision, which is a different scope
 * from this note — so the symbol is stated as undefined rather than
 * drawn, and no new SVG is created here.
 */
export const BRAND_NAME_SYMBOL = '未定義';

/**
 * The five proposal phrases, verbatim from Issue #521's body, in the
 * order that body lists them.
 *
 * The order is the issue's, not a ranking: none of the five has been
 * adopted, and this file does not rank them.
 */
export const BRAND_NAME_PROPOSALS = [
	'360°回ってさらに一歩先',
	'361℃',
	'361回',
	'360でも365でもない',
	'19²',
] as const;

/** One section of the note, as the preview renders it. */
export interface BrandNameCard {
	/**
	 * The section heading. Byte-identical to the `##` heading of the
	 * same section in `docs/brand/361do-name-meanings.md`.
	 */
	heading: string;
	/** The bullet lines of that section, in document order. */
	points: readonly string[];
}

/**
 * The public sections of the note, in document order.
 *
 * The document's two held sections (the internal deliberation and the
 * verification notes) are not here: they are not publishable, and a
 * held section's wording in this file would leak an undecided
 * position into the preview.
 */
export const BRAND_NAME_CARDS: readonly BrandNameCard[] = [
	{
		heading: '典拠と前提',
		points: [
			'典拠は Issue #521 の本文のみ。Miro の付箋（個人 > samuido > 361do > 命名の複数解釈）にはアクセスできない。',
			'Miro にしかない情報（各解釈の背景や motivation）は創作せず、「未確認（owner 確認待ち）」と記す。',
			'361do 自体は docs/personal/domain.md の canonical statement による「samuido と同じ人物の stylized / numeric identity」。',
			'「do」の由来は本 Note の典拠からは確認できない（未確認（owner 確認待ち））。',
			'5 つの解釈は並列の候補であり、どれか一つを正式設定として確定していない。',
			'関連 Issue #380（機能独立の preview 契約）と #381（技術説明の独立ページ）は参照するが、hard dependency ではない。',
		],
	},
	{
		heading: '解釈 1 — 360°回ってさらに一歩先',
		points: [
			'原案（Issue #521 本文の表記）: 360°回ってさらに一歩先',
			'読み: 360°をひと回りしたあとに、さらに一歩。',
			'機械的に導ける根拠: 361 = 360 + 1。一周分を超えて 1 増える。',
			'背景・意図: 未確認（owner 確認待ち）',
			'採否: 保留。5 案のどれかを正式設定にする決定は行っていない。',
		],
	},
	{
		heading: '解釈 2 — 361℃',
		points: [
			'原案（Issue #521 本文の表記）: 361℃',
			'読み: 数値 361 を摂氏（℃）の温度として読む。',
			'機械的に導ける根拠: 361 = 360 + 1。解釈 1 と同じ数値関係で、単位だけが温度。',
			'背景・意図: 未確認（owner 確認待ち）',
			'採否: 保留。',
		],
	},
	{
		heading: '解釈 3 — 361回',
		points: [
			'原案（Issue #521 本文の表記）: 361回',
			'読み: 数値 361 を回数として読む。',
			'機械的に導ける根拠: 361 = 360 + 1。',
			'背景・意図: 未確認（owner 確認待ち）',
			'採否: 保留。',
		],
	},
	{
		heading: '解釈 4 — 360でも365でもない',
		points: [
			'原案（Issue #521 本文の表記）: 360でも365でもない',
			'読み: 360 でも 365 でもない、という否定の形で 361 を選ぶ。',
			'機械的に導ける根拠: 360 / 365 という定数を「使わない」と明示した表現。361 = 360 + 1。',
			'背景・意図: 未確認（owner 確認待ち）',
			'採否: 保留。',
		],
	},
	{
		heading: '解釈 5 — 19²',
		points: [
			'原案（Issue #521 本文の表記）: 19²',
			'読み: 19 の 2 乗。',
			'機械的に導ける根拠: 19 × 19 = 361。数値 361 を 2 つの数の積として自己記述する。',
			'背景・意図: 未確認（owner 確認待ち）',
			'採否: 保留。',
		],
	},
	{
		heading: '公開案（短い説明の候補）',
		points: [
			'案 A（数値のみ・解釈に中立）: 361do — 361 という数字で名付けた personal identity。',
			'案 B（解釈 1「360°回ってさらに一歩先」を前面に）: 360°をひと回りして、その先へもう一歩。361do — samuido と同じ人物の stylized identity。',
			'案 C（用途から説明する）: 361do — samuido と同じ人物の stylized identity。BOOTH などの配布・販売と、361do_sleep / 361do_design の social handle で使われる。',
			'3 案とも候補であり、どの案を公開するかは未決（owner 確認待ち）。',
			'この preview は design-system 配下の fixture であり、公開ページには載っていない。',
		],
	},
	{
		heading: 'シンボルとアセット',
		points: [
			'361do に対応する mark / symbol asset はこの repository に存在しない。',
			'public/favicon.svg は Issue #285 の placeholder（純青の円）。scripts/generate-app-icons.mjs がそこから app icon を生成する。361do の mark ではない。',
			'public/og/default-card.png は rebuildup.dev の fallback card（src/editorial/social-card/contract.json が正）。',
			'したがってこの preview のシンボルは「未定義」と表示する。',
			'新しい SVG / シンボル asset は本 Note では作らない（Issue #61 の asset 採否と重複する）。',
		],
	},
	{
		heading: 'Issue #61 とのスコープ分離',
		points: [
			'Issue #61: favicon / app icon / header / OG 等の brand asset の採否を決める。',
			'Issue #521（本 Note）: 名前の解釈と、その説明文の案。',
			'本 Note は asset を作らない・採否を決めない。asset 側の判断は Issue #61 のまま。',
			'「名前」と「シンボル」は別の決定であり、片方の決定を他方の根拠にしない。',
		],
	},
];

/**
 * The published state of the note.
 *
 * Nothing has been adopted: all five interpretations are held and all
 * three copy candidates are pending, so the published state is empty.
 * The preview renders this instead of the cards in its "empty" state,
 * which is what a visitor would actually see today — the record
 * exists, but none of it has been decided.
 */
export const BRAND_NAME_PUBLISHED_STATE = {
	heading: '公開状態（採用済みの解釈と公開文案のみ）',
	points: ['採用済みの解釈・公開文案はまだない。5 つの解釈はいずれも保留で、3 つの文案案も未決。'],
} as const;
