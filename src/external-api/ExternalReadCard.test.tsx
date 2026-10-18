import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExternalReadCard } from './ExternalReadCard';
import {
	type ExternalSnapshot,
	type ExternalSource,
	applyFailure,
	applySuccess,
	initialBreaker,
} from './contract';

/**
 * SSR markup tests for the display surface (Issue #499).
 *
 * `renderToStaticMarkup` is the shipped rendering path, and it is
 * enough for the properties the Issue asks about — what a VISITOR can
 * read in each state. The assertions are therefore about presence and
 * absence:
 *
 *   - the spinner exists only in `loading`, never beside a value,
 *   - a degraded card with a value keeps that value visible,
 *   - the retry control is disabled exactly when the source is
 *     blocked, and absent when there is nothing to retry,
 *   - every badge names the state actually on screen — no state ever
 *     borrows a neighbour's label,
 *   - no upstream detail has a path into the markup.
 */

const T0 = Date.parse('2026-10-18T00:00:00.000Z');

const SOURCE = {
	id: 'github-repo',
	label: 'api.github.com',
	endpoint: 'https://api.github.com/repos/rebuildup/my-web-2026',
	sendsCredentials: false,
	budgetNote: 'unauthenticated read',
} as const satisfies ExternalSource;

const FACTS = { stars: 12, forks: 3, openIssues: 0, license: 'MIT', pushedAt: null };

function render(snapshot: ExternalSnapshot<typeof FACTS>, onRetry?: () => void): string {
	return renderToStaticMarkup(
		<ExternalReadCard
			title="公開リポジトリの事実 / Public repository facts"
			source={SOURCE}
			snapshot={snapshot}
			onRetry={onRetry}
			renderValue={(value) => (
				<ul>
					{Object.entries(value).map(([key, entry]) => (
						<li key={key}>
							{key}: {String(entry)}
						</li>
					))}
				</ul>
			)}
		/>,
	);
}

const healthy: ExternalSnapshot<typeof FACTS> = applySuccess(FACTS, T0);

const DEFAULTS = {
	timeoutMs: 3_000,
	staleAfterMs: 21_600_000,
	failureThreshold: 3,
	openMs: 60_000,
	retryBaseMs: 1_000,
	retryMaxMs: 60_000,
	maxResponseBytes: 65_536,
};

function degradedWithValue(overrides: { breaker?: 'closed' | 'open' } = {}) {
	const open = overrides.breaker === 'open';
	return applyFailure(
		healthy,
		open ? 'rate-limited' : 'timeout',
		T0 + 60_000,
		{
			state: overrides.breaker ?? 'closed',
			consecutiveFailures: open ? 3 : 1,
			openedAt: open ? T0 : null,
		},
		DEFAULTS,
	);
}

describe('loading state', () => {
	it('shows a status message and no value', () => {
		const html = render({ status: 'loading' });
		expect(html).toContain('data-testid="external-read-indicator"');
		expect(html).toContain('読み込み中');
		expect(html).not.toContain('data-testid="external-read-value"');
		expect(html).toContain('aria-busy="true"');
	});

	it('badges itself as loading, never as a settled state', () => {
		// The badge must describe what is on screen. A loading card shows
		// NO value, so a stale-value badge there would tell a visitor a
		// lie about the data behind the spinner.
		const html = render({ status: 'loading' });
		expect(html).toContain('読み込み中 / Loading');
		expect(html).not.toContain('古い値を表示中');
		expect(html).not.toContain('取得済み');
		expect(html).not.toContain('遮断中');
	});

	it('offers no retry control — there is nothing to retry yet', () => {
		expect(render({ status: 'loading' }, () => {})).not.toContain('external-read-retry');
	});
});

describe('fresh value', () => {
	it('renders the value with its observation instant and no failure line', () => {
		const html = render(healthy);
		expect(html).toContain('data-testid="external-read-value"');
		expect(html).toContain('stars: 12');
		expect(html).toContain('observed at 2026-10-18 00:00:00 UTC');
		expect(html).not.toContain('data-testid="external-read-failure"');
		expect(html).not.toContain('data-testid="external-read-indicator"');
		expect(html).toContain('data-status="value"');
		expect(html).toContain('data-freshness="fresh"');
	});

	it('names the source it read', () => {
		expect(render(healthy)).toContain('api.github.com');
	});

	it('renders no retry control while the read is healthy', () => {
		expect(render(healthy, () => {})).not.toContain('external-read-retry');
	});
});

