/**
 * Adapter #1: public repository metadata from the GitHub REST API
 * (Issue #499).
 *
 * Scope, stated so nothing here is inferred:
 *
 *   - ONE `GET /repos/{owner}/{repo}` against the canonical public
 *     repository recorded in `AGENTS.md` §1. No events, no webhooks,
 *     no OAuth, no write.
 *   - UNAUTHENTICATED. The read renders a public fact, so it attaches
 *     no credential; `ExternalSource.sendsCredentials` is typed as the
 *     literal `false` and `timeout.ts` refuses `authorization` /
 *     `cookie` headers outright. The consequence is a real budget —
 *     60 requests per hour per source IP, unauthenticated — which is
 *     why `DEFAULT_EXTERNAL_READ_POLICY.staleAfterMs` is measured in
 *     hours and why the reader coalesces concurrent attempts.
 *   - PUBLIC FIELDS ONLY. `parseGitHubRepoFacts` is an allowlist: a
 *     field that is not named there cannot reach a component, so
 *     `owner.email`, a private-repository payload, or a field GitHub
 *     adds later cannot leak into a published surface by default.
 *
 * This adapter is NOT wired to a route. Per `docs/domain/integrations.md`
 * a third-party integration is promoted only when a capability needs
 * it; until then this is the reference implementation the contract is
 * proven against, and the repository makes no outbound request at
 * runtime. The owner decision to promote it (and the outbound
 * communication that follows) is recorded in
 * `docs/verification/ops/api-timeout-fallback.md`.
 */

import { ExternalReadError, type ExternalSource } from './contract';
import type { ExternalAdapter } from './reader';
import { type FetchLike, readJson } from './timeout';

/** The one source this adapter reads, declared for the audit surface. */
export const GITHUB_REPO_SOURCE = {
	id: 'github-repo',
	label: 'api.github.com',
	endpoint: 'https://api.github.com/repos/rebuildup/my-web-2026',
	sendsCredentials: false,
	budgetNote:
		'unauthenticated read — 60 requests/hour per source IP; the reader coalesces concurrent attempts',
} as const satisfies ExternalSource;

/**
 * The facts this adapter publishes.
 *
 * Every field is nullable on purpose: a missing count is shown as
 * unknown, never as zero. Nullability is also the non-destructive
 * half of the contract — a partial upstream document still renders.
 */
export interface GitHubRepoFacts {
	/** `stargazers_count`, when a non-negative integer. */
	readonly stars: number | null;
	/** `forks_count`, when a non-negative integer. */
	readonly forks: number | null;
	/**
	 * `open_issues_count`, when a non-negative integer — ISSUES **AND
	 * PULL REQUESTS**.
	 *
	 * The name says so because GitHub's REST API counts every open
	 * pull request as an issue
	 * (https://docs.github.com/en/rest/issues/issues), so publishing
	 * the number as `openIssues` would show a visitor a count larger
	 * than the repository's open issues. Excluding pull requests would
	 * cost a SECOND unauthenticated request against a 60/hour budget,
	 * which this adapter does not spend: the honest number under an
	 * honest name is the cheaper contract.
	 */
	readonly openIssuesAndPullRequests: number | null;
	/** `license.spdx_id` — the identifier only, never license prose. */
	readonly license: string | null;
	/** `pushed_at`, normalised to an ISO instant. */
	readonly pushedAt: string | null;
}

/**
 * The one request this adapter makes, stated once.
 *
 * `accept` is GitHub's own media type: the transport sends no
 * source-specific header of its own, so content negotiation stays the
 * adapter's decision and a second adapter cannot inherit it.
 */
const GITHUB_REPO_REQUEST = {
	url: GITHUB_REPO_SOURCE.endpoint,
	headers: { accept: 'application/vnd.github+json' },
} as const;

/** Keys the allowlist may produce. A test pins this list. */
export const GITHUB_REPO_FACT_KEYS = [
	'stars',
	'forks',
	'openIssuesAndPullRequests',
	'license',
	'pushedAt',
] as const;

function countOf(payload: Record<string, unknown>, key: string): number | null {
	const value = payload[key];
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/**
 * SPDX identifiers are a short, closed alphabet. Anything else is not
 * rendered rather than normalised into something that looks like a
 * licence it is not.
 */
function spdxIdOf(payload: Record<string, unknown>): string | null {
	const license = payload.license;
	if (typeof license !== 'object' || license === null) return null;
	const spdxId = (license as Record<string, unknown>).spdx_id;
	if (typeof spdxId !== 'string') return null;
	if (spdxId === 'NOASSERTION') return null;
	return /^[A-Za-z0-9.+-]{1,64}$/.test(spdxId) ? spdxId : null;
}

function isoInstantOf(payload: Record<string, unknown>, key: string): string | null {
	const value = payload[key];
	if (typeof value !== 'string') return null;
	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * Map a repository document onto the published allowlist.
 *
 * Throws `malformed-response` when the payload is not an object, or
 * when it reports `private: true` — a public read must never render
 * private-repository metadata, whatever the reason it received it.
 */
export function parseGitHubRepoFacts(payload: unknown): GitHubRepoFacts {
	if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
		throw new ExternalReadError('malformed-response');
	}
	const record = payload as Record<string, unknown>;
	if (record.private === true) {
		throw new ExternalReadError('malformed-response');
	}
	return {
		stars: countOf(record, 'stargazers_count'),
		forks: countOf(record, 'forks_count'),
		openIssuesAndPullRequests: countOf(record, 'open_issues_count'),
		license: spdxIdOf(record),
		pushedAt: isoInstantOf(record, 'pushed_at'),
	};
}

export interface GitHubRepoAdapterOptions {
	/** Injected transport. Defaults to the runtime `fetch`. */
	readonly fetchImpl?: FetchLike;
}

export function createGitHubRepoAdapter(
	options: GitHubRepoAdapterOptions = {},
): ExternalAdapter<GitHubRepoFacts> {
	const fetchImpl: FetchLike =
		options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
	return {
		source: GITHUB_REPO_SOURCE,
		// The policy arrives per attempt, resolved by the reader. This
		// adapter holds none of its own, so the deadline and the body
		// cap it enforces are exactly the ones `reader.policy` reports.
		read: async (signal, policy) =>
			parseGitHubRepoFacts(
				await readJson(GITHUB_REPO_REQUEST.url, {
					fetchImpl,
					policy,
					signal,
					headers: GITHUB_REPO_REQUEST.headers,
				}),
			),
	};
}
