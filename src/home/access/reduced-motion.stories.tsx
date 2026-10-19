import type { Meta, StoryObj } from '@storybook/react';
import type { ReactNode } from 'react';
import { usePrefersReducedMotion } from '../../editorial/reduced-motion';
import type { HomeCounterData } from './load';
import { CounterTile } from './tiles';

/**
 * Reduced-motion fixture (Issue #403).
 *
 * This story is the reproducible surface the Issue asks for: every
 * state the ticket touches — normal / empty / failure / compact —
 * rendered in one document, with the motion preference stated on
 * screen rather than assumed.
 *
 * Three stories, on purpose:
 *
 *   - `Fixture`   reads the LIVE `prefers-reduced-motion` preference.
 *                 Two Playwright contexts (`no-preference` and
 *                 `reduce`) render this same story id, so the
 *                 committed artefact is two real captures of one
 *                 fixture and not two hand-picked screenshots. It is
 *                 the fixture the capture script asserts against.
 *   - `MotionOn` / `MotionOff` pin the answer for a human on one
 *                 machine, where the OS setting cannot be changed per
 *                 browser window. Forcing the React branch alone is
 *                 NOT enough for `MotionOn`: on a machine whose OS asks
 *                 for reduced motion, `src/styles.css` reduces every
 *                 animation duration and neutralises the hook's
 *                 selector, and both of those win against the inline
 *                 style. The fixture therefore re-arms the stylesheet
 *                 layer too (`MOTION_EMULATION_CSS`), and the banner
 *                 says so — a forced fixture that does not actually
 *                 move would claim a comparison it never performed.
 *
 * What the fixture proves, and what it cannot:
 *
 *   - It proves the RESTING state is the same document in both modes,
 *     for EVERY state this Issue names — the capture script reads all
 *     of them (`data-case` identifies each one) and compares label,
 *     slot count and rendered text between the two preference
 *     contexts. `data-motion-state` on the digit strip says which
 *     mode rendered it; the capture compares that against
 *     `getComputedStyle(...).animationName`.
 *   - It cannot prove a human's reading experience. That half is
 *     listed as human evaluation in `docs/verification/a11y/README.md`.
 *
 * The reactions widget and every `<video>` are deliberately NOT in this
 * fixture: neither ships motion today (`ReactionsWidget` draws plain
 * buttons, and the repository has no video asset at all), and
 * `scripts/check-reduced-motion.mjs` keeps both facts true —
 * `no-autoplay-motion-media` refuses an autoplaying `<video>` /
 * `<audio>` the day one appears.
 */

const NOW = Date.UTC(2026, 0, 5, 9, 0, 0);
const clock = () => NOW;

/**
 * The fixture states, identified for the capture script
 * (`scripts/capture-a11y-reduced-motion.mjs` asserts this exact set in
 * both preference contexts, so a state that stopped rendering fails
 * instead of shrinking the coverage silently).
 */
const CASE_IDS = {
	normal: '01-normal',
	empty: '02-empty',
	failure: '03-failure',
	compact: '04-compact',
} as const;

/** Digit slots `CounterTile` renders (`DIGIT_SLOTS` in `tiles.tsx`). */
const DIGIT_SLOTS = 7;

/**
 * Per-digit stagger of the roll-up, mirroring `tiles.tsx`.
 *
 * INTENDED motion, not shipped motion: Panda evaluates
 * `animationDelay: calc(var(--counter-stagger, 0ms) + ${index * 80}ms)`
 * statically per `css()` call, so the generated stylesheet today carries
 * only the `index === 0` rule and every digit shares one delay. The
 * fixture re-arms the intended stagger so the motion design is visible
 * in the forced preview, and this comment is what keeps the preview from
 * being read as evidence of the shipped frame.
 */
const STAGGER_MS = 80;

/**
 * Re-arm the stylesheet's reduced-motion opt-out inside the forced
 * no-preference fixture.
 *
 * `src/styles.css` declares, inside `@media (prefers-reduced-motion:
 * reduce)`, a universal floor (`animation-duration: 0.01ms
 * !important`) and a hook-scoped `animation: none !important`. Both
 * are `!important`, so on a machine with the OS preference set they
 * beat the inline animation the component emits — the banner would
 * say "forced no-preference" while nothing moved. These rules are
 * scoped to the fixture and carry a higher specificity, which is what
 * wins.
 *
 * The values mirror the literals inside the `css()` call in
 * `tiles.tsx`; they cannot be imported from there because Panda reads
 * that object literal at build time (see the comment in that file, and
 * "Two implementation traps" in `docs/verification/a11y/README.md`).
 * The per-digit `animation-delay` half is the one exception — it is the
 * intended stagger the shipped stylesheet does not yet emit (see
 * `STAGGER_MS`), so the preview is a design view, not a capture of
 * production motion.
 */
const MOTION_EMULATION_CSS = [
	'[data-motion-emulation="no-preference"] :where([data-motion="counter-roll"]) img {',
	'\tanimation-name: counterDigitRoll !important;',
	'\tanimation-duration: 320ms !important;',
	'\tanimation-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1) !important;',
	'\tanimation-fill-mode: both !important;',
	...Array.from(
		{ length: DIGIT_SLOTS },
		(_unused, index) =>
			`[data-motion-emulation="no-preference"] :where([data-motion="counter-roll"]) img:nth-child(${
				index + 1
			}) { animation-delay: ${index * STAGGER_MS}ms !important; }`,
	),
].join('\n');