describe('stale value', () => {
	it('keeps the value visible and says it is stale', () => {
		const stale = { ...healthy, status: 'value', freshness: 'stale' } as const;
		const html = render(stale);
		expect(html).toContain('data-testid="external-read-value"');
		expect(html).toContain('data-freshness="stale"');
		expect(html).toContain('古い値を表示中');
		expect(html).not.toContain('data-testid="external-read-indicator"');
	});
});

describe('degraded with a value (non-destructive fallback)', () => {
	it('still renders the last known value', () => {
		const html = render(degradedWithValue());
		expect(html).toContain('data-testid="external-read-value"');
		expect(html).toContain('stars: 12');
		expect(html).toContain('data-status="degraded"');
	});

	it('states the reason, both failure and observation instants', () => {
		const html = render(degradedWithValue());
		expect(html).toContain('data-testid="external-read-failure"');
		expect(html).toContain('応答时间内');
		expect(html).toContain('observed at 2026-10-18 00:00:00 UTC');
		expect(html).toContain('failed at 2026-10-18 00:01:00 UTC');
		expect(html).toContain('前回の値を表示中');
	});

	it('never shows the loading indicator beside a value', () => {
		expect(render(degradedWithValue())).not.toContain('external-read-indicator');
	});

	it('badges the held value as stale, which is what is on screen', () => {
		const html = render(degradedWithValue());
		expect(html).toContain('古い値を表示中');
		expect(html).not.toContain('取得失敗');
	});

	it('offers an enabled retry', () => {
		const html = render(degradedWithValue(), () => {});
		expect(html).toContain('data-testid="external-read-retry"');
		expect(html).toContain('再試行');
		expect(html).not.toMatch(/data-testid="external-read-retry"[^>]*disabled/);
	});
});

describe('degraded without a value', () => {
	it('says the value is unavailable instead of showing a spinner', () => {
		const failed = applyFailure<typeof FACTS>(
			{ status: 'loading' },
			'network',
			T0,
			initialBreaker(),
			DEFAULTS,
		);
		const html = render(failed, () => {});
		expect(html).toContain('data-testid="external-read-empty"');
		expect(html).toContain('値を取得できません');
		expect(html).not.toContain('data-testid="external-read-indicator"');
		expect(html).not.toContain('data-testid="external-read-value"');
		expect(html).toContain('接続不可');
	});

	it('offers an enabled retry from the very first failure', () => {
		const failed = applyFailure<typeof FACTS>(
			{ status: 'loading' },
			'network',
			T0,
			initialBreaker(),
			DEFAULTS,
		);
		expect(render(failed, () => {})).toContain('data-testid="external-read-retry"');
	});

	it('badges a failed read with no value as failed, not as a stale value', () => {
		// Nothing is displayed, so 「古い値を表示中」 would be false here
		// exactly as it is in the loading state.
		const failed = applyFailure<typeof FACTS>(
			{ status: 'loading' },
			'network',
			T0,
			initialBreaker(),
			DEFAULTS,
		);
		const html = render(failed, () => {});
		expect(html).toContain('取得失敗 / Read failed');
		expect(html).not.toContain('古い値を表示中');
	});
});

describe('blocked source (breaker open)', () => {
	it('keeps the value and states the next probe instant', () => {
		const html = render(degradedWithValue({ breaker: 'open' }), () => {});
		expect(html).toContain('data-testid="external-read-value"');
		expect(html).toContain('data-breaker="open"');
		expect(html).toContain('data-testid="external-read-blocked"');
		expect(html).toContain('次の試行 / Next attempt 2026-10-18 00:01:00 UTC');
		expect(html).toContain('遮断中');
	});

	it('disables the retry so the control cannot look actionable', () => {
		const html = render(degradedWithValue({ breaker: 'open' }), () => {});
		expect(html).toMatch(/data-testid="external-read-retry"[^>]*disabled/);
	});

	it('marks the source as rate limited rather than guessing', () => {
		expect(render(degradedWithValue({ breaker: 'open' }))).toContain('回数制限');
	});
});

describe('public-surface discipline', () => {
	it('renders no upstream detail, credential or exception text', () => {
		const html = render(degradedWithValue({ breaker: 'open' }));
		for (const forbidden of [
			'api.github.com/repos', // endpoint beyond the declared host label
			'Bearer',
			'Authorization',
			'Error:',
			'stack',
		]) {
			expect(html).not.toContain(forbidden);
		}
	});

	it('states the audit line through the declared source only', () => {
		// The host is public by declaration; the path and any query are not.
		expect(render(healthy)).not.toContain('/repos/');
	});
});
