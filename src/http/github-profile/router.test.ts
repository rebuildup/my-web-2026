import { describe, expect, it } from 'vitest';
import { githubProfileRouter } from './router';

/**
 * Route-level contract for `GET /api/v1/github-profile/card`
 * (Issue #1170): always 200 + `image/svg+xml` + shared-cache opt-in,
 * honest degradation when the D1 snapshots are absent, and 405 for
 * non-GET methods.
 */

const ENV_BASE = {
	RATE_LIMIT_READ: { limit: async () => ({ success: true }) },
	MEDIA: {},
	MEDIA_PUBLIC_BASE_URL: 'https://rebuildup.dev/media',
	DISCORD_PRESENCE_USER_ID: '123456789012345678',
};

function fakeDb(payloads: Record<string, unknown>): D1Database {
	return {
		prepare(sql: string) {
			return {
				bind() {
					return this;
				},
				async first() {
					const table = sql.includes('github_activity_snapshot')
						? 'github_activity_snapshot'
						: sql.includes('discord_presence_snapshot')
							? 'discord_presence_snapshot'
							: null;
					const payload = table ? payloads[table] : undefined;
					return payload === undefined ? null : { payload: JSON.stringify(payload) };
				},
			};
		},
	} as unknown as D1Database;
}

const ACTIVITY = {
	schemaVersion: 1,
	generatedOn: '2026-11-22',
	windowDays: 7,
	sources: {
		public: { status: 'ok', observedAt: '2026-11-22T05:00:00Z' },
		private: { status: 'ok' },
	},
	repos: [{ id: 'rebuildup/tool-pomodoro', kind: 'public', name: 'tool-pomodoro' }],
	feed: [],
};

const PRESENCE = {
	generatedAt: new Date().toISOString(),
	userId: '123456789012345678',
	status: 'online',
	activities: [],
	isLive: true,
};

describe('GET /card', () => {
	it('answers 200 SVG with the shared-cache opt-in', async () => {
		const res = await githubProfileRouter.request('/card', { method: 'GET' }, {
			...ENV_BASE,
			DB: fakeDb({}),
		} as never);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('image/svg+xml');
		expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');
		const body = await res.text();
		expect(body).toContain('<svg');
		expect(body).toContain('rebuildup');
		// No snapshots → honest unavailable states, still a valid card.
		expect(body).toContain('No GitHub activity observed yet');
		expect(body).toContain('Discord presence unavailable');
	});

	it('renders live snapshot data when D1 rows exist', async () => {
		const res = await githubProfileRouter.request('/card', { method: 'GET' }, {
			...ENV_BASE,
			DB: fakeDb({ github_activity_snapshot: ACTIVITY, discord_presence_snapshot: PRESENCE }),
		} as never);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain('1 public · 0 private projects active');
		expect(body).toContain('Online');
	});

	it('embeds real cover bytes as data: URIs when MEDIA is bound', async () => {
		const png = new Uint8Array([137, 80, 78, 71]).buffer;
		const bucket = {
			head: async () => ({ size: 4, httpMetadata: { contentType: 'image/png' } }),
			get: async () => ({ arrayBuffer: async () => png }),
		} as unknown as R2Bucket;
		const res = await githubProfileRouter.request('/card', { method: 'GET' }, {
			...ENV_BASE,
			DB: fakeDb({}),
			MEDIA: bucket,
		} as never);
		expect(res.status).toBe(200);
		const body = await res.text();
		// The committed snapshot's first featured cover must be inlined —
		// remote <image href> would render blank under <img>.
		expect(body).toContain('data:image/');
		expect(body).not.toMatch(/<image[^>]*href="https?:\/\//);
	});

	it('rejects non-GET methods', async () => {
		const res = await githubProfileRouter.request('/card', { method: 'POST' }, {
			...ENV_BASE,
		} as never);
		expect(res.status).toBe(405);
	});
});

describe('GET /status', () => {
	it('answers 200 SVG with the shared-cache opt-in and no raster media', async () => {
		const res = await githubProfileRouter.request('/status', { method: 'GET' }, {
			...ENV_BASE,
			DB: fakeDb({}),
		} as never);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('image/svg+xml');
		expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');
		const body = await res.text();
		expect(body).toContain('<svg');
		expect(body).toContain('GITHUB ACTIVITY');
		expect(body).toContain('DISCORD');
		expect(body).not.toContain('data:image');
		expect(body).not.toContain('<image');
	});

	it('renders live snapshot data when D1 rows exist', async () => {
		const res = await githubProfileRouter.request('/status', { method: 'GET' }, {
			...ENV_BASE,
			DB: fakeDb({ github_activity_snapshot: ACTIVITY, discord_presence_snapshot: PRESENCE }),
		} as never);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain('1 public · 0 private projects active');
		expect(body).toContain('Online');
	});

	it('rejects non-GET methods', async () => {
		const res = await githubProfileRouter.request('/status', { method: 'POST' }, {
			...ENV_BASE,
		} as never);
		expect(res.status).toBe(405);
	});
});

describe('GET /now', () => {
	it('answers 200 SVG with the shared-cache opt-in and honest unavailable stats', async () => {
		const res = await githubProfileRouter.request('/now', { method: 'GET' }, {
			...ENV_BASE,
			DB: fakeDb({}),
		} as never);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('image/svg+xml');
		expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');
		const body = await res.text();
		expect(body).toContain('<svg');
		expect(body).toContain('NOW · @rebuildup');
		expect(body).toContain('CURRENT STREAK');
		expect(body).toContain('TOP LANGUAGE');
		// No GitHub token in the test env → stats render as unavailable,
		// never as invented numbers.
		expect(body).toContain('unavailable');
		expect(body).not.toContain('<image');
	});

	it('rejects non-GET methods', async () => {
		const res = await githubProfileRouter.request('/now', { method: 'POST' }, {
			...ENV_BASE,
		} as never);
		expect(res.status).toBe(405);
	});
});
