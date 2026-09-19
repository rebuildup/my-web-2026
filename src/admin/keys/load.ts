import { createServerFn } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';
import { z } from 'zod';
import { auth } from '../../cloudflare/auth/better-auth';
import { requireAdmin, AdminAuthError } from '../auth/require-admin';
import type { AdminSession } from '../auth/load';

/**
 * Admin API key management — server functions over the Better Auth
 * API key plugin.
 *
 * Per ADR-0008, admin operations do not cross a Hono boundary. They
 * go directly from `createServerFn` to `auth.api.*`, forwarding the
 * incoming request headers so Better Auth recognises the caller as
 * an admin (the plugin's `adminMiddleware` is satisfied because the
 * `requireAdmin()` helper above gates on role first).
 *
 * Permissions shape (resource/action):
 *   `{ access_counter: ["read","write"], reactions: ["read","write"] }`
 * Documented in ADR-0009 §3. We validate this shape on the way in
 * with Zod so malformed permissions never reach the plugin.
 *
 * The plaintext API key returned by `createApiKey` is shown to the
 * admin **exactly once**: the plugin hashes before persisting, and
 * subsequent `listApiKeys` returns only the prefix + start, never
 * the key. The admin UI surfaces this in a single copy-block.
 *
 * Testability: each server-fn wrapper delegates to an `*Impl`
 * function that takes the resolved `session` (already verified
 * admin by `requireAdmin()`) plus the request `headers`. Tests
 * exercise the impls directly without going through
 * `createServerFn`'s AsyncLocalStorage context — see
 * `src/admin/keys/load.test.ts`.
 */

export type ApiKeyPermissionAction = 'read' | 'write';

export type ApiKeyPermissions = Partial<Record<string, readonly ApiKeyPermissionAction[]>>;

const RESOURCES = ['access_counter', 'reactions'] as const;
const ACTIONS: readonly ApiKeyPermissionAction[] = ['read', 'write'];

const PermissionsSchema = z
	.partialRecord(z.enum(RESOURCES), z.array(z.enum(ACTIONS)))
	.refine((p) => Object.keys(p).length > 0, { message: 'at least one resource scope' });

const CreateApiKeyInput = z.object({
	name: z.string().min(1).max(120),
	permissions: PermissionsSchema,
});

export interface AdminApiKey {
	id: string;
	name: string | null;
	prefix: string | null;
	start: string | null;
	permissions: ApiKeyPermissions;
	createdAt: string;
	enabled: boolean;
	expiresAt: string | null;
	lastRequest: string | null;
}

export interface CreateApiKeyResult {
	key: AdminApiKey;
	plaintext: string;
}

export async function listApiKeysImpl(
	session: AdminSession,
	headers: Headers,
): Promise<readonly AdminApiKey[]> {
	// `listApiKeys` only needs an authenticated admin to identify the
	// caller's keys via `referenceId = session.user.id`. Forwarding
	// the session headers lets the `sessionMiddleware` resolve the
	// admin; no other fields (permissions, rateLimitMax, …) flow in
	// the body, so the SERVER_ONLY_PROPERTY gate is not triggered
	// here. See `createApiKey` for the parallel reasoning on why
	// that one DOES drop the headers.
	const result = await auth.api.listApiKeys({ headers });
	const rows = (result as unknown as { apiKeys?: Array<Record<string, unknown>> }).apiKeys ?? [];
	return rows.map(toAdminApiKey);
}

export const listApiKeys = createServerFn({ method: 'GET' })
	.validator(z.object({}).strict())
	.handler(async (): Promise<readonly AdminApiKey[]> => {
		const session = await requireAdmin();
		return listApiKeysImpl(session, getRequestHeaders());
	});

