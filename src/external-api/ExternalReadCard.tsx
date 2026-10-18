import type { ReactNode } from 'react';
import { css } from '../../styled-system/css';
import { Badge } from '../editorial/primitives/Badge';
import {
	EXTERNAL_FAILURE_LABEL,
	type ExternalBreakerState,
	type ExternalFreshness,
	type ExternalSnapshot,
	type ExternalSource,
} from './contract';

/**
 * ExternalReadCard — the display surface for one third-party read.
 *
 * The card renders a snapshot and nothing else. It has no fetch, no
 * timer and no knowledge of which upstream it shows, so every
 * reliability property is decided upstream in `contract.ts`:
 *
 *   - `loading` is only reachable before the FIRST value, so a
 *     persistent spinner would require a snapshot that cannot be
 *     constructed;
 *   - `degraded` keeps the last known value on screen and states the
 *     reason beside it (non-destructive fallback);
 *   - a blocked source offers a DISABLED retry and the instant the
 *     next probe may run, instead of a button that would do nothing.
 *
 * The BADGE states what is on screen, never a neighbouring state's
 * wording: a card with no value never claims a stale value is being
 * shown, and `loading` never borrows a settled state's label. That
 * rule is what `badgeKey` + `BADGE_LABEL` implement, and it is
 * asserted per state in `ExternalReadCard.test.tsx`.
 *
 * Copy is a closed set of repository constants. No upstream text,
 * status line or exception message has a path into this component, so
 * the only thing a visitor can read about a failure is its reason
 * code, mapped by `EXTERNAL_FAILURE_LABEL`.
 *
 * A `null` value always means "nothing to show", never "the number
 * zero" — an adapter maps absence to `null` precisely so the card
 * cannot invent a value it did not receive.
 */

const LOADING_LABEL = '読み込み中 / Loading';
const STALE_LABEL = '古い値を表示中 / Showing a stale value';
const FALLBACK_LABEL =
	'更新に失敗しました・前回の値を表示中 / Update failed — showing the last known value';
const UNAVAILABLE_LABEL = '値を取得できません / Value unavailable';
const FAILED_LABEL = '取得失敗 / Read failed';
const RETRY_LABEL = '再試行 / Retry';
const BLOCKED_LABEL = '遮断中 / Blocked';
const FRESH_LABEL = '取得済み / Up to date';
const NEXT_ATTEMPT_LABEL = '次の試行 / Next attempt';
const OBSERVED_AT_LABEL = 'observed at';
const FAILED_AT_LABEL = 'failed at';

/**
 * Every badge the card can show.
 *
 * The freshness / breaker states the contract publishes, plus the two
 * states the contract itself names but the published vocabulary does
 * not (`loading`, and a settled failure that produced NO value). They
 * exist so a badge never has to borrow a neighbouring state's label.
 */
type ExternalBadgeKey = ExternalFreshness | ExternalBreakerState | 'loading' | 'failed';

const BADGE_LABEL: Readonly<Record<ExternalBadgeKey, string>> = {
	fresh: FRESH_LABEL,
	stale: STALE_LABEL,
	closed: FRESH_LABEL,
	open: BLOCKED_LABEL,
	'half-open': STALE_LABEL,
	loading: LOADING_LABEL,
	failed: FAILED_LABEL,
};

const BADGE_TONE: Readonly<Record<ExternalBadgeKey, 'accent' | 'neutral'>> = {
	fresh: 'accent',
	stale: 'neutral',
	closed: 'accent',
	open: 'neutral',
	'half-open': 'neutral',
	loading: 'neutral',
	failed: 'neutral',
};

/**
 * SSR-safe instant formatter.
 *
 * UTC on the server and in the browser alike: the INSTANT is the
 * contract, and a card that printed a different wall-clock string per
 * visitor would make the committed screenshot unreproducible.
 */
function formatInstant(iso: string | null): string {
	if (iso === null) return '—';
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return date
		.toISOString()
		.replace('T', ' ')
		.replace(/\.\d+Z$/, ' UTC');
}

/** The audit line: what was observed, and when the last failure happened. */
function timelineLine(snapshot: ExternalSnapshot<unknown>): string {
	if (snapshot.status === 'loading') return '—';
	if (snapshot.status === 'value')
		return `${OBSERVED_AT_LABEL} ${formatInstant(snapshot.observedAt)}`;
	const failed = `${FAILED_AT_LABEL} ${formatInstant(snapshot.failedAt)}`;
	if (snapshot.observedAt === null) return failed;
	return `${OBSERVED_AT_LABEL} ${formatInstant(snapshot.observedAt)} — ${failed}`;
}

/**
 * Which badge a snapshot earns.
 *
 * A blocked source outranks a stale value, and a state with no value
 * on screen never claims one: `loading` says it is loading and a
 * failed read with nothing to show says the read failed.
 */
function badgeKey(snapshot: ExternalSnapshot<unknown>): ExternalBadgeKey {
	if (snapshot.status === 'loading') return 'loading';
	if (snapshot.status === 'degraded') {
		if (snapshot.breaker === 'open') return 'open';
		return snapshot.value === null ? 'failed' : 'stale';
	}
	return snapshot.freshness;
}

