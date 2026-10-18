import { describe, expect, it } from 'vitest';
import { ExternalReadError, type ExternalSource, resolveReadPolicy } from './contract';
import {
	GITHUB_REPO_FACT_KEYS,
	GITHUB_REPO_SOURCE,
	createGitHubRepoAdapter,
	parseGitHubRepoFacts,
} from './github';
import { createExternalReader } from './reader';

/**
 * Adapter #1 contract tests (Issue #499).
 *
 * Three jobs:
 *
 *   1. the mapping is an ALLOWLIST — a field that is not named in
 *      `GitHubRepoFacts` cannot reach a component, including the
 *      personal fields GitHub does return (`owner.email`),
 *   2. the read carries no credential and states its budget,
 *   3. the upstream's failure modes surface as the public reasons the
 *      display layer already renders.
 *
 * No test here opens a socket: the transport is injected.
 */

const policy = resolveReadPolicy({ timeoutMs: 50, maxResponseBytes: 4096 });

const FULL_PAYLOAD = {
	id: 1_234_567,
	name: 'my-web-2026',
	full_name: 'rebuildup/my-web-2026',
	private: false,
	owner: {
		login: 'rebuildup',
		name: 'Rebuild Up',
		email: 'owner@example.invalid',
		type: 'User',
	},
	license: {
		key: 'mit',
		name: 'MIT License',
		spdx_id: 'MIT',
		url: 'https://api.github.com/licenses/mit',
	},
	stargazers_count: 12,
	forks_count: 3,
	open_issues_count: 0,
	pushed_at: '2026-10-17T12:00:00Z',
	network_count: 12,
	subscribers_count: 4,
	permissions: { admin: false, push: false },
};

function adapterOver(body: string, status = 200) {
	return createGitHubRepoAdapter({
		policy,
		fetchImpl: async () => new Response(body, { status }),
	});
}

describe('source declaration', () => {
	it('states the exact endpoint and sends no credential', () => {
		expect(GITHUB_REPO_SOURCE.endpoint).toBe('https://api.github.com/repos/rebuildup/my-web-2026');
		expect(GITHUB_REPO_SOURCE.label).toBe('api.github.com');
		expect(GITHUB_REPO_SOURCE.sendsCredentials).toBe(false);
		expect(GITHUB_REPO_SOURCE.budgetNote).toMatch(/60 requests\/hour/);
	});

	it('satisfies the shared source contract', () => {
		const source: ExternalSource = GITHUB_REPO_SOURCE;
		expect(source.id).toBe('github-repo');
	});
});

describe('allowlisted mapping', () => {
	it('produces exactly the published keys', () => {
		const facts = parseGitHubRepoFacts(FULL_PAYLOAD);
		expect(Object.keys(facts).sort()).toEqual([...GITHUB_REPO_FACT_KEYS].sort());
	});

	it('maps the published fields', () => {
		expect(parseGitHubRepoFacts(FULL_PAYLOAD)).toEqual({
			stars: 12,
			forks: 3,
			openIssues: 0,
			license: 'MIT',
			pushedAt: '2026-10-17T12:00:00.000Z',
		});
	});

	it('never copies a personal field out of the payload', () => {
		const facts: Record<string, unknown> = { ...parseGitHubRepoFacts(FULL_PAYLOAD) };
		const serialized = JSON.stringify(facts);
		expect(serialized).not.toContain('owner@example.invalid');
		expect(serialized).not.toContain('Rebuild Up');
		expect(Object.keys(facts)).not.toContain('owner');
		expect(Object.keys(facts)).not.toContain('network_count');
	});

	it('reports a missing count as unknown rather than zero', () => {
		const facts = parseGitHubRepoFacts({ private: false, license: null });
		expect(facts).toEqual({
			stars: null,
			forks: null,
			openIssues: null,
			license: null,
			pushedAt: null,
		});
	});

	it('rejects a negative, fractional or non-numeric count', () => {
		const facts = parseGitHubRepoFacts({
			private: false,
			stargazers_count: -1,
			forks_count: 1.5,
			open_issues_count: '12',
		});
		expect(facts.stars).toBeNull();
		expect(facts.forks).toBeNull();
		expect(facts.openIssues).toBeNull();
	});

	it('keeps only a plausible SPDX identifier', () => {
		expect(
			parseGitHubRepoFacts({ private: false, license: { spdx_id: 'NOASSERTION' } }).license,
		).toBeNull();
		expect(
			parseGitHubRepoFacts({ private: false, license: { spdx_id: 'SEE LICENSE IN' } }).license,
		).toBeNull();
		expect(
			parseGitHubRepoFacts({ private: false, license: { spdx_id: 'Apache-2.0' } }).license,
		).toBe('Apache-2.0');
		expect(parseGitHubRepoFacts({ private: false, license: 'MIT' }).license).toBeNull();
	});

	it('normalises an instant and refuses an unparseable one', () => {
		expect(
			parseGitHubRepoFacts({ private: false, pushed_at: '2026-10-17T12:00:00Z' }).pushedAt,
		).toBe('2026-10-17T12:00:00.000Z');
		expect(parseGitHubRepoFacts({ private: false, pushed_at: 'yesterday' }).pushedAt).toBeNull();
	});

	it('refuses a payload that reports a private repository', () => {
		expect(() => parseGitHubRepoFacts({ ...FULL_PAYLOAD, private: true })).toThrow(
			ExternalReadError,
		);
	});

	it('refuses a non-object payload', () => {
		for (const payload of [null, 'a string', 42, [1, 2, 3]]) {
			expect(() => parseGitHubRepoFacts(payload)).toThrow(ExternalReadError);
		}
	});
});

