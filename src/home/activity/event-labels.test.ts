import { describe, expect, it } from 'vitest';
import { githubEventTypeLabelJa } from './event-labels';

describe('githubEventTypeLabelJa', () => {
	it('maps the common public-event types to short Japanese labels', () => {
		expect(githubEventTypeLabelJa('PushEvent')).toBe('プッシュ');
		expect(githubEventTypeLabelJa('CreateEvent')).toBe('作成');
		expect(githubEventTypeLabelJa('DeleteEvent')).toBe('削除');
		expect(githubEventTypeLabelJa('PullRequestEvent')).toBe('PR');
		expect(githubEventTypeLabelJa('IssuesEvent')).toBe('Issue');
		expect(githubEventTypeLabelJa('WatchEvent')).toBe('スター');
		expect(githubEventTypeLabelJa('ReleaseEvent')).toBe('リリース');
	});

	it('falls back to the raw type for unknown values (no guessing)', () => {
		expect(githubEventTypeLabelJa('SomeFutureEvent')).toBe('SomeFutureEvent');
		expect(githubEventTypeLabelJa('')).toBe('');
	});
});
