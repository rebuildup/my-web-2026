import type { Meta, StoryObj } from '@storybook/react';
import { css } from '../../styled-system/css';
import { Container } from './primitives/Container';
import { SectionHeading } from './primitives/SectionHeading';

/**
 * CJK line-break / 禁則処理 verification fixture (Issue #431).
 *
 * What this fixture is
 * --------------------
 * A rendering surface for the *typography* half of CJK text: where the
 * user agent is allowed to break a line, and what it must never leave
 * alone at a line head or a line tail. It renders the real shipped
 * recipes — `SectionHeading`'s `title` (`text-wrap: balance`, `2xl`,
 * `heading` family) for the heading role and its `description`
 * (`text-wrap: pretty`, `md`, `1.6`, `sans` family) for the body
 * role — so a measurement taken here is a measurement of what a
 * visitor actually sees, not of a stand-in.
 *
 * It renders inside `Container`, so shrinking the viewport shrinks the
 * same content box the public pages use. That is the "狭い画面" case
 * this Issue asks about: every story is meant to be read at 320 / 375
 * / 768 px, not only at Storybook's default desktop width.
 *
 * It is a fixture, not copy
 * ------------------------
 * Every string below is verification copy. It states nothing about the
 * platform owner, no product facts, and no roadmap. Numbers, negation
 * and units are written out on purpose so the harness can prove the
 * rendered document kept them character-for-character
 * (`scripts/cjk-line-break-measure.mjs` asserts that). Nothing here is
 * published copy and nothing here is a 推敲 of shipped text: the
 * typography contract (禁則 / 折り返し) and the text-quality contract
 * (translation quality, editing, tone) are separate obligations, and
 * this Issue only measures the first one.
 *
 * The three stories
 * -----------------
 *   1. `Default` — no `lang`, no CJK-specific declaration. This is
 *      what ships today: `src/styles.css` puts
 *      `word-break: normal; word-break: auto-phrase` and
 *      `text-wrap: pretty` on `body`, and nothing locale-specific
 *      anywhere. It is the baseline every other story is compared to.
 *   2. `LocaleOptIn` — adds `lang` and nothing else. `lang` is the
 *      narrowest possible opt-in: it selects the UA's line-breaking
 *      behaviour and the font fallback chain without restyling a
 *      single declaration, so a feature can adopt it per region and
 *      leave every other locale untouched.
 *   3. `LocaleOptInWithCjkTypography` — `lang` **plus** the two
 *      feature-specific declarations a CJK surface may eventually want:
 *      `line-break: strict` (tighten 行頭禁則 beyond the `auto`
 *      default) and `text-spacing-trim: trim-start` (drop the
 *      ideographic space that would otherwise precede an opening
 *      bracket at a line head). Both are inherited, so they are set
 *      on the sample wrapper rather than on the measured element.
 *
 *      **Not adopted.** This story exists so the candidate adjustment
 *      can be measured against the baseline before any product
 *      surface opts into it. Shipping it globally would contradict
 *      this Issue's acceptance criteria, which require locale to stay
 *      opt-in where a feature needs it.
 *
 * Contract with the harness
 * -------------------------
 * `scripts/cjk-line-break-measure.mjs` drives these stories in a real
 * browser and reads:
 *   - `[data-cjk-sample]` wrappers, whose value is `<locale>:<role>`
 *     (`heading` or `body`);
 *   - the `h2` / `p` inside each wrapper, which is the element whose
 *     line boxes it reconstructs;
 *   - the `lang` attribute, to tell the three stories apart and to
 *     prove the baseline story carries none.
 * Keep the attribute names stable — the measurement is meaningless
 * against a wrapper the harness cannot find.
 */

type LocaleId = 'ja' | 'zh-Hans' | 'zh-Hant' | 'ko';

interface LocaleSample {
	id: LocaleId;
	/** BCP 47 tag written on the sample when a story opts in. */
	tag: string;
	/** Endonym, rendered as the heading eyebrow. */
	label: string;
	heading: string;
	body: string;
}

/**
 * Verification copy. Written to put a 行頭禁則 character, a 行末禁則
 * character, a long vowel mark / middle dot, digits, a unit and a
 * negation inside every single sample, so a regression in any of
 * those has somewhere visible to show up.
 */