export async function createApiKeyImpl(
	session: AdminSession,
	_headers: Headers,
	data: z.infer<typeof CreateApiKeyInput>,
): Promise<CreateApiKeyResult> {
	// Better Auth's api-key plugin guards `permissions` (and several
	// other fields) with a SERVER_ONLY_PROPERTY check that fires when
	// the call looks like a client request — i.e., when `headers` or
	// `request` are forwarded. The check is asymmetric: `userId` is
	// allowed alongside headers, but `permissions` is not, because the
	// admin/SSO surface sets these server-side.
	//
	// Our create path runs from the admin UI which already gated on
	// role via `requireAdmin()`. We therefore call the endpoint
	// without forwarding the caller's headers — the admin plugin's
	// `sessionMiddleware` is intentionally bypassed, mirroring
	// Better Auth CLI's own create-admin pattern. The api-key plugin
	// resolves `referenceId` from the body's `userId` in this branch
	// (apikey plugin source, line 753 onward: `else { referenceId =
	// sessionUserId || ctxUserId }`), which we set to the admin's
	// session user id. See ADR-0009 §4 for the broader "service role"
	// pattern that this implements for admin operations.
	void _headers;
	const created = (await auth.api.createApiKey({
		body: {
			name: data.name,
			userId: session.user.id,
			permissions: data.permissions as Record<string, string[]>,
		},
	})) as Record<string, unknown> & { key: string };

	const key: AdminApiKey = toAdminApiKey({
		id: String(created.id),
		name: typeof created.name === 'string' ? created.name : null,
		prefix: typeof created.prefix === 'string' ? created.prefix : null,
		start: typeof created.start === 'string' ? created.start : null,
		permissions: (created.permissions ?? {}) as ApiKeyPermissions,
		createdAt: created.createdAt,
		enabled: created.enabled !== false,
		expiresAt: created.expiresAt,
		lastRequest: created.lastRequest,
	});

	return { key, plaintext: created.key };
}

export const createApiKey = createServerFn({ method: 'POST' })
	.validator(CreateApiKeyInput)
	.handler(async ({ data }): Promise<CreateApiKeyResult> => {
		const session = await requireAdmin();
		return createApiKeyImpl(session, getRequestHeaders(), data);
	});

const DeleteApiKeyInput = z.object({ id: z.string().min(1).max(128) });

export async function deleteApiKeyImpl(
	_session: AdminSession,
	headers: Headers,
	data: z.infer<typeof DeleteApiKeyInput>,
): Promise<{ deleted: boolean }> {
	// `deleteApiKey` is gated by `sessionMiddleware`; forwarding the
	// admin's session headers is required for the plugin to identify
	// the caller as admin and check ownership of the row. The body
	// only carries `keyId` — no SERVER_ONLY_PROPERTY fields — so
	// `isClientRequest && permissions…` does not fire.
	await auth.api.deleteApiKey({
		headers,
		body: { keyId: data.id },
	});
	return { deleted: true };
}

export const deleteApiKey = createServerFn({ method: 'POST' })
	.validator(DeleteApiKeyInput)
	.handler(async ({ data }): Promise<{ deleted: boolean }> => {
		const session = await requireAdmin();
		return deleteApiKeyImpl(session, getRequestHeaders(), data);
	});

function toAdminApiKey(row: Record<string, unknown>): AdminApiKey {
	const createdAt = row.createdAt;
	const expiresAt = row.expiresAt;
	const lastRequest = row.lastRequest;
	return {
		id: String(row.id),
		name: typeof row.name === 'string' ? row.name : null,
		prefix: typeof row.prefix === 'string' ? row.prefix : null,
		start: typeof row.start === 'string' ? row.start : null,
		permissions: (row.permissions ?? {}) as ApiKeyPermissions,
		createdAt: createdAt instanceof Date ? createdAt.toISOString() : String(createdAt ?? ''),
		enabled: row.enabled !== false,
		expiresAt:
			expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt ? String(expiresAt) : null,
		lastRequest:
			lastRequest instanceof Date
				? lastRequest.toISOString()
				: lastRequest
					? String(lastRequest)
					: null,
	};
}

/**
 * Re-exported so tests don't need a second import path.
 */
export { AdminAuthError };
