import { describe, expect, it } from 'vitest';
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_TIMEOUT_MS,
	type OutboundTransport,
	fetchExternalUrl,
} from './outbound-fetch';

/**
 * Behaviour of the outbound fetch adapter (Issue #453).
 *
 * These run in the local workerd pool (the `vitest.config.ts` Workers
 * project), so the code under test is the code the Worker ships, using
 * the same `URL`, `Response` and `AbortController` implementations.
 *
 * Every request goes through an injected transport, so the suite is
 * hermetic: **no socket is opened**, no public host is contacted, and no
 * production resource is touched. One group deliberately swaps
 * `globalThis.fetch` for a recorder to prove that a refused URL never
 * reaches the real transport at all.
 */

interface Recorded {
	readonly url: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly redirect: string;
}

/** A transport driven by a `url → response` table, recording every call. */
function tableTransport(responses: Readonly<Record<string, () => Response | Promise<Response>>>): {
	transport: OutboundTransport;
	calls: Recorded[];
} {
	const calls: Recorded[] = [];
	const transport: OutboundTransport = async (url, init) => {
		calls.push({ url, headers: init.headers, redirect: init.redirect });
		const factory = responses[url];
		if (!factory) throw new Error(`unexpected request to ${url}`);
		return factory();
	};
	return { transport, calls };
}

const text = (body: string, init?: ResponseInit) => new Response(body, init);

const redirect = (location: string, status = 302) =>
	new Response(null, { status, headers: { location } });

const json = (value: unknown) =>
	new Response(JSON.stringify(value), {
		status: 200,
		headers: { 'content-type': 'application/json; charset=utf-8' },
	});

const decoder = new TextDecoder();

