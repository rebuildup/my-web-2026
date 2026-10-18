/**
 * The one place an outbound third-party request is issued
 * (Issue #499).
 *
 * Every adapter in this obligation goes through `readJson`, so the
 * three properties a display read depends on are structural rather
 * than per-adapter discipline:
 *
 *   - a deadline (`timeoutMs`) that the READER also enforces, so a
 *     transport that hangs still cannot hold the page,
 *   - a response body cap (`maxResponseBytes`), because an upstream
 *     that starts returning megabytes must fail rather than spend a
 *     Worker's memory,
 *   - a closed failure vocabulary (`classifyHttpStatus`,
 *     `classifyThrown`), so no upstream body, header or URL ever
 *     becomes a value a component could render.
 *
 * No credentials are attached. `ExternalSource.sendsCredentials` is
 * typed as the literal `false`, and the header set below is built
 * here so an adapter cannot smuggle an `Authorization` in through a
 * spread.
 */

import { type ExternalFailureReason, ExternalReadError, type ExternalReadPolicy } from './contract';

/** The `fetch` shape this module needs. Injectable so tests never touch the network. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ReadJsonOptions {
	readonly fetchImpl: FetchLike;
	readonly policy: ExternalReadPolicy;
	/** Caller-provided abort signal (the reader's deadline signal). */
	readonly signal?: AbortSignal;
	/**
	 * Source-specific request headers, supplied by the ADAPTER.
	 *
	 * Content negotiation is a property of the upstream, not of the
	 * transport: GitHub's `application/vnd.github+json` belongs to
	 * `github.ts`, so a second adapter cannot inherit it by accident.
	 * Merged AFTER the fixed set, and still refused for credential
	 * names below.
	 */
	readonly headers?: Readonly<Record<string, string>>;
}

/**
 * Headers the read identifies ITSELF with — and nothing more.
 *
 * `user-agent` states that the request comes from this site's public
 * metadata read, which is true of every source. It deliberately does
 * NOT include `accept`: which representation an upstream should return
 * is the adapter's decision (see `ReadJsonOptions.headers`).
 */
const BASE_HEADERS: Readonly<Record<string, string>> = {
	'user-agent': 'my-web-2026-public-metadata-read',
};

/**
 * Header names this contract refuses to forward.
 *
 * A read that renders a public fact must not be able to become a
 * request that carries the owner's identity. The check is a refusal
 * (not a silent strip) so a future adapter that tries gets a loud
 * failure instead of a request that quietly stops authenticating.
 */
const FORBIDDEN_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

/**
 * Map an upstream status onto the public failure vocabulary.
 *
 * GitHub returns 404 for a repository that is private, renamed away
 * or absent — the public read cannot tell those apart and must not
 * guess, so all three are `not-found`. 403 / 429 are `rate-limited`
 * because an unauthenticated read has no other reason to be refused.
 */
export function classifyHttpStatus(status: number): ExternalFailureReason {
	if (status === 404 || status === 410) return 'not-found';
	if (status === 403 || status === 429) return 'rate-limited';
	return 'upstream-error';
}

/**
 * Read at most `maxResponseBytes` from a response body.
 *
 * Streams when the runtime exposes `body` (Workers and the test pool
 * both do) so the cap is enforced incrementally, and falls back to
 * `text()` for a body-less Response, where the cap still applies to
 * the buffered length. An over-cap body is `malformed-response`: the
 * read is looking for a small metadata document.
 */
export async function readBodyWithCap(
	response: Response,
	maxResponseBytes: number,
): Promise<string> {
	if (!response.body) {
		const text = await response.text();
		if (byteLength(text) > maxResponseBytes) {
			throw new ExternalReadError('malformed-response');
		}
		return text;
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				total += value.byteLength;
				if (total > maxResponseBytes) {
					await reader.cancel().catch(() => {});
					throw new ExternalReadError('malformed-response');
				}
				chunks.push(value);
			}
		}
	} finally {
		reader.releaseLock?.();
	}
	return new TextDecoder().decode(concat(chunks, total));
}

function byteLength(text: string): number {
	return new TextEncoder().encode(text).byteLength;
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

/** Combine the caller's signal with the reader's deadline signal. */
function linkSignals(caller: AbortSignal | undefined, deadline: AbortSignal): AbortSignal {
	if (!caller) return deadline;
	return AbortSignal.any([caller, deadline]);
}

/**
 * Fetch a small JSON document with a bounded time and bounded size.
 *
 * Throws `ExternalReadError` with a public reason. The upstream
 * response body, status line, headers and URL are dropped on the way
 * out — the caller receives a reason, never a payload to log or
 * render.
 */
export async function readJson(url: string, options: ReadJsonOptions): Promise<unknown> {
	const { fetchImpl, policy, signal } = options;
	const extra = options.headers ?? {};
	for (const name of Object.keys(extra)) {
		if (FORBIDDEN_HEADERS.includes(name.toLowerCase())) {
			throw new Error(`refusing to send ${name} on a public external read`);
		}
	}

	const deadline = AbortSignal.timeout(policy.timeoutMs);
	const linked = linkSignals(signal, deadline);

	let response: Response;
	try {
		response = await fetchImpl(url, {
			method: 'GET',
			headers: { ...BASE_HEADERS, ...extra },
			signal: linked,
			redirect: 'follow',
		});
	} catch (thrown) {
		if (deadline.aborted) throw new ExternalReadError('timeout');
		throw new ExternalReadError(
			thrown instanceof Error && thrown.name === 'AbortError' ? 'timeout' : 'network',
		);
	}

	if (!response.ok) {
		throw new ExternalReadError(classifyHttpStatus(response.status));
	}

	const body = await readBodyWithCap(response, policy.maxResponseBytes);
	try {
		return JSON.parse(body);
	} catch {
		throw new ExternalReadError('malformed-response');
	}
}
