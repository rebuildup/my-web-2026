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

import { redactLogError, redactLogText, redactLogValue } from './redact';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AuditLogger {
	/**
	 * Emit a structured audit record: one line of JSON carrying
	 * `event`, `at`, and the redacted `fields`.
	 */
	audit(event: string, fields?: Record<string, unknown>): void;
	debug(message: string, ...details: readonly unknown[]): void;
	info(message: string, ...details: readonly unknown[]): void;
	warn(message: string, ...details: readonly unknown[]): void;
	error(message: string, ...details: readonly unknown[]): void;
}

/** Console method per level. Kept explicit so the gate's allowlist is readable. */
const LEVEL_METHOD: Record<LogLevel, 'debug' | 'log' | 'warn' | 'error'> = {
	debug: 'debug',
	info: 'log',
	warn: 'warn',
	error: 'error',
};

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
 * Create the logger for one scope.
 *
 * @param scope stable correlation prefix, e.g. `boundary`.
 */
export function createAuditLogger(scope: string): AuditLogger {
	return {
		audit(event: string, fields: Record<string, unknown> = {}): void {
			const record = redactLogValue({
				event,
				at: new Date().toISOString(),
				...fields,
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
	};
}
