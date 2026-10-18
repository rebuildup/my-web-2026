import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	ApiKeyError,
	requireApiKey,
	requireResourceAction,
	resetVerifyApiKey,
	withVerifyApiKey,
} from './middleware';

/**
 * API key middleware tests — exercises the full `requireApiKey` →
 * `requireResourceAction` chain.
 *
 * `verifyApiKey` is stubbed via the `withVerifyApiKey(...)` test seam
 * in `middleware.ts` because Better Auth's schema-check cache is
 * poisoned at module-load time when the binding is empty (before any
 * tests have created tables). The stub returns controlled results so
 * we can test our middleware's authorization contract:
 *
 *   - Bearer prefix parsing
 *   - 401 on missing / malformed / unknown keys
 *   - 200 with `c.var.apiKey` attached on success
 *   - 403 on `requireResourceAction` mismatch
 *
 * Hashing, persistence, and rate-limit configuration are Better Auth's
 * responsibility and are covered separately by the integration smoke
 * tests in `docs/release.md`. We do not duplicate them here.
 *
 * Why a test seam instead of `vi.mock`: the workerd vitest pool (via
 * `@cloudflare/vitest-plugin`) does not honour `vi.mock` of regular
 * TS modules — only of the `cloudflare:workers` virtual module. A
 * `cloudflare:workers` mock would also disable Better Auth's plugin
 * init, which is too heavy for a focused unit test. The seam keeps
 * the dependency on Better Auth isolated to one line in production.
 */

const verifyApiKey = vi.fn();

interface ApiKeyView {
	id: string;
	referenceId: string;
	permissions: Record<string, string[]>;
	prefix: string | null;
}

function buildApp() {
	const app = new Hono<{
		Bindings: Env;
		Variables: {
			apiKey: {
				id: string;
				permissions: Record<string, string[]>;
				referenceId: string;
				prefix: string | null;
			};
		};
	}>();
	app.use('*', requireApiKey);
	app.get('/protected', (c) => {
		const apiKey = c.get('apiKey');
		return c.json({
			id: apiKey.id,
			permissions: apiKey.permissions,
			referenceId: apiKey.referenceId,
			prefix: apiKey.prefix,
		});
	});
	app.get('/protected/access-counter/read', (c) => {
		const apiKey = requireResourceAction(c, 'access_counter', 'read');
		return c.json({ ok: true, key: apiKey.id });
	});
	app.get('/protected/reactions/write', (c) => {
		const apiKey = requireResourceAction(c, 'reactions', 'write');
		return c.json({ ok: true, key: apiKey.id });
	});
	app.get('/protected/unknown-resource/read', (c) => {
		const apiKey = requireResourceAction(c, 'portfolio', 'read');
		return c.json({ ok: true, key: apiKey.id });
	});
	app.onError((err, c) => {
		if (err instanceof ApiKeyError) {
			return c.json({ error: err.code }, err.status);
		}
		throw err;
	});
	return app;
}

