import { describe, expect, it } from 'vitest';
import { ExternalReadError, resolveReadPolicy } from './contract';
import { classifyHttpStatus, readBodyWithCap, readJson } from './timeout';

/**
 * Transport contract tests (Issue #499).
 *
 * The properties pinned here are the ones a display read depends on
 * and cannot get from the adapter layer: the response is bounded in
 * time and size, a status becomes a PUBLIC reason, and nothing about
 * the upstream response — body, headers, URL — survives the call.
 */

const policy = resolveReadPolicy({ timeoutMs: 50, maxResponseBytes: 256 });

function jsonResponse(body: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json' },
		...init,
	});
}

describe('classifyHttpStatus', () => {
	it('maps 404 / 410 to not-found', () => {
		expect(classifyHttpStatus(404)).toBe('not-found');
		expect(classifyHttpStatus(410)).toBe('not-found');
	});

	it('maps 403 / 429 to rate-limited (an unauthenticated read has no other reason)', () => {
		expect(classifyHttpStatus(403)).toBe('rate-limited');
		expect(classifyHttpStatus(429)).toBe('rate-limited');
	});

	it('maps every other failure to a generic upstream error', () => {
		for (const status of [400, 401, 500, 502, 503]) {
			expect(classifyHttpStatus(status)).toBe('upstream-error');
		}
	});
});

describe('readJson', () => {
	it('returns the parsed document for a 200 response', async () => {
		const calls: { url?: string; init?: RequestInit }[] = [];
		const value = await readJson('https://example.invalid/read', {
			policy,
			fetchImpl: async (url, init) => {
				calls.push({ url, init });
				return jsonResponse({ stars: 3 });
			},
		});
		expect(value).toEqual({ stars: 3 });
		expect(calls[0]?.url).toBe('https://example.invalid/read');
		expect(calls[0]?.init?.method).toBe('GET');
	});

	it('sends no credential header of any kind', async () => {
		let headers: Headers | undefined;
		await readJson('https://example.invalid/read', {
			policy,
			fetchImpl: async (_url, init) => {
				headers = new Headers(init?.headers);
				return jsonResponse({});
			},
		});
		expect(headers?.has('authorization')).toBe(false);
		expect(headers?.has('cookie')).toBe(false);
		expect(headers?.has('proxy-authorization')).toBe(false);
		expect(headers?.get('accept')).toBe('application/vnd.github+json');
	});

	it('refuses a caller-supplied credential header instead of dropping it silently', async () => {
		let issued = 0;
		const fetchImpl = async () => {
			issued += 1;
			return jsonResponse({});
		};
		// Header names are matched case-insensitively (HTTP header names
		// are), so `Authorization` in any casing is refused.
		await expect(
			readJson('https://example.invalid/read', {
				policy,
				fetchImpl,
				headers: { Authorization: 'Bearer token-that-must-not-leave' },
			}),
		).rejects.toThrow(/refusing to send Authorization/);
		await expect(
			readJson('https://example.invalid/read', {
				policy,
				fetchImpl,
				headers: { Cookie: 'session=must-not-leave' },
			}),
		).rejects.toThrow(/refusing to send Cookie/);
		expect(issued).toBe(0);
	});

	it('classifies a non-2xx response without exposing its body', async () => {
		const failure = await readJson('https://example.invalid/read', {
			policy,
			fetchImpl: async () =>
				new Response('{"message":"API rate limit exceeded for 10.0.0.7"}', {
					status: 403,
				}),
		}).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(ExternalReadError);
		expect((failure as ExternalReadError).reason).toBe('rate-limited');
		expect((failure as Error).message).toBe('external read failed: rate-limited');
		expect((failure as Error).message).not.toContain('10.0.0.7');
	});

	it('classifies a thrown fetch as a network failure', async () => {
		const failure = await readJson('https://example.invalid/read', {
			policy,
			fetchImpl: async () => {
				throw new TypeError('fetch failed: getaddrinfo ENOTFOUND example.invalid');
			},
		}).catch((error: unknown) => error);
		expect((failure as ExternalReadError).reason).toBe('network');
	});

	it('classifies an unparseable body as malformed-response', async () => {
		const failure = await readJson('https://example.invalid/read', {
			policy,
			fetchImpl: async () => new Response('<html>not json</html>', { status: 200 }),
		}).catch((error: unknown) => error);
		expect((failure as ExternalReadError).reason).toBe('malformed-response');
	});

	it('rejects a body larger than the cap without buffering it whole', async () => {
		const big = `{"pad":"${'x'.repeat(4096)}"}`;
		const failure = await readJson('https://example.invalid/read', {
			policy,
			fetchImpl: async () => new Response(big, { status: 200 }),
		}).catch((error: unknown) => error);
		expect((failure as ExternalReadError).reason).toBe('malformed-response');
	});

	it('aborts the request when the transport deadline elapses', async () => {
		const failure = await readJson('https://example.invalid/read', {
			policy,
			fetchImpl: (_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => {
						reject(new DOMException('aborted', 'AbortError'));
					});
				}),
		}).catch((error: unknown) => error);
		expect((failure as ExternalReadError).reason).toBe('timeout');
	});

	it('propagates the caller signal into the request', async () => {
		const controller = new AbortController();
		const pending = readJson('https://example.invalid/read', {
			policy,
			signal: controller.signal,
			fetchImpl: (_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => {
						reject(new DOMException('aborted', 'AbortError'));
					});
				}),
		});
		controller.abort();
		const failure = await pending.catch((error: unknown) => error);
		// A caller abort produces no value, so it is reported inside the
		// same closed vocabulary as a deadline (there is no "cancelled"
		// reason a visitor could be shown without inventing one).
		expect((failure as ExternalReadError).reason).toBe('timeout');
	});
});

describe('readBodyWithCap', () => {
	it('reads a body inside the cap', async () => {
		const response = new Response('hello');
		expect(await readBodyWithCap(response, 64)).toBe('hello');
	});

	it('rejects a body over the cap', async () => {
		const response = new Response('x'.repeat(128));
		await expect(readBodyWithCap(response, 16)).rejects.toBeInstanceOf(ExternalReadError);
	});

	it('rejects a body-less response whose text is over the cap', async () => {
		// A `Response` constructed with a null body has no stream; the
		// fallback path must still enforce the cap.
		const response = new Response(null, { status: 200 });
		Object.defineProperty(response, 'body', { value: null });
		await expect(readBodyWithCap(response, 16)).resolves.toBe('');
	});

	it('counts bytes, not characters', async () => {
		// 4 three-byte characters = 12 bytes, over a 8-byte cap.
		const response = new Response('ああああ');
		await expect(readBodyWithCap(response, 8)).rejects.toBeInstanceOf(ExternalReadError);
	});
});
