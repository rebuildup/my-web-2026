/**
 * Runtime logging surface (Issue #467).
 *
 * Every runtime diagnostic in `src/**` is emitted through
 * `createAuditLogger`. The logger is the ONLY module allowed to
 * touch `console` — `scripts/check-log-redaction.mjs` fails the
 * build if any other `src/**` file calls `console.*`, so a new log
 * call site cannot opt out of redaction by accident or by review
 * fatigue.
 *
 * Two record shapes:
 *
 *   - **Human line** (`debug` / `info` / `warn` / `error`) —
 *     `[scope] message` plus redacted details. Use it for operator
 *     diagnostics.
 *   - **Audit record** (`audit`) — a single-line JSON object with a
 *     stable key order, so an incident report can be read (and
 *     grepped) without reconstructing the log format. Use it for
 *     "this event happened and this is what we know about it"
 *     statements; every field still passes through redaction.
 *     `event` and `at` are **reserved**: the logger owns them, so a
 *     caller field of the same name is moved to `caller_event` /
 *     `caller_at` instead of overwriting the record's meaning.
 *
 * Both shapes are lossy by design. A call site that needs more than
 * the redacted record has to log a purpose-built, minimal shape
 * (see `describeAuthEmail` in `src/cloudflare/auth/better-auth.ts`)
 * — never the raw payload it happened to be handed.
 *
 * Scope naming: `[owner.path.action]`, e.g. `boundary`,
 * `home.access`, `auth.email`. The scope is a stable correlation
 * token, so keep it identical to the existing log prefixes rather
 * than inventing a second vocabulary.
 */

import { redactCorrelationId, redactLogError, redactLogText, redactLogValue } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AuditLogger {
	/**
	 * Emit a structured audit record: one line of JSON carrying
	 * `event`, `at`, and the redacted `fields`.
	 *
	 * `event` and `at` are **reserved**: the record's event name and
	 * timestamp are owned by the logger, so a caller field of the
	 * same name can never overwrite them (that would falsify what
	 * happened and when). A colliding field is preserved under
	 * `caller_event` / `caller_at` instead of being dropped, so the
	 * information is still readable — just not under the reserved
	 * name.
	 */
	audit(event: string, fields?: Record<string, unknown>): void;
	debug(message: string, ...details: readonly unknown[]): void;
	info(message: string, ...details: readonly unknown[]): void;
	warn(message: string, ...details: readonly unknown[]): void;
	error(message: string, ...details: readonly unknown[]): void;
	/**
	 * Emit an error record that also carries a correlation token.
	 *
	 * Shape: `[scope] <message> (request_id=<token>)`. The token is
	 * the ONLY value that may reach the line verbatim, and only after
	 * `redactCorrelationId` proved it is this repository's own mint
	 * format (128-bit lowercase hex). Pass `null` when the caller
	 * cannot prove it minted the id — a client-supplied `X-Request-Id`
	 * is accepted from a far wider alphabet and must not be laundered
	 * into an operator-visible record. Everything else (the message
	 * and every detail) is redacted exactly as `error` does.
	 */
	errorCorrelated(message: string, requestId: string | null, ...details: readonly unknown[]): void;
}

/** Console method per level. Kept explicit so the gate's allowlist is readable. */
const LEVEL_METHOD: Record<LogLevel, 'debug' | 'log' | 'warn' | 'error'> = {
	debug: 'debug',
	info: 'log',
	warn: 'warn',
	error: 'error',
};

/**
 * Keys the audit record owns. A caller field may not take them:
 * `event` names what happened and `at` says when, so a caller that
 * could overwrite them could falsify an incident report.
 */
const RESERVED_AUDIT_KEYS = ['event', 'at'] as const;

/**
 * Where a caller field that collides with a reserved key is kept.
 *
 * The collision is **rejected**, not silently ignored: the value is
 * preserved under a different key so nothing disappears, and the
 * reserved key keeps its logger-owned meaning.
 */
const RESERVED_AUDIT_FALLBACK: Record<(typeof RESERVED_AUDIT_KEYS)[number], string> = {
	event: 'caller_event',
	at: 'caller_at',
};