describe('transport contract', () => {
	it('requests the declared endpoint once and parses the response', async () => {
		const urls: string[] = [];
		const adapter = createGitHubRepoAdapter({
			policy,
			fetchImpl: async (url) => {
				urls.push(url);
				return new Response(JSON.stringify(FULL_PAYLOAD), { status: 200 });
			},
		});
		const facts = await adapter.read(new AbortController().signal);
		expect(urls).toEqual([GITHUB_REPO_SOURCE.endpoint]);
		expect(facts.license).toBe('MIT');
	});

	it('sends no authorization header', async () => {
		let seen: Headers | undefined;
		const adapter = createGitHubRepoAdapter({
			policy,
			fetchImpl: async (_url, init) => {
				seen = new Headers(init?.headers);
				return new Response(JSON.stringify(FULL_PAYLOAD), { status: 200 });
			},
		});
		await adapter.read(new AbortController().signal);
		expect(seen?.has('authorization')).toBe(false);
		expect(seen?.has('cookie')).toBe(false);
	});

	it('negotiates the GitHub media type as the adapter-side decision it is', async () => {
		let seen: Headers | undefined;
		const adapter = createGitHubRepoAdapter({
			policy,
			fetchImpl: async (_url, init) => {
				seen = new Headers(init?.headers);
				return new Response(JSON.stringify(FULL_PAYLOAD), { status: 200 });
			},
		});
		await adapter.read(new AbortController().signal);
		expect(seen?.get('accept')).toBe('application/vnd.github+json');
	});

	it('surfaces an upstream 404 as the public not-found reason', async () => {
		const adapter = adapterOver('{"message":"Not Found"}', 404);
		const reader = createExternalReader(adapter, { policy });
		const snapshot = await reader.read();
		expect(snapshot.status === 'degraded' && snapshot.reason).toBe('not-found');
	});

	it('surfaces an upstream 403 as the public rate-limited reason', async () => {
		const adapter = adapterOver(
			'{"message":"API rate limit exceeded for 203.0.113.9 (Authenticated requests get a higher rate limit.)"}',
			403,
		);
		const reader = createExternalReader(adapter, { policy });
		const snapshot = await reader.read();
		expect(snapshot.status === 'degraded' && snapshot.reason).toBe('rate-limited');
		expect(snapshot.status === 'degraded' && snapshot.retryable).toBe(true);
	});

	it('refuses a private-repository payload as malformed-response', async () => {
		const adapter = adapterOver(JSON.stringify({ ...FULL_PAYLOAD, private: true }), 200);
		const reader = createExternalReader(adapter, { policy });
		const snapshot = await reader.read();
		expect(snapshot.status === 'degraded' && snapshot.reason).toBe('malformed-response');
	});

	it('degrades with a null value and no invented zero when the read fails', async () => {
		const adapter = adapterOver('{"message":"Not Found"}', 404);
		const reader = createExternalReader(adapter, { policy });
		const snapshot = await reader.read();
		expect(snapshot.status).toBe('degraded');
		expect(snapshot.status === 'degraded' && snapshot.value).toBeNull();
		expect(snapshot.status === 'degraded' && snapshot.observedAt).toBeNull();
	});
});
