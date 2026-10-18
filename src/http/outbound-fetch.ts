import {
	type OutboundUrlPolicy,
	type OutboundUrlRefusalCode,
	classifyOutboundRedirect,
	classifyOutboundUrl,
} from './outbound';

/**
 * Outbound fetch adapter — the only sanctioned way for a Worker handler
 * to fetch a URL that came from outside this repository (Issue #453).
 *
 * `src/http/outbound.ts` decides whether one URL may be requested. This
 * module is the part that actually opens the connection, and it owns the
 * three properties a single URL cannot carry on its own:
 *
 * 1. **Redirect hops.** `fetch` is called with `redirect: 'manual'` and
 *    every `Location` target is classified again by
 *    {@link classifyOutboundRedirect} before the next connection. A hop
 *    is therefore never a way around the policy — it is a *new* URL
 *    that has to pass the same gate. The hop budget
 *    ({@link DEFAULT_MAX_REDIRECTS}) bounds the loop.
 * 2. **Deadline.** One {@link AbortController} covers the whole
 *    operation, including every hop and the body read, so a slow
 *    upstream cannot hold a Worker request open past
 *    {@link DEFAULT_TIMEOUT_MS}.
 * 3. **Body size.** The response body is read through a byte counter and
 *    the stream is cancelled at {@link DEFAULT_MAX_BYTES}, so a
 *    "content-length: 12" response that streams 4 GiB is refused rather
 *    than buffered.
 *
 * ## The transport seam
 *
 * `options.transport` replaces `globalThis.fetch`. It exists so the
 * boundary can be exercised end-to-end — including the redirect loop,
 * the deadline and the size cap — without a network, and so the report
 * generator (`scripts/capture-ssrf-url-adapter-report.mjs`) renders
 * *measured* rows instead of a hand-written table. Production callers
 * omit it and get `globalThis.fetch`.
 *
 * ## Credentials never cross this boundary
 *
 * The adapter refuses to send `Authorization`, `Cookie` and
 * `Proxy-Authorization` to a third-party origin. There is no shipped
 * caller that needs them, and "the URL is allowed" must not quietly
 * become "the URL is allowed *with this request's credentials*".
 *
 * ## Inbound headers are not forwarded
 *
 * `options.headers` is the **complete** header set, not a merge. Passing
 * an inbound `Headers` object straight through would leak the visitor's
 * cookies to whatever host the attacker named; a caller has to name each
 * header it wants, which is a decision someone has to write down.
 *
 * ## What it does not prove
 *
 * Classification happens before DNS. A hostname that resolves to a
 * private address is caught by the runtime's
 * `global_fetch_strictly_public` flag rather than by this module — see
 * "Known limits" in `docs/security/outbound-fetch.md`.
 */

/** Default whole-operation deadline, milliseconds. */
export const DEFAULT_TIMEOUT_MS = 5_000;

/** Default number of redirects followed. Zero means "no redirect is followed". */
export const DEFAULT_MAX_REDIRECTS = 2;

/** Default cap on the buffered response body, 1 MiB. */
export const DEFAULT_MAX_BYTES = 1_048_576;

/** Statuses the adapter treats as a redirect rather than as a result. */
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

/**
 * Header names this boundary will not send. Refusing is louder than
 * stripping: a caller that builds a header set by spreading an inbound
 * `Headers` learns that it is doing something the boundary forbids.
 */
export const OUTBOUND_FORBIDDEN_HEADERS: readonly string[] = [
	'authorization',
	'proxy-authorization',
	'cookie',
];

/** Stable failure codes. A refusal never carries the submitted URL. */
export type OutboundFetchFailureCode =
	| OutboundUrlRefusalCode
	| 'credential_header_refused'
	| 'too_many_redirects'
	| 'timeout'
	| 'aborted'
	| 'response_too_large'
	| 'http_error'
	| 'fetch_failed';

export interface OutboundTransportInit {
	/** Always `'manual'`: the hop loop, not the runtime, owns redirects. */
	readonly redirect: 'manual';
	readonly signal: AbortSignal;
	readonly headers: Readonly<Record<string, string>>;
}

export type OutboundTransport = (url: string, init: OutboundTransportInit) => Promise<Response>;

export interface FetchExternalOptions {
	readonly policy?: OutboundUrlPolicy;
	/** Defaults to `globalThis.fetch`. See "The transport seam". */
	readonly transport?: OutboundTransport;
	/** Whole-operation deadline. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
	readonly timeoutMs?: number;
	/** Redirects followed after the first response. Defaults to {@link DEFAULT_MAX_REDIRECTS}. */
	readonly maxRedirects?: number;
	/** Buffered-body cap. Defaults to {@link DEFAULT_MAX_BYTES}. */
	readonly maxBytes?: number;
	/** The complete header set to send. Never merged with inbound headers. */
	readonly headers?: Readonly<Record<string, string>>;
	/** Cancels the operation when the caller goes away. */
	readonly signal?: AbortSignal;
}

export type FetchExternalResult =
	| {
			readonly ok: true;
			/** Final URL after every accepted hop, normalised. */
			readonly url: string;
			readonly status: number;
			readonly contentType: string;
			readonly bytes: Uint8Array;
			/** Every hop that was followed, in order. Empty when there was none. */
			readonly redirectChain: readonly string[];
	  }
	| {
			readonly ok: false;
			readonly code: OutboundFetchFailureCode;
			/** Names the rule that refused. Never contains the submitted URL. */
			readonly reason: string;
			/** The URL under examination, or `null` when it failed classification. */
			readonly url: string | null;
			readonly redirectChain: readonly string[];
	  };

function fail(
	code: OutboundFetchFailureCode,
	reason: string,
	chain: readonly string[],
	url: string | null,
): FetchExternalResult {
	return { ok: false, code, reason, url, redirectChain: chain };
}

