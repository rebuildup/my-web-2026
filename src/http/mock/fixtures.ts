/**
 * Canned data + mutable in-memory state for the LOCAL_API_MODE=mock
 * design-verification layer (Issue #166).
 *
 * Mock scope (per Issue #166):
 *   - `/api/v1/auth/session`, `/sign-in/email`, `/sign-out`
 *   - `/api/v1/access/count`, `/hit`, `/principal`
 *   - `/api/v1/reactions/[slug]`, `/[slug]/toggle`
 *
 * Out-of-scope (intentionally NOT mocked):
 *   - `/api/v1/portfolio/*` — empty state is the design target.
 *   - `/api/v1/keys/*`, `/api/v1/emoji-catalog/*`,
 *     `/api/v1/auth-invitations/*` — admin scope, not design verification.
 *
 * State semantics:
 *   - `mockAccessCount` starts at 1234 and increments on every `/hit`
 *     call during the lifetime of the dev server process.
 *   - `mockReactions` is keyed by `slug`; the `/toggle` endpoint
 *     bumps the count for the targeted emoji by ±1 (incoming body
 *     declares direction).
 *
 * Design-verification-only — no auth, no rate limit, no D1. Production
 * code path (env unset) is unaffected — see `src/http/hono.ts`.
 */

export interface MockSessionUser {
	id: string;
	email: string;
	name: string;
	role: 'admin' | 'user';
}

export interface MockSession {
	user: MockSessionUser;
	session: { id: string; expiresAt: string };
}

export interface MockReaction {
	emoji: string;
	count: number;
}

export const FIXTURE_SESSION: MockSession = {
	user: {
		id: 'mock-user-1',
		email: 'designer@rebuildup.dev',
		name: 'Mock Designer',
		role: 'admin',
	},
	session: {
		id: 'mock-session-1',
		expiresAt: '2099-01-01T00:00:00.000Z',
	},
};

const INITIAL_REACTIONS: Record<string, MockReaction[]> = {
	'home-page': [
		{ emoji: '👍', count: 12 },
		{ emoji: '🎉', count: 7 },
		{ emoji: '❤️', count: 5 },
		{ emoji: '🔥', count: 3 },
	],
};

const INITIAL_ACCESS_COUNT = 1234;

/**
 * Module-level mutable state. Mock mode is single-process by design
 * (it's a design tool, not a server). The reset helper exists so tests
 * can start from the canonical initial values.
 */
let mockAccessCount = INITIAL_ACCESS_COUNT;
let mockReactions: Record<string, MockReaction[]> = {
	'home-page': [...INITIAL_REACTIONS['home-page']],
};

export function getMockAccessCount(): number {
	return mockAccessCount;
}

export function bumpMockAccessCount(delta: number): number {
	mockAccessCount = Math.max(0, mockAccessCount + delta);
	return mockAccessCount;
}

export function getMockAccessPrincipalCount(): number {
	// Per-principal counter is always 1 in mock mode — the access
	// counter widget renders this as a KPI tile; the exact number is
	// not load-bearing for design verification.
	return 1;
}

export function getMockReactions(slug: string): MockReaction[] {
	const existing = mockReactions[slug];
	if (existing) return existing.map((r) => ({ ...r }));
	return [];
}

export function toggleMockReaction(
	slug: string,
	emoji: string,
	direction: 'add' | 'remove',
): MockReaction[] {
	const current = mockReactions[slug] ?? [];
	const idx = current.findIndex((r) => r.emoji === emoji);
	if (direction === 'add') {
		if (idx >= 0) {
			current[idx] = { ...current[idx], count: current[idx].count + 1 };
		} else {
			current.push({ emoji, count: 1 });
		}
	} else {
		if (idx >= 0) {
			if (current[idx].count > 1) {
				current[idx] = { ...current[idx], count: current[idx].count - 1 };
			} else {
				current.splice(idx, 1);
			}
		}
	}
	mockReactions[slug] = current;
	return current.map((r) => ({ ...r }));
}

/** Reset all mutable mock state to its initial value (test helper). */
export function resetMockState(): void {
	mockAccessCount = INITIAL_ACCESS_COUNT;
	mockReactions = {
		'home-page': [...INITIAL_REACTIONS['home-page']],
	};
}
