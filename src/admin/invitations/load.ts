import { env } from 'cloudflare:workers';
import { createServerFn } from '@tanstack/react-start';
import { getRequestUrl } from '@tanstack/react-start/server';
import { z } from 'zod';
import { requireAdmin } from '../auth/require-admin';

/**
 * Invitation CRUD — admin-only.
 *
 * Invitations are project-owned (`auth_invitation` table,
 * `migrations/0001_better_auth.sql`). The plaintext token is shown
 * to the admin exactly once at creation time; only the SHA-256 hash
 * is persisted. Acceptance validates the hash with a constant-time
 * compare (see `accept.ts`).
 *
 * Expiry is 7 days (project policy, ADR-0009 §4). Beyond that the
 * row is treated as invalid and `acceptInvitation` rejects it. The
 * revocation endpoint deletes the row outright — there is no
 * soft-delete state.
 */

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface Invitation {
	id: string;
	email: string;
	expiresAt: number;
	consumedAt: number | null;
	createdAt: number;
	consumed: boolean;
}

const ListInvitationsInput = z.object({}).strict();

export const listInvitations = createServerFn({ method: 'GET' })
	.validator(ListInvitationsInput)
	.handler(async (): Promise<readonly Invitation[]> => {
		await requireAdmin();
		const rows = await env.DB.prepare(
			'SELECT id, email, expires_at, consumed_at, created_at FROM auth_invitation ORDER BY created_at DESC LIMIT 200',
		).all<{
			id: string;
			email: string;
			expires_at: number;
			consumed_at: number | null;
			created_at: number;
		}>();
		return (rows.results ?? []).map((r) => ({
			id: r.id,
			email: r.email,
			expiresAt: r.expires_at,
			consumedAt: r.consumed_at,
			createdAt: r.created_at,
			consumed: r.consumed_at !== null,
		}));
	});

const CreateInvitationInput = z.object({
	email: z.string().email(),
});

export interface CreateInvitationResult {
	invitation: Invitation;
	plaintextToken: string;
	acceptUrl: string;
}

export const createInvitation = createServerFn({ method: 'POST' })
	.validator(CreateInvitationInput)
	.handler(async ({ data }): Promise<CreateInvitationResult> => {
		const session = await requireAdmin();
		const email = data.email.toLowerCase();

		// Refuse if a user with this email already exists. Better Auth's
		// admin plugin can list users; we use the simplest possible check
		// here and let the admin UI surface a clear error.
		const existing = await env.DB.prepare('SELECT id FROM user WHERE email = ?').first<{
			id: string;
		}>(email);
		if (existing) {
			throw new InvitationError('email_already_registered');
		}

		const id = crypto.randomUUID();
		const plaintextToken = generateOpaqueToken();
		const tokenHash = await sha256Hex(plaintextToken);
		const now = Date.now();
		const expiresAt = now + INVITATION_TTL_MS;

		await env.DB.prepare(
			'INSERT INTO auth_invitation (id, email, token_hash, invited_by, expires_at, consumed_at, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
		)
			.bind(id, email, tokenHash, session.user.id, expiresAt, now)
			.run();

		const requestUrl = getRequestUrl();
		const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
		return {
			invitation: { id, email, expiresAt, consumedAt: null, createdAt: now, consumed: false },
			plaintextToken,
			acceptUrl: `${baseUrl}/admin/invitations/accept?token=${encodeURIComponent(plaintextToken)}`,
		};
	});

const RevokeInvitationInput = z.object({ id: z.string().uuid() });

export const revokeInvitation = createServerFn({ method: 'POST' })
	.validator(RevokeInvitationInput)
	.handler(async ({ data }): Promise<{ revoked: boolean }> => {
		await requireAdmin();
		// Revocation deletes the row outright. If a token has already
		// been accepted, it cannot be revoked — the user is already
		// provisioned.
		const result = await env.DB.prepare(
			'DELETE FROM auth_invitation WHERE id = ? AND consumed_at IS NULL',
		)
			.bind(data.id)
			.run();
		return { revoked: (result.meta?.changes ?? 0) > 0 };
	});

export class InvitationError extends Error {
	constructor(public reason: 'email_already_registered' | 'invalid_input') {
		super(reason);
		this.name = 'InvitationError';
	}
}

function generateOpaqueToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	// URL-safe base64 without padding.
	const b64 = btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/, '');
	return b64;
}

async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
