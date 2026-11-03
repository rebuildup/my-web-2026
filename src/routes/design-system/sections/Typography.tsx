import { css } from '../../../../styled-system/css';

/**
 * Typography — heading / body / mono samples at every step of the size
 * scale declared in `src/editorial/tokens.ts#fontSizes`.
 *
 * Three sample blocks:
 *
 *   - Heading  — Zen Kaku Gothic New, the editorial display family.
 *     `src/styles.css` applies it to `:where(h1,h2,h3)` so any
 *     element rendered as an `<h*>` automatically picks it up; this
 *     block uses `<h3>` so the test is real.
 *   - Body     — Noto Sans JP, the platform Japanese body family.
 *   - Mono     — JetBrains Mono, used for ordinals / hex / metadata.
 *
 * Every size tier (`text.xs` → `text.2xl`) is rendered with its
 * numeric rem equivalent so a designer can read both the token
 * and the underlying value side-by-side.
 */

interface SizeStep {
	token: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
	rem: string;
	px: string;
	role: string;
}

const STEPS: ReadonlyArray<SizeStep> = [
	{ token: 'xs', rem: '0.75', px: '12', role: 'mono caption / label' },
	{ token: 'sm', rem: '0.875', px: '14', role: 'body support' },
	{ token: 'md', rem: '1', px: '16', role: 'body' },
	{ token: 'lg', rem: '1.125', px: '18', role: 'lead body' },
	{ token: 'xl', rem: '1.5', px: '24', role: 'subhead / card h3' },
	{ token: '2xl', rem: '2', px: '32', role: 'large subhead / footer identity' },
];

export function Typography() {
	return (
		<div
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '10',
			})}
		>
			<FamilyBlock
				family="heading"
				familyName="Heading"
				token="Zen Kaku Gothic New"
				familyRole="Display tier — h1 / h2 / h3"
			/>
			<FamilyBlock
				family="sans"
				familyName="Body"
				token="Noto Sans JP"
				familyRole="Body / UI default"
			/>
			<FamilyBlock
				family="mono"
				familyName="Mono"
				token="JetBrains Mono"
				familyRole="Metadata / hex / ordinals"
			/>
		</div>
	);
}

interface FamilyBlockProps {
	family: 'heading' | 'sans' | 'mono';
	familyName: string;
	token: string;
	familyRole: string;
}

function FamilyBlock({ family, familyName, token, familyRole }: FamilyBlockProps) {
	return (
		<section
			aria-label={`${familyName} family`}
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '4',
				paddingBlock: '4',
				borderTop: '1px solid {colors.border.subtle}',
			})}
		>
			<header
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '1',
				})}
			>
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						letterSpacing: '0.06em',
						textTransform: 'uppercase',
						color: 'text.muted',
					})}
				>
					{familyName} — {token}
				</span>
				<p
					className={css({
						margin: 0,
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					{familyRole}
				</p>
			</header>
			<dl
				className={css({
					margin: '0',
					display: 'grid',
					gridTemplateColumns: 'auto 1fr',
					columnGap: '6',
					rowGap: '3',
					alignItems: 'baseline',
				})}
			>
				{STEPS.map((step) => (
					<StepRow key={step.token} family={family} step={step} />
				))}
			</dl>
		</section>
	);
}

function StepRow({ family, step }: { family: 'heading' | 'sans' | 'mono'; step: SizeStep }) {
	return (
		<>
			<dt
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '1',
					fontFamily: 'mono',
					fontSize: 'xs',
					color: 'text.muted',
					letterSpacing: '0.04em',
					textTransform: 'uppercase',
				})}
			>
				<span lang="en">text.{step.token}</span>
				<span lang="en" aria-hidden="true">
					{step.rem}rem · {step.px}px
				</span>
				<span lang="en" aria-hidden="true">
					{step.role}
				</span>
			</dt>
			<dd
				className={css({
					margin: '0',
					fontFamily: family,
					fontSize: step.token,
					color: 'text.default',
					lineHeight: '1.2',
				})}
				lang={family === 'mono' ? 'en' : 'ja'}
			>
				{family === 'heading'
					? '静かな編集 / Editorial design'
					: family === 'sans'
						? '本文 / Body — Noto Sans JP は platform Japanese の正本'
						: 'mono / hex · 0x1A2B3C · 0.618'}
			</dd>
		</>
	);
}