/**
 * Read at most `maxBytes`, cancelling the stream the moment the budget is
 * exceeded. `content-length` is consulted first because it is free, but
 * it is a hint: a response that under-declares is still stopped here.
 */
async function readBounded(
	response: Response,
	maxBytes: number,
): Promise<Uint8Array | 'too_large'> {
	const declared = response.headers.get('content-length');
	if (declared !== null && Number(declared) > maxBytes) return 'too_large';

	const stream = response.body;
	if (!stream) {
		const buffer = new Uint8Array(await response.arrayBuffer());
		return buffer.byteLength > maxBytes ? 'too_large' : buffer;
	}

	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel();
				return 'too_large';
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const body = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		body.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return body;
}

/** The default transport: the runtime `fetch`, called at request time. */
const defaultTransport: OutboundTransport = (url, init) => fetch(url, init as RequestInit);

function normalizeHeaders(
	headers: Readonly<Record<string, string>> | undefined,
): { ok: true; value: Record<string, string> } | { ok: false; name: string } {
	const value: Record<string, string> = {
		accept: '*/*',
		'user-agent': 'my-web-2026 (+https://rebuildup.dev)',
	};
	for (const [name, entry] of Object.entries(headers ?? {})) {
		const lowered = name.toLowerCase();
		if (OUTBOUND_FORBIDDEN_HEADERS.includes(lowered)) return { ok: false, name: lowered };
		value[lowered] = entry;
	}
	return { ok: true, value };
}

/**
 * Fetch a third-party URL under the outbound policy.
 *
 * Never throws: every failure — refusal, timeout, transport error,
 * oversized body, non-2xx — comes back as `{ ok: false, code, reason }`
 * so a handler cannot accidentally turn a refused URL into a 500 that
 * leaks the upstream's error text.
 *
 * @param input URL supplied by a visitor, a stored record, or an upstream
 *   integration. Anything not on the accept list is refused.
 */
export async function fetchExternalUrl(
	input: unknown,
	options: FetchExternalOptions = {},
): Promise<FetchExternalResult> {
	const policy = options.policy ?? {};
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const transport = options.transport ?? defaultTransport;

	const headers = normalizeHeaders(options.headers);
	if (!headers.ok) {
		return fail(
			'credential_header_refused',
			`header "${headers.name}" is never sent to a third-party origin`,
			[],
			null,
		);
	}

	const first = classifyOutboundUrl(input, policy);
	if (!first.ok) return fail(first.code, first.reason, [], null);

	if (options.signal?.aborted === true) {
		return fail('aborted', 'the caller aborted before the request started', [], null);
	}

	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);
	const forwardAbort = () => controller.abort();
	options.signal?.addEventListener('abort', forwardAbort, { once: true });

	const chain: string[] = [];
	let current = first.url;

	try {
		// At most `maxRedirects + 1` connections are opened: the first
		// plus one per followed redirect. `maxRedirects: 0` therefore
		// means "issue exactly one request and report the 3xx".
		for (let hop = 0; hop <= maxRedirects; hop += 1) {
			let response: Response;
			try {
				response = await transport(current.toString(), {
					redirect: 'manual',
					signal: controller.signal,
					headers: headers.value,
				});
			} catch (error) {
				if (timedOut) {
					return fail('timeout', `no result within ${timeoutMs} ms`, chain, current.toString());
				}
				if (controller.signal.aborted) {
					return fail('aborted', 'the caller aborted the request', chain, current.toString());
				}
				return fail(
					'fetch_failed',
					error instanceof Error ? error.message : 'the transport threw',
					chain,
					current.toString(),
				);
			}

			if (REDIRECT_STATUSES.has(response.status)) {
				const location = response.headers.get('location');
				// A 3xx without a Location is a result, not a hop: some
				// upstreams answer 304 / 302 with no header at all, and
				// refusing those would be surprising rather than safe.
				if (location === null) {
					return fail(
						'http_error',
						`upstream answered ${response.status} with no Location header`,
						chain,
						current.toString(),
					);
				}
				// Release the hop body before opening the next connection.
				await response.body?.cancel().catch(() => undefined);
				const next = classifyOutboundRedirect(location, current, policy);
				if (!next.ok) {
					return fail(next.code, `redirect hop: ${next.reason}`, chain, null);
				}
				// The budget is checked *before* the hop is recorded, so
				// a refused hop is never presented as followed and the
				// chain only ever contains hops that were requested.
				if (hop >= maxRedirects) {
					return fail(
						'too_many_redirects',
						`more than ${maxRedirects} redirects before reaching a result`,
						chain,
						current.toString(),
					);
				}
				chain.push(next.url.toString());
				current = next.url;
				continue;
			}

			if (!response.ok) {
				await response.body?.cancel().catch(() => undefined);
				return fail(
					'http_error',
					`upstream answered ${response.status}`,
					chain,
					current.toString(),
				);
			}

			const bytes = await readBounded(response, maxBytes);
			if (bytes === 'too_large') {
				return fail(
					'response_too_large',
					`response body exceeds ${maxBytes} bytes`,
					chain,
					current.toString(),
				);
			}
			if (timedOut) {
				return fail('timeout', `no result within ${timeoutMs} ms`, chain, current.toString());
			}
			return {
				ok: true,
				url: current.toString(),
				status: response.status,
				contentType: response.headers.get('content-type') ?? '',
				bytes,
				redirectChain: chain,
			};
		}
		// The hop loop always returns from inside the `for`, so reaching
		// this line would mean the budget arithmetic changed shape.
		return fail('fetch_failed', 'the hop budget produced no result', chain, current.toString());
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener('abort', forwardAbort);
	}
}