const LOCALES: readonly LocaleSample[] = [
	{
		id: 'ja',
		tag: 'ja',
		label: '日本語',
		heading: '句読点と約物の禁則処理（表示サンプル）',
		body: '日本語の段落は、句読点（、。「」）・約物（ー・…）が行頭や行末から離れるよう禁則処理されます。折り返し位置と word-break の指定が重なると、狭い画面では分断が悪化することがあります。この段落は表示の検証専用で、文面の推敲は含みません。件数 1,024 件、割合 99.9%、否定表現「〜しない」は原文のまま保持しています。',
	},
	{
		id: 'zh-Hans',
		tag: 'zh-Hans',
		label: '简体中文',
		heading: '标点符号与避头尾规则（显示样本）',
		body: '中文段落会按照避头尾规则处理标点（例如「，」「。」「、」），避免它们出现在行首。折行位置与 word-break 的设置叠加时，窄屏上仍可能出现不自然的中断。本段仅用于显示验证，不包含文案润色；数量 1,024 条、比例 99.9%、否定表述「不」均保持原文。',
	},
	{
		id: 'zh-Hant',
		tag: 'zh-Hant',
		label: '繁體中文',
		heading: '標點符號與避頭尾規則（顯示樣本）',
		body: '中文段落會按照避頭尾規則處理標點（例如「，」「。」「、」），避免它們出現在行首。折行位置與 word-break 的設定疊加時，窄螢幕上仍可能出現不自然的中斷。本段僅用於顯示驗證，不包含文案潤飾；數量 1,024 筆、比例 99.9%、否定表述「不」均保持原文。',
	},
	{
		id: 'ko',
		tag: 'ko',
		label: '한국어',
		heading: '문장 부호와 줄바꿈 규칙 (표시 샘플)',
		body: '한국어 단락은 띄어쓰기 단위로 줄이 바뀌므로, 문장 부호가 줄머리에 남지 않는지 확인합니다. 줄바꿈 위치와 word-break 설정이 겹치면 좁은 화면에서 어색하게 끊길 수 있습니다. 이 문단은 표시 검증 전용이며 교정하지 않았습니다. 수량 1,024건, 비율 99.9%, 부정 표현 「아니다」는 원문 그대로 유지합니다.',
	},
];

interface ModeSpec {
	id: string;
	label: string;
	/** Whether the story writes `lang` on each sample. */
	langOptIn: boolean;
	/**
	 * Feature-specific CJK declarations, applied only when the story
	 * also opts into `lang`. Inherited, so they sit on the wrapper.
	 */
	cjkTypography: boolean;
	note: string;
}

const MODES: Record<'default' | 'locale' | 'locale-typography', ModeSpec> = {
	default: {
		id: 'default',
		label: '① Default — 出荷状態（locale 未 opt-in）',
		langOptIn: false,
		cjkTypography: false,
		note: '`lang` もロケール固有宣言も無い、2026-10 時点の出荷状態です。`src/styles.css` の body ルール（word-break: normal → auto-phrase / text-wrap: pretty）だけが効きます。',
	},
	locale: {
		id: 'locale',
		label: '② LocaleOptIn — `lang` のみ',
		langOptIn: true,
		cjkTypography: false,
		note: '`lang` だけを付けています。宣言は 1 つも増やさずに UA の行分割規則とフォントフォールバックだけを切り替えられるので、必要な地域でだけ opt-in できます。',
	},
	'locale-typography': {
		id: 'locale-typography',
		label: '③ LocaleOptInWithCjkTypography — `lang` + CJK タイポグラフィ（未採用）',
		langOptIn: true,
		cjkTypography: true,
		note: '`line-break: strict` と `text-spacing-trim: trim-start` を足した比較用。①②との差分を見るための候補であり、製品側ではまだ採用していません（全局 opt-in はこの Issue の受け入れ条件に反します）。',
	},
};

const meta = {
	title: 'editorial/CJK line-break',
	parameters: {
		layout: 'fullscreen',
		docs: { description: { component: 'CJK 禁則処理 / 折り返し検証 fixture（Issue #431）' } },
	},
	tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	render: () => <Surface mode="default" />,
};

