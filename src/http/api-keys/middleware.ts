import type { Context, Next } from 'hono';
import { auth } from '../../cloudflare/auth/better-auth';

/**
 * API key middleware — gates `/api/v1/access/*` and `/api/v1/reactions/*`.
 *
 * The Better Auth API key plugin is the source of truth for key
 * validation, hashing, and the per-key rate limit (default 60 req/min
 * per the plugin config in `src/cloudflare/auth/better-auth.ts`).
 * That per-key throttling is anti-brute-force on key validation;
 * it is intentionally separate from the per-consumer-principal
 * rate-limit binding that ADR-0010 introduces for endpoint
 * protection.
 *
 * Flow:
 *   1. Extract `Authorization: Bearer <key>`. Reject 401 if missing.
 *   2. `auth.api.verifyApiKey({ body: { key, permissions? } })`. On
 *      `valid: false`, return 401 with no information leak about why
 *      (we don't distinguish unknown key from disabled key from
 *      expired key in the response).
 *   3. Attach the verified key row to `c.var.apiKey` so downstream
 *      middleware (`requireResourceAction`) and handlers can read
 *      permissions / owner without re-validating.
 *
 * Permissions shape: `{ resource: ["read","write"] }` (resource/action
 * tuples). See ADR-0009 §3 for the project's resource list.
 */
export interface ApiKeyContext {
	id: string;
	referenceId: string;
	permissions: Record<string, string[]>;
	prefix: string | null;
}

declare module 'hono' {
	interface ContextVariableMap {
		apiKey: ApiKeyContext;
	}
}

export class ApiKeyError extends Error {
	constructor(
		public status: 401 | 403,
		public code: 'missing_authorization' | 'invalid_api_key' | 'missing_scope',
		message?: string,
	) {
		super(message ?? code);
		this.name = 'ApiKeyError';
	}
}

const BEARER_PREFIX = /^Bearer\s+(.+)$/i;

export async function requireApiKey(
	c: Context<{ Bindings: Env }>,
	_next: Next,
): Promise<Response | undefined> {
	const header = c.req.header('authorization') ?? '';
	const match = BEARER_PREFIX.exec(header);
	if (!match) {
		return c.json({ error: 'missing_authorization' }, 401);
	}
	const key = match[1].trim();
	if (key.length === 0) {
		return c.json({ error: 'missing_authorization' }, 401);
	}

	const result = await auth.api.verifyApiKey({ body: { key } });
	if (!result.valid || !result.key) {
		return c.json({ error: 'invalid_api_key' }, 401);
	}

	const apiKey: ApiKeyContext = {
		id: result.key.id,
		referenceId: result.key.referenceId,
		permissions: (result.key.permissions ?? {}) as Record<string, string[]>,
		prefix: result.key.prefix,
	};
	c.set('apiKey', apiKey);
	await _next();
	return undefined;
}

/**
 * Scope check helper for use after `requireApiKey` has run.
 * Returns the bound `ApiKeyContext` for chaining, or throws 403.
 */
export function requireResourceAction(
	c: Context<{ Bindings: Env; Variables: { apiKey: ApiKeyContext } }>,
	resource: string,
	action: 'read' | 'write',
): ApiKeyContext {
	const apiKey = c.get('apiKey');
	const allowed = apiKey.permissions[resource]?.includes(action) ?? false;
	if (!allowed) {
		throw new ApiKeyError(
			403,
			'missing_scope',
			`API key does not have ${resource}:${action} scope`,
		);
	}
	return apiKey;
}
