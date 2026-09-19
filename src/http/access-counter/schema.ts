import { z } from 'zod';

/**
 * Access counter — types + validators (Ticket F, branch 38).
 *
 * The counter is keyed by an opaque `key` (e.g. `home-page`). Each
 * (counter_key, principal, session_id) tuple is deduped inside the
 * `DEDUP_WINDOW_MS` window. When the dedup row is missing or
 * expired, the counter row is incremented atomically.
 *
 * In 0.3.0 the home uses per-request `crypto.randomUUID()` as the
 * `session_id`, which makes the counter a **page-view** counter.
 * Per-visitor dedup via the `mw_actor_id` cookie is a 0.4.0 ticket
 * (see ADR-0012). Coupling the counter to the reactions cookie now
 * would mix two backends and force one to chase the other's
 * privacy posture.
 */

export const MAX_COUNTER_KEY_LEN = 256;
export const MAX_SESSION_ID_LEN = 256;
export const DEDUP_WINDOW_MS = 60 * 60 * 1000;

function hasForbiddenChar(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const code = value.charCodeAt(i);
		// Disallow ASCII control characters (0x00–0x1f), space (0x20),
		// and DEL (0x7f). All printable Unicode is permitted.
		if (code <= 0x1f || code === 0x20 || code === 0x7f) return true;
	}
	return false;
}

export const validateCounterKey = (value: unknown): string => {
	if (typeof value !== 'string') {
		throw new Error('counter key must be a string');
	}
	if (value.length === 0 || value.length > MAX_COUNTER_KEY_LEN) {
		throw new Error(`counter key must be 1..${MAX_COUNTER_KEY_LEN} chars`);
	}
	if (hasForbiddenChar(value)) {
		throw new Error('counter key must not contain whitespace or control chars');
	}
	return value;
};

export const validateSessionId = (value: unknown): string => {
	if (typeof value !== 'string') {
		throw new Error('session id must be a string');
	}
	if (value.length === 0 || value.length > MAX_SESSION_ID_LEN) {
		throw new Error(`session id must be 1..${MAX_SESSION_ID_LEN} chars`);
	}
	if (hasForbiddenChar(value)) {
		throw new Error('session id must not contain whitespace or control chars');
	}
	return value;
};

export const HitInput = z.object({
	key: z.string().min(1).max(MAX_COUNTER_KEY_LEN),
	session_id: z.string().min(1).max(MAX_SESSION_ID_LEN),
});

export interface AccessCounterRow {
	key: string;
	/** API key id of the consumer that owns this counter row. */
	principal: string;
	count: number;
	first_hit: number;
	last_hit: number;
}

/**
 * Inputs and outputs of `recordHit` (counter.ts). Lives in schema.ts
 * so the `home/access/load.ts` consumer can `import type` them
 * without crossing into the implementation owner — see AGENTS.md §3
 * (`home/access -> http/access-counter (schema types only)`).
 */
export interface RecordHitInput {
	key: string;
	principal: string;
	session_id: string;
	now?: number;
}

export interface RecordHitOutput {
	/** Whether the dedup window accepted a fresh (key, principal, session_id) entry. */
	incremented: boolean;
	/** Counter value at the time of the call (after any increment). */
	count: number;
	first_hit: number;
	last_hit: number;
}

export interface GetCountOutput {
	count: number;
	first_hit: number | null;
	last_hit: number | null;
}