export const LocaleOptIn: Story = {
	render: () => <Surface mode="locale" />,
};

export const LocaleOptInWithCjkTypography: Story = {
	render: () => <Surface mode="locale-typography" />,
};

function Surface({ mode }: { mode: keyof typeof MODES }) {
	const spec = MODES[mode];
	return (
		<Container className={css({ display: 'flex', flexDirection: 'column', gap: '8', py: '6' })}>
			<Masthead mode={spec} />
			{LOCALES.map((sample) => (
				<div key={sample.id} className={css({ display: 'flex', flexDirection: 'column' })}>
					<Sample sample={sample} spec={spec} slot="heading" />
					<Sample sample={sample} spec={spec} slot="body" />
				</div>
			))}
		</Container>
	);
}

/**
 * The measured element is the `h2` / `p` inside the wrapper, so the
 * `lang` and the CJK declarations live on the wrapper and reach the
 * text through inheritance — exactly how a real surface would scope
 * them, without editing the shipped primitive.
 */
function Sample({
	sample,
	spec,
	slot,
}: {
	sample: LocaleSample;
	spec: ModeSpec;
	slot: 'heading' | 'body';
}) {
	return (
		<div
			data-cjk-sample={`${sample.id}:${slot}`}
			data-cjk-mode={spec.id}
			lang={spec.langOptIn ? sample.tag : undefined}
			className={css({
				lineBreak: spec.cjkTypography ? 'strict' : undefined,
				textSpacingTrim: spec.cjkTypography ? 'trim-start' : undefined,
			})}
		>
			{slot === 'heading' ? (
				<SectionHeading
					id={`cjk-heading-${sample.id}`}
					eyebrow={sample.label}
					title={sample.heading}
				/>
			) : (
				<SectionHeading description={sample.body} />
			)}
		</div>
	);
}

/**
 * Reading key for the artefact. States what is measured (typography)
 * and what is deliberately not (text quality), and names the
 * declarations in play so a reader can diff ①②③ by eye.
 */
function Masthead({ mode }: { mode: ModeSpec }) {
	return (
		<header
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '2',
				paddingBlockEnd: '4',
				borderBottom: '1px solid {colors.border.subtle}',
			})}
		>
			<p
				className={css({
					margin: 0,
					fontFamily: 'mono',
					fontSize: 'xs',
					letterSpacing: '0.06em',
					textTransform: 'uppercase',
					color: 'text.muted',
				})}
			>
				Issue #431 — CJK 禁則処理 / line-break verification fixture
			</p>
			<p className={css({ margin: 0, fontSize: 'sm', fontWeight: '600', color: 'text.default' })}>
				{mode.label}
			</p>
			<p className={css({ margin: 0, fontSize: 'sm', lineHeight: '1.6', color: 'text.muted' })}>
				{mode.note}
			</p>
			<dl
				className={css({
					margin: 0,
					display: 'grid',
					gridTemplateColumns: 'auto 1fr',
					columnGap: '3',
					rowGap: '1',
					fontSize: 'xs',
					lineHeight: '1.6',
				})}
			>
				<Decoded
					label="heading"
					value="SectionHeading title — 2xl / heading family / text-wrap: balance"
				/>
				<Decoded
					label="body"
					value="SectionHeading description — md / sans family / text-wrap: pretty"
				/>
				<Decoded
					label="base"
					value="src/styles.css body — word-break: normal → auto-phrase / text-wrap: pretty"
				/>
				<Decoded
					label="opt-in"
					value="lang（最小 opt-in）／ line-break: strict + text-spacing-trim: trim-start（候補・未採用）"
				/>
				<Decoded
					label="非対象"
					value="文章品質（翻訳・推敲・トーン）。本 fixture は表示専用で Published copy を変更しません。"
				/>
			</dl>
		</header>
	);
}

function Decoded({ label, value }: { label: string; value: string }) {
	return (
		<>
			<dt
				className={css({
					fontFamily: 'mono',
					letterSpacing: '0.04em',
					textTransform: 'uppercase',
					color: 'text.muted',
				})}
			>
				{label}
			</dt>
			<dd className={css({ margin: 0, color: 'text.default' })}>{value}</dd>
		</>
	);
}
