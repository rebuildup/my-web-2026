import type { Meta, StoryObj } from '@storybook/react';
import type { ComponentType } from 'react';
import { css } from '../../styled-system/css';
import { ExternalReadCard, type ExternalReadCardProps } from './ExternalReadCard';
import {
	DEFAULT_EXTERNAL_READ_POLICY,
	type ExternalSnapshot,
	applyFailure,
	applySuccess,
} from './contract';
import { GITHUB_REPO_SOURCE, type GitHubRepoFacts } from './github';

/**
 * ExternalReadCard stories — every state a third-party read can put a
 * visitor in (Issue #499).
 *
 * The fixtures are CONSTANTS, not `Date.now()` calls: a story that
 * renders "3 minutes ago" changes its own truth between two opens of
 * Storybook, and the committed verification screenshot would then
 * document an instant nobody can reproduce. The same constants feed
 * `ApiTimeoutFallbackGallery`, which is the screen the capture script
 * photographs.
 *
 * `Gallery` stacks the states with the policy and the audit lines, so
 * a reviewer can check the whole contract on one screen without a
 * running upstream.
 */

const T0 = Date.parse('2026-10-18T00:00:00.000Z');
const T1 = T0 + 3 * 60 * 60 * 1_000;
const T2 = T0 + 3 * 60 * 60 * 1_000 + 2_000;

const SOURCE = GITHUB_REPO_SOURCE;

/** Published facts. Numbers only — the allowlist has no personal fields. */
const FACTS: GitHubRepoFacts = {
	stars: 12,
	forks: 3,
	openIssues: 0,
	license: 'MIT',
	pushedAt: '2026-10-17T12:00:00.000Z',
};

const FRESH = applySuccess(FACTS, T1);
const STALE: ExternalSnapshot<GitHubRepoFacts> = { ...FRESH, freshness: 'stale' };
const TIMED_OUT = applyFailure(
	FRESH,
	'timeout',
	T2,
	{ state: 'closed', consecutiveFailures: 1, openedAt: null },
	DEFAULT_EXTERNAL_READ_POLICY,
);
const BLOCKED = applyFailure(
	FRESH,
	'rate-limited',
	T2,
	{ state: 'open', consecutiveFailures: 3, openedAt: T2 },
	DEFAULT_EXTERNAL_READ_POLICY,
);
// Explicit type argument: the `loading` literal carries no value to
// infer the adapter's type from.
const FIRST_FAILURE = applyFailure<GitHubRepoFacts>(
	{ status: 'loading' },
	'network',
	T2,
	{ state: 'closed', consecutiveFailures: 1, openedAt: null },
	DEFAULT_EXTERNAL_READ_POLICY,
);

function renderFacts(value: GitHubRepoFacts) {
	const rows: [string, string | number | null][] = [
		['stars', value.stars],
		['forks', value.forks],
		['openIssues', value.openIssues],
		['license', value.license],
	];
	return (
		<dl
			className={css({
				display: 'grid',
				gridTemplateColumns: 'auto auto',
				gap: '1',
				margin: '0',
				padding: '0',
			})}
		>
			{rows.map(([label, entry]) => (
				<div key={label} className={css({ display: 'contents' })}>
					<dt className={css({ fontFamily: 'mono', fontSize: 'sm', color: 'text.muted' })}>
						{label}
					</dt>
					<dd
						className={css({
							margin: '0',
							paddingInlineStart: '3',
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.default',
						})}
					>
						{entry === null ? '—' : entry}
					</dd>
				</div>
			))}
		</dl>
	);
}

function card(snapshot: ExternalSnapshot<GitHubRepoFacts>) {
	return (
		<ExternalReadCard
			title="公開リポジトリの事実 / Public repository facts"
			source={SOURCE}
			snapshot={snapshot}
			renderValue={renderFacts}
			onRetry={() => {}}
		/>
	);
}

/**
 * The stories are typed against a CONCRETE value type.
 *
 * `Meta<typeof ExternalReadCard>` would resolve the component's type
 * parameter to `unknown`, which makes `renderValue` untypable and
 * every snapshot argument widen. These stories exist for one adapter,
 * so they state that adapter's value type instead of the generic one.
 */
type CardProps = ExternalReadCardProps<GitHubRepoFacts>;
type CardComponent = ComponentType<CardProps>;