export interface ExternalReadCardProps<T> {
	/** What the value IS, in the owner's words (e.g. 「公開リポジトリの事実」). */
	title: string;
	/** The declared source. Rendered as the audit line beside the title. */
	source: ExternalSource;
	snapshot: ExternalSnapshot<T>;
	/** Renders the published value. Never receives anything but the mapped allowlist. */
	renderValue: (value: T) => ReactNode;
	/**
	 * Retry handler. When omitted the card renders no control at all;
	 * when the source is blocked it renders a disabled one, because a
	 * button that silently does nothing is worse than no button.
	 */
	onRetry?: () => void;
	/** Marks the card busy while a retry is in flight. */
	busy?: boolean;
}

export function ExternalReadCard<T>({
	title,
	source,
	snapshot,
	renderValue,
	onRetry,
	busy = false,
}: ExternalReadCardProps<T>) {
	const value: T | null =
		snapshot.status === 'value'
			? snapshot.value
			: snapshot.status === 'degraded'
				? snapshot.value
				: null;
	const degraded = snapshot.status === 'degraded' ? snapshot : null;
	const key = badgeKey(snapshot);
	const retryDisabled = degraded !== null && !degraded.retryable;

	return (
		<section
			data-testid="external-read-card"
			data-status={snapshot.status}
			data-freshness={snapshot.status === 'value' ? snapshot.freshness : null}
			data-breaker={degraded?.breaker ?? null}
			aria-busy={snapshot.status === 'loading' || busy}
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '3',
				padding: '4',
				borderRadius: 'md',
				borderWidth: '1px',
				borderStyle: 'solid',
				borderColor: degraded?.breaker === 'open' ? 'accent.warning' : 'border.subtle',
				bg: 'bg.surface',
			})}
		>
			<header
				className={css({
					display: 'flex',
					flexWrap: 'wrap',
					alignItems: 'baseline',
					justifyContent: 'space-between',
					gap: '2',
				})}
			>
				<h3
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'lg',
						fontWeight: '700',
						color: 'text.default',
						lineHeight: '1.4',
					})}
				>
					{title}
					<span
						className={css({
							marginInlineStart: '3',
							fontFamily: 'mono',
							fontSize: 'sm',
							fontWeight: '400',
							color: 'text.muted',
						})}
					>
						{source.label}
					</span>
				</h3>
				<Badge tone={BADGE_TONE[key]}>{BADGE_LABEL[key]}</Badge>
			</header>

			{snapshot.status === 'loading' ? (
				<output
					data-testid="external-read-indicator"
					className={css({
						display: 'block',
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					{LOADING_LABEL}
				</output>
			) : null}

			{value !== null ? (
				<div
					data-testid="external-read-value"
					className={css({
						fontFamily: 'mono',
						fontSize: 'md',
						color: 'text.default',
					})}
				>
					{renderValue(value)}
				</div>
			) : null}

			{degraded !== null && value === null ? (
				<p
					data-testid="external-read-empty"
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'md',
						color: 'text.default',
					})}
				>
					{UNAVAILABLE_LABEL}
				</p>
			) : null}

			{degraded !== null ? (
				<output
					data-testid="external-read-failure"
					className={css({
						display: 'block',
						fontFamily: 'sans',
						fontSize: 'sm',
						color: degraded.breaker === 'open' ? 'accent.warning' : 'text.muted',
					})}
				>
					{degraded.value !== null ? `${FALLBACK_LABEL} — ` : ''}
					{EXTERNAL_FAILURE_LABEL[degraded.reason]}
				</output>
			) : null}

			<footer
				className={css({
					display: 'flex',
					flexWrap: 'wrap',
					alignItems: 'baseline',
					justifyContent: 'space-between',
					gap: '2',
				})}
			>
				<p
					className={css({
						margin: '0',
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					{timelineLine(snapshot)}
				</p>
				{degraded === null ? null : (
					<span className={css({ display: 'flex', alignItems: 'baseline', gap: '2' })}>
						{degraded.retryable ? null : (
							<span
								data-testid="external-read-blocked"
								className={css({
									fontFamily: 'mono',
									fontSize: 'sm',
									color: 'text.muted',
								})}
							>
								{NEXT_ATTEMPT_LABEL} {formatInstant(degraded.retryAt)}
							</span>
						)}
						{onRetry === undefined ? null : (
							<button
								type="button"
								data-testid="external-read-retry"
								disabled={retryDisabled || busy}
								onClick={onRetry}
								className={css({
									fontFamily: 'sans',
									fontSize: 'sm',
									fontWeight: '600',
									color: retryDisabled || busy ? 'text.muted' : 'text.inverse',
									bg: retryDisabled || busy ? 'bg.subtle' : 'bg.accent',
									borderRadius: 'full',
									paddingInline: '3',
									paddingBlock: '1',
									cursor: retryDisabled || busy ? 'not-allowed' : 'pointer',
								})}
							>
								{RETRY_LABEL}
							</button>
						)}
					</span>
				)}
			</footer>
		</section>
	);
}
