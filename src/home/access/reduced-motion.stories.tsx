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
 *                 fixture and not two hand-picked screenshots.
 *   - `MotionOn` / `MotionOff` pin the answer for a human on one
 *                 machine, where the OS setting cannot be changed per
 *                 browser window.
 *
 * What the fixture proves, and what it cannot:
 *
 *   - It proves the RESTING state is the same document in both modes:
 *     the same digit slots, the same glyphs, the same accessible
 *     label, the same metadata. `data-motion-state` on the digit strip
 *     says which mode rendered it; the capture script compares that
 *     against `getComputedStyle(...).animationName`.
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
	label: string;
	caption: string;
	children: ReactNode;
}

function Case({ label, caption, children }: CaseProps) {
	return (
		<section
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
			{forced === undefined ? '' : ' (forced by the story)'}
		</p>
	);
}

function FixtureBody({ reducedMotion }: { reducedMotion?: boolean }) {
	const narrow = { width: 320 };
	return (
		<div
			data-testid="reduced-motion-fixture"
			style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 880 }}
		>
			<ModeBanner forced={reducedMotion} />
			<Case label="01 normal" caption="1,234 page views · delta · period · last hit">
				<CounterTile data={NORMAL} locale="en" now={clock} reducedMotion={reducedMotion} />
			</Case>
			<Case label="02 empty" caption="count 0 · no first hit · no last hit">
				<CounterTile data={EMPTY} locale="en" now={clock} reducedMotion={reducedMotion} />
			</Case>
			<Case label="03 failure" caption="consumer API key not configured — em-dash, no digit strip">
				<CounterTile data={UNAVAILABLE} locale="en" now={clock} reducedMotion={reducedMotion} />
			</Case>
			<Case label="04 compact" caption="320 px column — the shipped mobile column width">
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
