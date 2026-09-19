import { createServerFn } from '@tanstack/react-start';
import { getRequestHeaders } from '@tanstack/react-start/server';
import { z } from 'zod';
import { auth } from '../../cloudflare/auth/better-auth';
import { requireAdmin } from '../auth/require-admin';

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

export const listApiKeys = createServerFn({ method: 'GET' })
	.validator(z.object({}).strict())
	.handler(async (): Promise<readonly AdminApiKey[]> => {
		await requireAdmin();
		const headers = getRequestHeaders();
		// Better Auth's `/api-key/list` endpoint is gated by
		// `sessionMiddleware`, which resolves the caller from the
		// forwarded headers. The api-key plugin attaches
		// `referenceId = session.user.id` server-side; an admin
		// calling this sees the keys they own. The plugin's
		// adminMiddleware is independent — we already gate on role
		// via `requireAdmin()` above, so passing `{ headers }` is
		// sufficient.
		const result = await auth.api.listApiKeys({
			headers,
		});
		const rows = (result as unknown as { apiKeys?: Array<Record<string, unknown>> }).apiKeys ?? [];
		return rows.map(toAdminApiKey);
	});

export const createApiKey = createServerFn({ method: 'POST' })
	.validator(CreateApiKeyInput)
	.handler(async ({ data }): Promise<CreateApiKeyResult> => {
		const session = await requireAdmin();
		const headers = getRequestHeaders();
		// The api-key plugin's create endpoint requires the calling
		// admin's session headers — direct `auth.api.createApiKey`
		// without headers is rejected as unauthenticated. The plugin
		// also requires a `userId` (or `prefix` for the prefixed key
		// format); we pass the admin user id so the new key is
		// owned by the calling admin.
		const created = (await auth.api.createApiKey({
			headers,
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
	});

const DeleteApiKeyInput = z.object({ id: z.string().min(1).max(128) });

export const deleteApiKey = createServerFn({ method: 'POST' })
	.validator(DeleteApiKeyInput)
	.handler(async ({ data }): Promise<{ deleted: boolean }> => {
		await requireAdmin();
		const headers = getRequestHeaders();
		await auth.api.deleteApiKey({
			headers,
			body: { keyId: data.id },
		});
		return { deleted: true };
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