/**
 * Move every reserved-key collision out of the caller's field bag.
 *
 * `Object.defineProperty` is used instead of assignment because an
 * own `__proto__` key (which `JSON.parse` produces from an untrusted
 * body) would otherwise mutate the result's PROTOTYPE instead of
 * being carried as data.
 *
 * A collision is renamed, never dropped: the caller's value stays in
 * the record, it just cannot take the reserved name. If the caller
 * already used the fallback name itself, a numbered variant is used
 * so no value is lost either way.
 */
function withoutReservedKeys(fields: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	const define = (key: string, value: unknown): void => {
		Object.defineProperty(out, key, {
			value,
			enumerable: true,
			writable: true,
			configurable: true,
		});
	};
	for (const key of Object.keys(fields)) {
		if (!(RESERVED_AUDIT_KEYS as readonly string[]).includes(key)) define(key, fields[key]);
	}
	for (const key of RESERVED_AUDIT_KEYS) {
		if (!Object.hasOwn(fields, key)) continue;
		let target = RESERVED_AUDIT_FALLBACK[key];
		for (let suffix = 2; Object.hasOwn(out, target); suffix += 1) {
			target = `${RESERVED_AUDIT_FALLBACK[key]}_${suffix}`;
		}
		define(target, fields[key]);
	}
	return out;
}

/**
 * Redact one detail argument. `Error` values collapse to
 * `{ name, message }`; everything else goes through the structured
 * redactor.
 */
function redactDetail(detail: unknown): unknown {
	if (detail instanceof Error) return redactLogError(detail);
	return redactLogValue(detail);
}

function emit(level: LogLevel, scope: string, message: string, details: readonly unknown[]): void {
	// The message is redacted too: call sites interpolate upstream
	// status lines and error text into it.
	console[LEVEL_METHOD[level]](
		`[${scope}] ${redactLogText(message)}`,
		...details.map(redactDetail),
	);
}

/**
 * Emit an error record that carries a verified correlation token.
 *
 * The token is appended AFTER the message redaction, because the point
 * of the channel is that a minted id survives the opaque-blob rule; the
 * message itself and every detail are redacted exactly as in `emit`.
 */
function emitWithCorrelation(
	scope: string,
	message: string,
	requestId: string | null,
	details: readonly unknown[],
): void {
	console.error(
		`[${scope}] ${redactLogText(message)} (request_id=${redactCorrelationId(requestId)})`,
		...details.map(redactDetail),
	);
}

/**
 * Create the logger for one scope.
 *
 * @param scope stable correlation prefix, e.g. `boundary`.
 */
export function createAuditLogger(scope: string): AuditLogger {
	return {
		audit(event: string, fields: Record<string, unknown> = {}): void {
			// The record's own metadata is spread FIRST so a caller
			// field can never overwrite `event` / `at`.
			const record = redactLogValue({
				event,
				at: new Date().toISOString(),
				...withoutReservedKeys(fields),
			});
			// `JSON.stringify` of a redacted record cannot throw for the
			// shapes `redactLogValue` produces (plain objects, arrays,
			// primitives), but a defensive fallback keeps a logging call
			// from ever taking down the request it was describing.
			const line = (() => {
				try {
					return JSON.stringify(record);
				} catch {
					return '{"event":"[unserializable]"}';
				}
			})();
			console.log(`[${scope}] ${line}`);
		},
		debug(message: string, ...details: readonly unknown[]): void {
			emit('debug', scope, message, details);
		},
		info(message: string, ...details: readonly unknown[]): void {
			emit('info', scope, message, details);
		},
		warn(message: string, ...details: readonly unknown[]): void {
			emit('warn', scope, message, details);
		},
		error(message: string, ...details: readonly unknown[]): void {
			emit('error', scope, message, details);
		},
		errorCorrelated(
			message: string,
			requestId: string | null,
			...details: readonly unknown[]
		): void {
			emitWithCorrelation(scope, message, requestId, details);
		},
	};
}
