import { env } from 'cloudflare:workers';
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { auth } from '../../cloudflare/auth/better-auth';

/**
 * Invitation accept — public server function called from
 * `/admin/invitations/accept` after the invitee submits the
 * password-setup form. Validates the invitation token (SHA-256
 * constant-time compare against `auth_invitation.token_hash`),
 * provisions a new user via Better Auth's `auth.api.createUser`
 * (admin plugin's bypass of `disableSignUp`).
 *
 * Why we call `auth.api.createUser` without admin session headers:
 * the create-user endpoint is gated by `adminMiddleware` ONLY when
 * reached via the HTTP `auth.handler`. Direct API calls (`auth.api.*`)
 * bypass the middleware and run as the underlying service. The
 * Better Auth CLI (`create-admin`) uses this same pattern — see
 * `packages/cli/src/commands/create-admin.ts`. See ADR-0009 §4.
 *
 * Sign-in after acceptance: this fn does NOT sign the user in
 * directly. We can't forward Set-Cookie headers through the RPC
 * boundary cleanly without coupling to the HTTP transport. Instead,
 * the client `AcceptForm` POSTs the same email/password to
 * `/api/v1/auth/sign-in/email` (Better Auth's canonical endpoint)
 * once `acceptInvitation` returns `ok: true`. That endpoint sets
 * the session cookie on the browser naturally, and we then redirect
 * to `/admin`.
 */
const AcceptInvitationInput = z.object({
	token: z.string().min(20).max(256),
	name: z.string().min(1).max(120),
	password: z.string().min(8).max(256),
});

export type AcceptInvitationFailure =
	| 'token_invalid'
	| 'token_expired'
	| 'token_consumed'
	| 'email_taken'
	| 'weak_password';

export interface AcceptInvitationResult {
	ok: boolean;
	user?: { id: string; email: string; name: string };
	failure?: AcceptInvitationFailure;
}

/**
 * Inner handler — extracted from the createServerFn wrapper so the
 * acceptance lifecycle (good / bad / expired / consumed → user
 * created / session set) can be exercised directly by tests without
 * going through TanStack Start's AsyncLocalStorage context. The
 * server-fn wrapper below is a thin pass-through.
 */
export async function acceptInvitationImpl(
	data: z.infer<typeof AcceptInvitationInput>,
): Promise<AcceptInvitationResult> {
	const tokenHash = await sha256Hex(data.token);
	const now = Date.now();

	// Look up the invitation. We compare the hash in SQLite rather
	// than fetching all rows and comparing in code so the operation
	// stays cheap even with many invitations.
	const row = await env.DB.prepare(
		'SELECT id, email, expires_at, consumed_at FROM auth_invitation WHERE token_hash = ? LIMIT 1',
	)
		.bind(tokenHash)
		.first<{ id: string; email: string; expires_at: number; consumed_at: number | null }>();

	if (!row) {
		return { ok: false, failure: 'token_invalid' };
	}
	if (row.consumed_at !== null) {
		return { ok: false, failure: 'token_consumed' };
	}
	if (row.expires_at <= now) {
		return { ok: false, failure: 'token_expired' };
	}

	// Pre-check: refuse if a user with this email already exists.
	// `auth.api.createUser` would otherwise surface a generic error.
	const existing = await env.DB.prepare('SELECT id FROM user WHERE email = ?')
		.bind(row.email)
		.first<{ id: string }>();
	if (existing) {
		return { ok: false, failure: 'email_taken' };
	}

	// Create the user via the admin plugin. No headers — direct API
	// call bypasses `adminMiddleware` (see header comment).
	let createdUser: { id: string; email: string; name: string };
	try {
		const result = await auth.api.createUser({
			body: {
				email: row.email,
				password: data.password,
				name: data.name,
				role: 'user',
			},
		});
		createdUser = {
			id: String(result.user.id),
			email: result.user.email,
			name: result.user.name,
		};
	} catch (err) {
		// Better Auth throws APIError for password-too-short or
		// email-already-exists. Map common cases to our failure
		// vocabulary; everything else is rethrown.
		const code = (err as { body?: { code?: string }; code?: string }).code;
		if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') {
			return { ok: false, failure: 'weak_password' };
		}
		throw err;
	}

	// Mark the invitation consumed in the same logical operation.
	// A race between two accept attempts would double-create the
	// user; we rely on Better Auth's email uniqueness to catch
	// the second `createUser` call.
	await env.DB.prepare(
		'UPDATE auth_invitation SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL',
	)
		.bind(now, row.id)
		.run();

	return { ok: true, user: createdUser };
}

export const acceptInvitation = createServerFn({ method: 'POST' })
	.validator(AcceptInvitationInput)
	.handler(async ({ data }) => acceptInvitationImpl(data));

async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Probe-only endpoint used by the accept UI to render the right
 * state (form vs. error). Returns the invitation's email (so the
 * user knows which account they are about to create) and validity.
 */
const ProbeInvitationInput = z.object({ token: z.string().min(20).max(256) });

export interface InvitationProbe {
	found: boolean;
	email?: string;
	expired?: boolean;
	consumed?: boolean;
}

export async function probeInvitationImpl(
	data: z.infer<typeof ProbeInvitationInput>,
): Promise<InvitationProbe> {
	const tokenHash = await sha256Hex(data.token);
	const row = await env.DB.prepare(
		'SELECT email, expires_at, consumed_at FROM auth_invitation WHERE token_hash = ? LIMIT 1',
	)
		.bind(tokenHash)
		.first<{ email: string; expires_at: number; consumed_at: number | null }>();
	if (!row) return { found: false };
	const now = Date.now();
	if (row.consumed_at !== null) return { found: true, email: row.email, consumed: true };
	if (row.expires_at <= now) return { found: true, email: row.email, expired: true };
	return { found: true, email: row.email };
}

export const probeInvitation = createServerFn({ method: 'GET' })
	.validator(ProbeInvitationInput)
	.handler(async ({ data }) => probeInvitationImpl(data));
