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
							: sql.includes('github_stats_snapshot')
								? 'github_stats_snapshot'
								: null;
					const payload = table ? payloads[table] : undefined;
					return payload === undefined
						? null
						: {
								payload: JSON.stringify(payload),
								received_at: new Date().toISOString(),
							};
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

const STATS = {
	schemaVersion: 1,
	generatedOn: '2026-11-25',
	observedAt: '2026-11-25T00:00:00Z',
	owner: 'rebuildup',
	sources: {
		graphql: { status: 'ok', observedAt: '2026-11-25T00:00:00Z' },
		streak: { status: 'ok' },
		search: { status: 'ok' },
		avatar: { status: 'ok' },
	},
	streak: {
		currentStreak: 12,
		longestStreak: 30,
		totalContributions: 4211,
		firstContribution: '2024-01-01',
		currentStreakStart: '2026-11-14',
		currentStreakEnd: '2026-11-25',
		longestStreakStart: '2026-10-01',
		longestStreakEnd: '2026-10-30',
	},
	metrics: {
		contributionsY1: 800,
		reviewsY1: 5,
		commitsAuthoredAllTime: 900,
		prsAuthoredAllTime: 100,
		issuesAuthoredAllTime: 40,
		prsOpenedAllTime: 90,
		issuesOpenedAllTime: 35,
		contributedTo: 7,
		followers: 10,
	},
	repos: { owned: 20, contributedTo: 7, participated: 12, complete: true },
	stars: { owned: 55, participated: 60 },
	languages: {
		owned: [
			{ name: 'TypeScript', color: '#3178c6', size: 700, count: 10 },
			{ name: 'Rust', color: '#dea584', size: 300, count: 4 },
		],
		participated: [],
	},
	rank: {
		inputs: {
			all_commits: true,
			commits: 900,
			prs: 100,
			issues: 40,
			reviews: 5,
			repos: 20,
			stars: 55,
			followers: 10,
		},
		current: { level: 'A', percentile: 5 },
		legacy: { level: 'A+', percentile: 2 },
	},
	avatarDataUri: 'data:image/png;base64,iVBORw0KGgo=',
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

describe('GET /vitals', () => {
	it('answers 200 SVG with honest unavailable stats when no snapshot exists', async () => {
		const res = await githubProfileRouter.request('/vitals', { method: 'GET' }, {
			...ENV_BASE,
			DB: fakeDb({}),
		} as never);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('image/svg+xml');
		expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');
		const body = await res.text();
		expect(body).toContain('<svg');
		expect(body).toContain('streak');
	});

	it('renders snapshot figures when the stats row exists', async () => {
		const res = await githubProfileRouter.request('/vitals', { method: 'GET' }, {
			...ENV_BASE,
			DB: fakeDb({ github_stats_snapshot: STATS }),
		} as never);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain('4,211');
		expect(body).toContain('900');
		expect(body).toContain('55');
	});

	it('rejects non-GET methods', async () => {
		const res = await githubProfileRouter.request('/vitals', { method: 'POST' }, {
			...ENV_BASE,
		} as never);
		expect(res.status).toBe(405);
	});

	it('renders the participated-scope lane when the snapshot measured it (Issue #1262)', async () => {
		const res = await githubProfileRouter.request('/vitals', { method: 'GET' }, {
			...ENV_BASE,
			DB: fakeDb({ github_stats_snapshot: STATS }),
		} as never);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain('PARTICIPATED');
		expect(body).toContain('projects');
		expect(body).toContain('>60<');
	});

	it('hides the participated lane when the scope was not measured', async () => {
		const unmeasured = {
			...STATS,
			metrics: { ...STATS.metrics, contributedTo: null },
			repos: { ...STATS.repos, participated: null },
			stars: { ...STATS.stars, participated: null },
		};
		const res = await githubProfileRouter.request('/vitals', { method: 'GET' }, {
			...ENV_BASE,
			DB: fakeDb({ github_stats_snapshot: unmeasured }),
		} as never);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).not.toContain('PARTICIPATED');
	});
});

describe('GET /top-languages', () => {
	it('answers 200 SVG with an honest unavailable state when no snapshot exists', async () => {
		const res = await githubProfileRouter.request('/top-languages', { method: 'GET' }, {
			...ENV_BASE,
			DB: fakeDb({}),
		} as never);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('image/svg+xml');
		const body = await res.text();
		expect(body).toContain('language data unavailable');
	});

	it('renders the owned-scope language bar when the stats row exists', async () => {
		const res = await githubProfileRouter.request('/top-languages', { method: 'GET' }, {
			...ENV_BASE,
			DB: fakeDb({ github_stats_snapshot: STATS }),
		} as never);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain('TypeScript');
		expect(body).toContain('70.0%');
	});

	it('rejects non-GET methods', async () => {
		const res = await githubProfileRouter.request('/top-languages', { method: 'POST' }, {
			...ENV_BASE,
		} as never);
		expect(res.status).toBe(405);
	});

	it('renders the participated-scope bar when the snapshot measured it (Issue #1262)', async () => {
		const withParticipated = {
			...STATS,
			languages: {
				...STATS.languages,
				participated: [
					{ name: 'Rust', color: '#dea584', size: 800, count: 6 },
					{ name: 'Go', color: '#00add8', size: 200, count: 2 },
				],
			},
		};
		const res = await githubProfileRouter.request('/top-languages', { method: 'GET' }, {
			...ENV_BASE,
			DB: fakeDb({ github_stats_snapshot: withParticipated }),
		} as never);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain('OWNED REPOS');
		expect(body).toContain('PARTICIPATED REPOS');
		expect(body).toContain('Rust');
		expect(body).toContain('80.0%');
	});
});

describe('GET /profile stats wiring', () => {
	it('feeds vitals and the avatar from the stats snapshot, not upstream', async () => {
		const res = await githubProfileRouter.request('/profile', { method: 'GET' }, {
			...ENV_BASE,
			DB: fakeDb({
				github_activity_snapshot: ACTIVITY,
				discord_presence_snapshot: PRESENCE,
				github_stats_snapshot: STATS,
			}),
		} as never);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain('data:image/png;base64');
		expect(body).toContain('4,211');
		expect(body).toContain('TypeScript');
	});
});

describe('GET /snapshot-health (Issue #1254)', () => {
	it('reports every source fresh when all snapshot rows exist', async () => {
		const res = await githubProfileRouter.request('/snapshot-health', { method: 'GET' }, {
			...ENV_BASE,
			DB: fakeDb({
				github_activity_snapshot: ACTIVITY,
				discord_presence_snapshot: PRESENCE,
				github_stats_snapshot: STATS,
			}),
		} as never);
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		const body = (await res.json()) as {
			sources: Array<Record<string, unknown>>;
		};
		expect(body.sources).toHaveLength(3);
		for (const source of body.sources) {
			expect(source.state).toBe('fresh');
			expect(source.receivedAt).toBeTruthy();
		}
	});

	it('reports absent — not stale — when no snapshot rows exist', async () => {
		const res = await githubProfileRouter.request('/snapshot-health', { method: 'GET' }, {
			...ENV_BASE,
			DB: fakeDb({}),
		} as never);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			sources: Array<Record<string, unknown>>;
		};
		for (const source of body.sources) {
			expect(source.state).toBe('absent');
			expect(source.receivedAt).toBeNull();
			expect(source.ageSeconds).toBeNull();
		}
	});

	it('rejects non-GET methods', async () => {
		const res = await githubProfileRouter.request('/snapshot-health', { method: 'POST' }, {
			...ENV_BASE,
		} as never);
		expect(res.status).toBe(405);
	});
});