/** 1,234 hits, delta and period labels present. */
const NORMAL: HomeCounterData = {
	key: 'home-page',
	count: 1234,
	first_hit: Date.UTC(2026, 0, 1, 0, 0, 0),
	last_hit: NOW - 5 * 60_000,
	enabled: true,
};

/** Deployed but never visited: count 0, no first hit, no last hit. */
const EMPTY: HomeCounterData = {
	key: 'home-page',
	count: 0,
	first_hit: null,
	last_hit: null,
	enabled: true,
};

/** Counter unavailable — no consumer API key configured. */
const UNAVAILABLE: HomeCounterData = {
	key: 'home-page',
	count: 0,
	first_hit: null,
	last_hit: null,
	enabled: false,
};

const meta = {
	title: 'home/ReducedMotion',
	parameters: { layout: 'padded' },
	tags: ['autodocs'],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

interface CaseProps {
	caseId: string;
	label: string;
	caption: string;
	children: ReactNode;
}

function Case({ caseId, label, caption, children }: CaseProps) {
	return (
		<section
			// The state identity the capture script reads, so each row is
			// compared in its own right instead of "whatever strip came
			// first in the document".
			data-case={caseId}
			style={{
				display: 'flex',
				flexDirection: 'column',
				gap: 8,
				padding: 16,
				border: '1px solid #d7d9e0',
				borderRadius: 8,
			}}
		>
			<header style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
				<span style={{ font: '600 12px/1.4 ui-monospace, monospace', letterSpacing: '0.06em' }}>
					{label}
				</span>
				<span style={{ font: '400 12px/1.4 ui-monospace, monospace', color: '#5b6072' }}>
					{caption}
				</span>
			</header>
			{children}
		</section>
	);
}

function ModeBanner({ forced }: { forced?: boolean }) {
	const prefersReduced = usePrefersReducedMotion();
	const mode = (forced ?? prefersReduced) ? 'reduce' : 'no-preference';
	// Forcing the React branch does not disarm `src/styles.css`; the
	// fixture re-arms it for the forced no-preference story, and the
	// banner states which of the two layers is being shown.
	const stylesheetLayer =
		forced === undefined
			? 'live media query'
			: forced
				? 'nothing to disarm (no animation is emitted)'
				: 're-armed by this fixture';
	return (
		<p
			data-testid="reduced-motion-mode"
			data-mode={mode}
			style={{
				margin: 0,
				padding: '8px 12px',
				borderRadius: 6,
				background: '#0b1020',
				color: '#f4efdf',
				font: '600 13px/1.5 ui-monospace, monospace',
			}}
		>
			prefers-reduced-motion: {mode}
			{forced === undefined ? '' : ` (forced by the story — ${stylesheetLayer})`}
		</p>
	);
}

function FixtureBody({ reducedMotion }: { reducedMotion?: boolean }) {
	const narrow = { width: 320 };
	// `reducedMotion === false` is the only combination that can disagree
	// with the stylesheet: the component emits the animation AND the OS
	// (or a stylesheet-only reduction) may take it away again.
	const emulateNoPreference = reducedMotion === false;
	return (
		<div
			data-testid="reduced-motion-fixture"
			data-motion-emulation={emulateNoPreference ? 'no-preference' : undefined}
			style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 880 }}
		>
			{emulateNoPreference ? <style>{MOTION_EMULATION_CSS}</style> : null}
			<ModeBanner forced={reducedMotion} />
			<Case
				caseId={CASE_IDS.normal}
				label="01 normal"
				caption="1,234 page views · delta · period · last hit"
			>
				<CounterTile data={NORMAL} locale="en" now={clock} reducedMotion={reducedMotion} />
			</Case>
			<Case caseId={CASE_IDS.empty} label="02 empty" caption="count 0 · no first hit · no last hit">
				<CounterTile data={EMPTY} locale="en" now={clock} reducedMotion={reducedMotion} />
			</Case>
			<Case
				caseId={CASE_IDS.failure}
				label="03 failure"
				caption="consumer API key not configured — em-dash, no digit strip"
			>
				<CounterTile data={UNAVAILABLE} locale="en" now={clock} reducedMotion={reducedMotion} />
			</Case>
			<Case
				caseId={CASE_IDS.compact}
				label="04 compact"
				caption="320 px column — the shipped mobile column width"
			>
				<div style={narrow}>
					<CounterTile data={NORMAL} locale="en" now={clock} reducedMotion={reducedMotion} />
				</div>
			</Case>
		</div>
	);
}

export const Fixture: Story = {
	render: () => <FixtureBody />,
};

export const MotionOn: Story = {
	name: 'MotionOn (forced no-preference)',
	render: () => <FixtureBody reducedMotion={false} />,
};

export const MotionOff: Story = {
	name: 'MotionOff (forced reduce)',
	render: () => <FixtureBody reducedMotion />,
};