describe('requireApiKey middleware', () => {
	let app: ReturnType<typeof buildApp>;

	beforeEach(() => {
		verifyApiKey.mockReset();
		withVerifyApiKey(verifyApiKey);
		app = buildApp();
	});

	afterEach(() => {
		resetVerifyApiKey();
	});

	it('returns 401 when Authorization header is missing', async () => {
		const response = await app.request('/protected');
		expect(response.status).toBe(401);
		const body = (await response.json()) as { error: string };
		expect(body.error).toBe('missing_authorization');
		expect(verifyApiKey).not.toHaveBeenCalled();
	});

	it('returns 401 when Authorization header is malformed', async () => {
		const response = await app.request('/protected', {
			headers: { authorization: 'NotBearer mk_xxx' },
		});
		expect(response.status).toBe(401);
		expect(verifyApiKey).not.toHaveBeenCalled();
	});

	it('returns 401 when the key is unknown', async () => {
		verifyApiKey.mockResolvedValueOnce({
			valid: false,
			error: { code: 'KEY_NOT_FOUND' },
			key: null,
		});
		const response = await app.request('/protected', {
			headers: { authorization: 'Bearer mk_not_a_real_key_xxxxxxxxxxxxxxx' },
		});
		expect(response.status).toBe(401);
		const body = (await response.json()) as { error: string };
		expect(body.error).toBe('invalid_api_key');
		expect(verifyApiKey).toHaveBeenCalledWith({
			body: { key: 'mk_not_a_real_key_xxxxxxxxxxxxxxx' },
		});
	});

	it('accepts a valid key and exposes id + permissions + referenceId + prefix', async () => {
		const apiKey: Omit<ApiKeyView, never> = {
			id: 'k1',
			referenceId: 'user-1',
			permissions: { access_counter: ['read', 'write'] },
			prefix: 'mk_',
		};
		verifyApiKey.mockResolvedValueOnce({
			valid: true,
			error: null,
			key: apiKey,
		});

		const response = await app.request('/protected', {
			headers: { authorization: 'Bearer mk_test_valid_key_xxxxxxxxxxxxxxx' },
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			id: string;
			permissions: Record<string, string[]>;
			referenceId: string;
			prefix: string | null;
		};
		expect(body.id).toBe('k1');
		expect(body.referenceId).toBe('user-1');
		expect(body.prefix).toBe('mk_');
		expect(body.permissions).toEqual({ access_counter: ['read', 'write'] });
	});

	it('enforces scope: read granted, write granted (different routes)', async () => {
		verifyApiKey.mockResolvedValue({
			valid: true,
			error: null,
			key: {
				id: 'k2',
				referenceId: 'user-1',
				permissions: { access_counter: ['read', 'write'] },
				prefix: 'mk_',
			},
		});

		const readResponse = await app.request('/protected/access-counter/read', {
			headers: { authorization: 'Bearer mk_test_scope_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
		});
		expect(readResponse.status).toBe(200);

		const writeResponse = await app.request('/protected/reactions/write', {
			headers: { authorization: 'Bearer mk_test_scope_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
		});
		// reactions:write is NOT in the key's permissions → 403
		expect(writeResponse.status).toBe(403);
	});

	it('enforces scope: missing scope returns 403', async () => {
		verifyApiKey.mockResolvedValue({
			valid: true,
			error: null,
			key: {
				id: 'k3',
				referenceId: 'user-1',
				permissions: { access_counter: ['read'] },
				prefix: 'mk_',
			},
		});

		const writeResponse = await app.request('/protected/reactions/write', {
			headers: { authorization: 'Bearer mk_test_readonly_xxxxxxxxxxxxxxxxxxxxxxxxxxx' },
		});
		expect(writeResponse.status).toBe(403);
	});

	it('ApiKeyError carries the missing_scope code', () => {
		const err = new ApiKeyError(403, 'missing_scope');
		expect(err.status).toBe(403);
		expect(err.code).toBe('missing_scope');
	});

	it('requireResourceAction returns the apiKey context on success', () => {
		const ctx = {
			get: () => ({
				id: 'k4',
				referenceId: 'user-1',
				permissions: { access_counter: ['read', 'write'] },
				prefix: 'mk_',
			}),
		} as unknown as Parameters<typeof requireResourceAction>[0];
		const result = requireResourceAction(ctx, 'access_counter', 'read');
		expect(result.id).toBe('k4');
	});

	// Issue #442: the middleware decides the *shape* of a refusal; the
	// real denial semantics (revoked / expired / wrong hash) belong to
	// Better Auth and are pinned in `test/integration/api-key-scope.test.ts`.
	// What is asserted here is that our half never turns a missing scope
	// into a 500 and never widens what a key may do.

	it('treats a null permissions block as no scope (403, not a crash)', async () => {
		// Better Auth returns `permissions: null` for a key created
		// without a permission block. `requireApiKey` must normalise
		// that to `{}` so the lookup below stays a lookup.
		verifyApiKey.mockResolvedValue({
			valid: true,
			error: null,
			key: {
				id: 'k5',
				referenceId: 'user-1',
				permissions: null,
				prefix: 'mk_',
			},
		});

		const response = await app.request('/protected/access-counter/read', {
			headers: { authorization: 'Bearer mk_test_noperms_xxxxxxxxxxxxxxxxxxxxxxxx' },
		});
		expect(response.status).toBe(403);
		const body = (await response.json()) as { error: string };
		expect(body.error).toBe('missing_scope');
	});

	it('refuses a resource the key was never granted (no wildcard)', async () => {
		// ADR-0009 §5 defines exactly two resources at this release.
		// A key holding both actions on `access_counter` still cannot
		// reach a resource that is absent from its permission block.
		verifyApiKey.mockResolvedValue({
			valid: true,
			error: null,
			key: {
				id: 'k6',
				referenceId: 'user-1',
				permissions: { access_counter: ['read', 'write'], reactions: ['read', 'write'] },
				prefix: 'mk_',
			},
		});

		const response = await app.request('/protected/unknown-resource/read', {
			headers: { authorization: 'Bearer mk_test_nowildcard_xxxxxxxxxxxxxxxxxxx' },
		});
		expect(response.status).toBe(403);
		const body = (await response.json()) as { error: string };
		expect(body.error).toBe('missing_scope');
	});

	it('refusal bodies carry the stable code only — no key, resource, or action', async () => {
		// The response must not become an oracle: it may not echo the
		// key id, the resource name, or the action that was refused.
		verifyApiKey.mockResolvedValue({
			valid: true,
			error: null,
			key: {
				id: 'k7-secret-key-id',
				referenceId: 'user-1',
				permissions: { access_counter: ['read'] },
				prefix: 'mk_',
			},
		});

		const response = await app.request('/protected/reactions/write', {
			headers: { authorization: 'Bearer mk_test_noecho_xxxxxxxxxxxxxxxxxxxxxxxxxx' },
		});
		expect(response.status).toBe(403);
		const text = await response.text();
		expect(JSON.parse(text)).toEqual({ error: 'missing_scope' });
		expect(text).not.toContain('k7-secret-key-id');
		expect(text).not.toContain('reactions');
		expect(text).not.toContain('write');
	});

	it('401 bodies do not distinguish unknown, disabled, or expired keys', async () => {
		// The middleware collapses every verifier failure into one
		// shape. Better Auth's own reasons (`KEY_DISABLED`,
		// `KEY_EXPIRED`, `KEY_NOT_FOUND`, …) are internal state.
		for (const error of [
			{ code: 'KEY_NOT_FOUND' },
			{ code: 'KEY_DISABLED' },
			{ code: 'KEY_EXPIRED' },
		]) {
			verifyApiKey.mockResolvedValueOnce({ valid: false, error, key: null });
			const response = await app.request('/protected', {
				headers: { authorization: 'Bearer mk_test_opaque_xxxxxxxxxxxxxxxxxxxxxxxxxxx' },
			});
			expect(response.status).toBe(401);
			expect(await response.text()).toBe('{"error":"invalid_api_key"}');
		}
	});
});