describe('fetchExternalUrl — accepted', () => {
	it('fetches a public https origin and returns the body', async () => {
		const { transport, calls } = tableTransport({
			'https://api.github.com/repos/rebuildup/my-web-2026': () =>
				json({ full_name: 'rebuildup/my-web-2026' }),
		});

		const result = await fetchExternalUrl('https://api.github.com/repos/rebuildup/my-web-2026', {
			transport,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.status).toBe(200);
		expect(result.contentType).toContain('application/json');
		expect(JSON.parse(decoder.decode(result.bytes))).toEqual({
			full_name: 'rebuildup/my-web-2026',
		});
		expect(result.redirectChain).toEqual([]);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe('https://api.github.com/repos/rebuildup/my-web-2026');
	});

	it('always asks the transport to handle redirects itself', async () => {
		const { transport, calls } = tableTransport({
			'https://codeload.github.com/a/b/tar.gz': () => text('tarball'),
		});
		const result = await fetchExternalUrl('https://codeload.github.com/a/b/tar.gz', { transport });

		expect(result.ok).toBe(true);
		// If this were 'follow', the runtime would chase a redirect to
		// an internal host without ever consulting the policy again.
		expect(calls[0].redirect).toBe('manual');
	});

	it('never sends inbound credentials, and refuses to be asked to', async () => {
		const { transport, calls } = tableTransport({
			'https://api.github.com/user': () => json({ login: 'rebuildup' }),
		});

		const ok = await fetchExternalUrl('https://api.github.com/user', { transport });
		expect(ok.ok).toBe(true);
		expect(Object.keys(calls[0].headers)).not.toContain('authorization');
		expect(Object.keys(calls[0].headers)).not.toContain('cookie');

		for (const header of ['Authorization', 'Cookie', 'PROXY-AUTHORIZATION']) {
			const refused = await fetchExternalUrl('https://api.github.com/user', {
				transport,
				headers: { [header]: 'session=redacted' },
			});
			expect(refused.ok).toBe(false);
			if (refused.ok) continue;
			expect(refused.code).toBe('credential_header_refused');
			// The reason names the header, never its value.
			expect(refused.reason).not.toContain('redacted');
		}
		expect(calls).toHaveLength(1);
	});
});

describe('fetchExternalUrl — refused inputs never reach the transport', () => {
	const refused = [
		['file scheme', 'file:///etc/passwd'],
		['loopback literal', 'http://127.0.0.1:8787/'],
		['loopback name', 'http://localhost:8787/'],
		['private literal', 'http://192.168.1.1/'],
		['cloud metadata endpoint', 'http://169.254.169.254/latest/meta-data/'],
		['ipv6 loopback', 'http://[::1]/'],
		['ipv4-mapped loopback', 'http://[::ffff:127.0.0.1]/'],
		['gcp metadata hostname', 'http://metadata.google.internal/computeMetadata/v1/'],
		['internal zone', 'https://db.internal/secrets'],
		['userinfo trick', 'https://api.github.com@evil.example.org/'],
		['non-default port', 'https://api.github.com:8443/'],
		['relative path', '/admin'],
	] as const;

	it('opens no connection for any of them, with the real transport installed', async () => {
		const real = globalThis.fetch;
		const attempted: string[] = [];
		globalThis.fetch = ((input: unknown) => {
			attempted.push(String(input));
			throw new Error('the transport must not be reached');
		}) as typeof globalThis.fetch;

		try {
			for (const [label, url] of refused) {
				const result = await fetchExternalUrl(url);
				expect(result.ok, label).toBe(false);
				if (result.ok) continue;
				expect(result.url).toBeNull();
				expect(result.reason).not.toContain('://');
			}
		} finally {
			globalThis.fetch = real;
		}
		expect(attempted).toEqual([]);
	});
});

describe('fetchExternalUrl — redirects', () => {
	it('follows an allowed hop and reports the chain', async () => {
		const { transport, calls } = tableTransport({
			'https://example.org/a': () => redirect('/b'),
			'https://example.org/b': () => text('landed'),
		});

		const result = await fetchExternalUrl('https://example.org/a', { transport });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.url).toBe('https://example.org/b');
		expect(result.redirectChain).toEqual(['https://example.org/b']);
		expect(calls.map((call) => call.url)).toEqual([
			'https://example.org/a',
			'https://example.org/b',
		]);
	});

	it('refuses a hop that points back inside the network', async () => {
		const { transport, calls } = tableTransport({
			'https://example.org/a': () => redirect('http://169.254.169.254/latest/meta-data/'),
		});

		const result = await fetchExternalUrl('https://example.org/a', { transport });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe('private_address');
		expect(result.reason).toContain('redirect hop');
		// The metadata endpoint is never requested.
		expect(calls).toHaveLength(1);
	});

	it('refuses a hop that leaves the allow-list with a non-default port', async () => {
		const { transport } = tableTransport({
			'https://example.org/a': () => redirect('https://codeload.github.com:8443/a/b'),
		});
		const result = await fetchExternalUrl('https://example.org/a', { transport });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe('port_not_allowed');
	});

	it('refuses a file-scheme hop', async () => {
		const { transport } = tableTransport({
			'https://example.org/a': () => redirect('file:///etc/passwd'),
		});
		const result = await fetchExternalUrl('https://example.org/a', { transport });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe('protocol_not_allowed');
	});

	it('stops at the hop budget instead of looping', async () => {
		const hop = (n: number) => () => redirect(`/hop-${n + 1}`);
		const responses: Record<string, () => Response> = {};
		for (let n = 0; n <= 8; n += 1) responses[`https://example.org/hop-${n}`] = hop(n);
		const { transport, calls } = tableTransport(responses);

		const result = await fetchExternalUrl('https://example.org/hop-0', {
			transport,
			maxRedirects: 2,
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe('too_many_redirects');
		// Two redirects were followed; the third target is reported as
		// refused rather than quietly requested.
		expect(result.redirectChain).toHaveLength(2);
		expect(calls).toHaveLength(3);
	});

	it('follows no redirect at all when the budget is zero', async () => {
		const { transport, calls } = tableTransport({
			'https://example.org/a': () => redirect('/b'),
		});
		const result = await fetchExternalUrl('https://example.org/a', { transport, maxRedirects: 0 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe('too_many_redirects');
		expect(result.redirectChain).toEqual([]);
		expect(calls).toHaveLength(1);
	});

	it('treats a 3xx without Location as a terminal result, not a hop', async () => {
		const { transport, calls } = tableTransport({
			'https://example.org/a': () => new Response(null, { status: 304 }),
		});
		const result = await fetchExternalUrl('https://example.org/a', { transport });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe('http_error');
		expect(calls).toHaveLength(1);
	});
});

describe('fetchExternalUrl — response limits', () => {
	it('refuses a body over the cap, including one that under-declares its length', async () => {
		const body = 'x'.repeat(4096);
		const { transport } = tableTransport({
			// `content-length: 16` lies; the streaming counter is what holds.
			'https://example.org/big': () => new Response(body, { headers: { 'content-length': '16' } }),
		});

		const result = await fetchExternalUrl('https://example.org/big', { transport, maxBytes: 1024 });

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe('response_too_large');
		expect(result.url).toBe('https://example.org/big');
	});

	it('honours an honest content-length before reading the stream', async () => {
		const { transport } = tableTransport({
			'https://example.org/big': () =>
				new Response('x'.repeat(64), { headers: { 'content-length': '64' } }),
		});
		const result = await fetchExternalUrl('https://example.org/big', { transport, maxBytes: 8 });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe('response_too_large');
	});

	it('accepts a body exactly at the cap', async () => {
		const { transport } = tableTransport({
			'https://example.org/exact': () => text('y'.repeat(64)),
		});
		const result = await fetchExternalUrl('https://example.org/exact', { transport, maxBytes: 64 });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.bytes.byteLength).toBe(64);
	});

	it('has a default cap of 1 MiB', () => {
		expect(DEFAULT_MAX_BYTES).toBe(1_048_576);
	});

	it('reports a non-2xx without buffering the error page', async () => {
		const { transport } = tableTransport({
			'https://example.org/missing': () => text('nope', { status: 404 }),
		});
		const result = await fetchExternalUrl('https://example.org/missing', { transport });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe('http_error');
		expect(result.reason).toContain('404');
	});

	it('turns a transport error into a defined failure, never a throw', async () => {
		const result = await fetchExternalUrl('https://example.org/a', {
			transport: async () => {
				throw new Error('socket closed');
			},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe('fetch_failed');
	});
});

describe('fetchExternalUrl — deadline', () => {
	it('aborts a transport that never answers', async () => {
		const result = await fetchExternalUrl('https://example.org/slow', {
			timeoutMs: 25,
			transport: (_url, init) =>
				new Promise<Response>((_resolve, reject) => {
					init.signal.addEventListener('abort', () => {
						reject(new Error('aborted'));
					});
				}),
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.code).toBe('timeout');
		expect(result.url).toBe('https://example.org/slow');
	});

	it('bounds the whole operation, not each hop', async () => {
		let calls = 0;
		const result = await fetchExternalUrl('https://example.org/a', {
			timeoutMs: 60,
			transport: (_url, init) => {
				calls += 1;
				return new Promise<Response>((resolve, reject) => {
					init.signal.addEventListener('abort', () => {
						reject(new Error('aborted'));
					});
					if (calls === 1) resolve(redirect('/b'));
				});
			},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe('timeout');
		expect(calls).toBe(2);
	});

	it('reports a caller-initiated abort as abort, not as a timeout', async () => {
		const controller = new AbortController();
		const promise = fetchExternalUrl('https://example.org/slow', {
			timeoutMs: 10_000,
			signal: controller.signal,
			transport: (_url, init) =>
				new Promise<Response>((_resolve, reject) => {
					init.signal.addEventListener('abort', () => {
						reject(new Error('aborted'));
					});
				}),
		});
		controller.abort();
		const result = await promise;
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe('aborted');
	});

	it('does not even start when the caller signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		const { transport, calls } = tableTransport({});
		const result = await fetchExternalUrl('https://example.org/a', {
			signal: controller.signal,
			transport,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe('aborted');
		expect(calls).toEqual([]);
	});

	it('has a documented default deadline', () => {
		expect(DEFAULT_TIMEOUT_MS).toBe(5_000);
	});
});

describe('fetchExternalUrl — policy is applied to every entry point', () => {
	it('honours a caller policy without weakening the shipped defaults', async () => {
		const { transport, calls } = tableTransport({
			'https://partner.example.org/api': () => json({ ok: true }),
			'https://api.github.com/user': () => json({ ok: true }),
		});

		const result = await fetchExternalUrl('https://partner.example.org/api', {
			transport,
			policy: { deniedHostSuffixes: ['partner.example.org'] },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe('host_not_allowed');
		expect(calls).toEqual([]);
	});

	it('applies the caller allow-list on top of the reserved-zone rules', async () => {
		const { transport, calls } = tableTransport({
			'https://build.internal/status': () => text('ok'),
		});

		const blocked = await fetchExternalUrl('https://build.internal/status', { transport });
		expect(blocked.ok).toBe(false);
		expect(calls).toEqual([]);

		const allowed = await fetchExternalUrl('https://build.internal/status', {
			transport,
			policy: { allowedHosts: ['build.internal'] },
		});
		expect(allowed.ok).toBe(true);
		expect(calls).toHaveLength(1);
	});
});