const meta = {
	title: 'external-api/ExternalReadCard',
	component: ExternalReadCard as CardComponent,
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta<CardComponent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Fresh: Story = {
	name: '01 fresh — value observed inside the window',
	args: {
		snapshot: FRESH,
		renderValue: renderFacts,
		title: '公開リポジトリの事実',
		source: SOURCE,
	},
};

export const Stale: Story = {
	name: '02 stale — same value, age stated',
	args: {
		snapshot: STALE,
		renderValue: renderFacts,
		title: '公開リポジトリの事実',
		source: SOURCE,
	},
};

export const TimeoutFallback: Story = {
	name: '03 timeout — value kept, retry offered',
	args: {
		snapshot: TIMED_OUT,
		renderValue: renderFacts,
		title: '公開リポジトリの事実',
		source: SOURCE,
		onRetry: () => {},
	},
};

export const Blocked: Story = {
	name: '04 blocked — retry disabled, next attempt stated',
	args: {
		snapshot: BLOCKED,
		renderValue: renderFacts,
		title: '公開リポジトリの事実',
		source: SOURCE,
		onRetry: () => {},
	},
};

export const FirstFailure: Story = {
	name: '05 first failure — no value, no spinner, retry offered',
	args: {
		snapshot: FIRST_FAILURE,
		renderValue: renderFacts,
		title: '公開リポジトリの事実',
		source: SOURCE,
		onRetry: () => {},
	},
};

export const Loading: Story = {
	name: '06 loading — the only state that shows a spinner',
	args: {
		snapshot: { status: 'loading' },
		renderValue: renderFacts,
		title: '公開リポジトリの事実',
		source: SOURCE,
	},
};

const POLICY_ROWS: readonly [string, string][] = [
	['timeoutMs', `${DEFAULT_EXTERNAL_READ_POLICY.timeoutMs} ms`],
	['staleAfterMs', `${DEFAULT_EXTERNAL_READ_POLICY.staleAfterMs / 3_600_000} h`],
	['failureThreshold', String(DEFAULT_EXTERNAL_READ_POLICY.failureThreshold)],
	['openMs', `${DEFAULT_EXTERNAL_READ_POLICY.openMs / 1_000} s`],
	[
		'retryBaseMs → retryMaxMs',
		`${DEFAULT_EXTERNAL_READ_POLICY.retryBaseMs} ms → ${DEFAULT_EXTERNAL_READ_POLICY.retryMaxMs / 1_000} s`,
	],
	['maxResponseBytes', `${DEFAULT_EXTERNAL_READ_POLICY.maxResponseBytes / 1024} KiB`],
];

/**
 * The verification screen for `docs/verification/ops/api-timeout-fallback.webp`.
 *
 * Deliberately rendered from the SAME shipped component and the SAME
 * fixture constants as the stories above, so the committed screenshot
 * cannot drift away from what a reviewer sees in Storybook.
 */
export function ApiTimeoutFallbackGallery() {
	return (
		<div
			data-testid="api-timeout-fallback"
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '6',
				padding: { base: '4', md: '8' },
				bg: 'bg.canvas',
				color: 'text.default',
				fontFamily: 'sans',
			})}
		>
			<header className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
				<p
					className={css({
						margin: '0',
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'accent.accent',
					})}
				>
					ops(reliability) — Issue #499 · external read: timeout / stale / fallback / breaker
				</p>
				<h1
					className={css({
						margin: '0',
						fontFamily: 'heading',
						fontSize: '2xl',
						fontWeight: '700',
						lineHeight: '1.3',
					})}
				>
					外部API表示の失敗状態 — 外部API読み取りが失敗しても、表示は終わる
				</h1>
				<p
					className={css({
						margin: '0',
						fontSize: 'md',
						color: 'text.muted',
						maxWidth: '90ch',
						lineHeight: '1.6',
					})}
				>
					同じ component・同じ fixture で 6 状態を描画する。spinner は「まだ一度も値が取れていない」
					1 状態だけで、失敗後は必ず value / degraded に確定する。失敗しても前回の値は破棄されない。
				</p>
			</header>

			<div
				className={css({
					display: 'grid',
					gridTemplateColumns: { base: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
					gap: '4',
				})}
			>
				<div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
					<p
						className={css({
							margin: '0',
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
						})}
					>
						01 fresh / 02 stale
					</p>
					{card(FRESH)}
					{card(STALE)}
				</div>
				<div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
					<p
						className={css({
							margin: '0',
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
						})}
					>
						03 timeout fallback / 04 blocked
					</p>
					{card(TIMED_OUT)}
					{card(BLOCKED)}
				</div>
				<div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
					<p
						className={css({
							margin: '0',
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
						})}
					>
						05 first failure / 06 loading
					</p>
					{card(FIRST_FAILURE)}
					{card({ status: 'loading' })}
				</div>
				<div className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}>
					<p
						className={css({
							margin: '0',
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
						})}
					>
						policy / audit
					</p>
					<dl
						className={css({
							display: 'grid',
							gridTemplateColumns: 'auto 1fr',
							gap: '1',
							margin: '0',
							padding: '4',
							borderRadius: 'md',
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: 'border.subtle',
							bg: 'bg.surface',
						})}
					>
						{[
							...POLICY_ROWS.map((row) => [`policy.${row[0]}`, row[1]] as const),
							['source', `${SOURCE.label} — ${SOURCE.endpoint}`],
							['sendsCredentials', String(SOURCE.sendsCredentials)],
							['publishedFields', 'stars / forks / openIssues / license(SPDX id) / pushedAt'],
						].map(([label, value]) => (
							<div key={label} className={css({ display: 'contents' })}>
								<dt className={css({ fontFamily: 'mono', fontSize: 'sm', color: 'text.muted' })}>
									{label}
								</dt>
								<dd
									className={css({
										margin: '0',
										paddingInlineStart: '3',
										fontFamily: 'mono',
										fontSize: 'sm',
										color: 'text.default',
									})}
								>
									{value}
								</dd>
							</div>
						))}
					</dl>
				</div>
			</div>

			<footer
				className={css({
					display: 'flex',
					flexWrap: 'wrap',
					gap: '4',
					fontFamily: 'mono',
					fontSize: 'sm',
					color: 'text.muted',
				})}
			>
				<span>fixture constants — no live request in this gallery</span>
				<span>allowlist mapping — owner.email / private payload refused</span>
				<span>concurrent callers coalesce into one upstream request</span>
			</footer>
		</div>
	);
}

export const Gallery: Story = {
	name: 'gallery — verification screen (#499)',
	args: {
		snapshot: FRESH,
		renderValue: renderFacts,
		title: '公開リポジトリの事実',
		source: SOURCE,
	},
	render: () => <ApiTimeoutFallbackGallery />,
};
