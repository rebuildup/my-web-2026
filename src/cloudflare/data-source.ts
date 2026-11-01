/**
 * Development data-source contract (Issue #377).
 *
 * The question this module answers is NOT "which API do I call" but
 * **"which data am I looking at right now"** — the dev server's local
 * D1/R2 (miniflare), the canned mock responses, or the PRODUCTION
 * D1/R2 reached through `@cloudflare/vite-plugin`'s `remoteBindings`.
 *
 * Why the contract lives here
 * ---------------------------
 * The answer is a property of the Cloudflare runtime (which binding is
 * wired, which mode the Worker runs in), so the `cloudflare` obligation
 * owns it. Two other obligations need the same rule and may not depend
 * on each other:
 *
 *   - the external HTTP boundary (`http`) must REFUSE every write
 *     while the runtime is pointed at production;
 *   - the home surface (`home`) must SHOW which source it reads.
 *
 * `http` may import `cloudflare` (AGENTS.md §3) and `home/status` may
 * import `cloudflare` (AGENTS.md §3, "home/status -> cloudflare"), so
 * one module can serve both. The home's other directories reach the
 * same rule through `src/home/status/data-source.ts`, which re-exports
 * it — `home` itself may not import `cloudflare`.
 *
 * The three axes, and why they are three
 * --------------------------------------
 *
 *   1. `production` — the deployed Worker. Its bindings ARE the
 *      production resources and writes are legitimate.
 *   2. `local` — the dev server with miniflare. Its bindings are a
 *      local copy of the schema; writes are legitimate.
 *   3. `mock` — the dev server with `LOCAL_API_MODE=mock`; the
 *      external boundary answers `/api/v1/*` from canned fixtures and
 *      never touches D1. Writes are legitimate (they mutate an
 *      in-memory fixture, not a database).
 *   4. `production-readonly` — the dev server with remote bindings
 *      (Issue #377): the bindings ARE the production D1/R2, so reads
 *      show production data, and every write must be REFUSED.
 *
 * The mode is carried by ONE binding, `MY_WEB_2026_DATA_SOURCE`:
 *
 *   - the binding is declared ONLY in development
 *     (`cloudflare.config.ts`, mode-aware) and its ABSENCE is what
 *     identifies the deployed production Worker;
 *   - in development it always carries a value (`local` by default),
 *     so "the dev server is running against local bindings" is a
 *     stated fact rather than an inference from a missing binding.
 *
 * Fail-closed
 * -----------
 * An UNRECOGNIZED value is treated as `production-readonly`: the
 * runtime refuses writes and the descriptor carries a warning. The
 * dangerous direction (thinking a production-bound runtime is local)
 * is the one that must not happen; the inconvenient direction (a typo
 * in a local variable disabling local writes) is reported on the
 * development screen instead of silently writing to production.
 *
 * This module is deliberately dependency-free — no `cloudflare:workers`
 * import, no binding access at module scope — so the root
 * configuration files (`vite.config.ts`, `cloudflare.config.ts`) and
 * the Node dev wrapper (`scripts/_run-dev.mjs`) can all read the same
 * vocabulary without pulling a Worker bundle in.
 */

/** Name of the binding that carries the development data source. */
export const DATA_SOURCE_ENV_VAR = 'MY_WEB_2026_DATA_SOURCE';

/** The recognised data sources. */
export const DATA_SOURCE = {
	/** The deployed Worker: production bindings, writes allowed. */
	PRODUCTION: 'production',
	/** The dev server with local (miniflare) bindings. */
	LOCAL: 'local',
	/** The dev server with `LOCAL_API_MODE=mock` (canned responses). */
	MOCK: 'mock',
	/** The dev server with remote bindings — production data, no writes. */
	PRODUCTION_READONLY: 'production-readonly',
	/**
	 * The production-readonly MODE with LOCAL bindings.
	 *
	 * The operator asked for the production-readonly mode but the
	 * remote session was not established (`CLOUDFLARE_VITE_FORCE_LOCAL=true`),
	 * so the bindings stayed local. The write refusal is identical to
	 * the remote mode — which is what makes this the SAFE way to prove
	 * that a write is refused, without a write ever reaching the
	 * production database.
	 */
	PRODUCTION_READONLY_LOCAL: 'production-readonly-local',
} as const;

export type DataSource = (typeof DATA_SOURCE)[keyof typeof DATA_SOURCE];

/** The subset of the runtime env this contract reads. */
export interface DataSourceEnv {
	/** Issue #186 — the mock gate of the external HTTP boundary. */
	LOCAL_API_MODE?: string;
	/** Issue #377 — the development data source. */
	MY_WEB_2026_DATA_SOURCE?: string;
}

/** Whether the runtime may write to its bindings. */
export type WritePolicy = 'writable' | 'read-only';

/**
 * Everything a development screen needs to describe the current
 * source. The shape is closed on purpose: a screen that invents its
 * own fields is a screen that can disagree with the runtime.
 */
export interface DataSourceDescriptor {
	/** The recognised source. */
	source: DataSource;
	/** Short label for the indicator. */
	label: string;
	/** One sentence describing what the runtime is bound to. */
	detail: string;
	/** Whether writes are accepted. */
	write_policy: WritePolicy;
	/** Whether the external boundary answers from canned fixtures. */
	api_mode: 'live' | 'mock';
	/** Which D1/R2 the bindings point at. */
	binding_source: 'local' | 'production';
	/**
	 * Whether a consumer must read the aggregate STRAIGHT from the
	 * binding instead of through the external API.
	 *
	 * The API scopes every answer to the calling API key's principal,
	 * and the development key is not a row in the production
	 * database — so in the production-readonly mode the API cannot
	 * answer at all, and the home has to read the aggregate from the
	 * binding. It is true for the remote production-readonly mode and
	 * false everywhere else (the deployed Worker reads through the
	 * API with its own key).
	 */
	production_binding_read: boolean;
	/**
	 * Present when the runtime could not classify the configuration
	 * with confidence (an unrecognised value). The screen must show
	 * it — a silent fallback is how a developer ends up writing to
	 * production without noticing.
	 */
	warning?: string;
}

/** The stable refusal code for a write against a read-only runtime. */
export const PRODUCTION_READONLY_REFUSAL_CODE = 'production_readonly_write_refused';

/** A refusal returned to the caller instead of performing a write. */
export interface WriteRefusal {
	/** Stable machine-readable code. */
	code: typeof PRODUCTION_READONLY_REFUSAL_CODE;
	/** The operation that was refused (never a secret). */
	operation: string;
	/** Human-readable reason. */
	message: string;
}

/**
 * Name of the environment variable that forces the dev server's
 * bindings to stay local even when the production-readonly mode was
 * requested. It is the plugin's own name (`@cloudflare/vite-plugin`
 * reads it from the environment), and the repository reads it too so
 * that the runtime can state the truth about where the data comes
 * from.
 */
export const FORCE_LOCAL_ENV_VAR = 'CLOUDFLARE_VITE_FORCE_LOCAL';

/**
 * Whether the given raw binding value names the production-readonly
 * development mode.
 *
 * This is the SINGLE predicate that decides whether the dev server
 * points its bindings at production. `vite.config.ts` uses it to turn
 * `remoteBindings` on and `cloudflare.config.ts` uses it to declare
 * the binding, so the two can never disagree: they read the same
 * value with the same rule.
 */
export function isProductionReadonlyValue(value: string | undefined): boolean {
	return value === DATA_SOURCE.PRODUCTION_READONLY;
}

/**
 * Whether the operator asked the dev server to keep its bindings
 * local even in the production-readonly mode.
 */
export function isForceLocal(env: Record<string, string | undefined>): boolean {
	return env[FORCE_LOCAL_ENV_VAR] === 'true';
}

/**
 * Whether the dev server's D1 / R2 bindings point at the PRODUCTION
 * resources.
 *
 * This is the ONE predicate both configuration files use:
 * `vite.config.ts` turns the plugin's `remoteBindings` on with it and
 * `cloudflare.config.ts` marks the bindings remote with it, so the
 * binding target and the runtime's write policy cannot drift apart.
 */
export function isRemoteBindingsEnabled(env: Record<string, string | undefined>): boolean {
	return isProductionReadonlyValue(env[DATA_SOURCE_ENV_VAR]) && !isForceLocal(env);
}

/**
 * The value the development surface DECLARES as its data source.
 *
 * The development surface always states its source: `local` by
 * default, `production-readonly` when the operator opted in, and
 * `production-readonly-local` when the operator opted in but forced
 * the bindings to stay local.
 *
 * The declaration itself is made by `cloudflare.config.ts`, which
 * cannot import this module (the Cloudflare config loader runs
 * OUTSIDE the Worker module graph — see the note in that file). The
 * vocabulary below is the one both sides use, and
 * `test/integration/dev-data-source.test.ts` asserts that every value
 * the configuration declares is recognised here.
 */

/**
 * Resolve the current data source from the runtime env.
 *
 * `env.MY_WEB_2026_DATA_SOURCE` absent → the deployed production
 * Worker (unless the mock gate is on, which only a development
 * surface can do). Present → the dev server, whose mode the value
 * names.
 */
export function resolveDataSource(env: DataSourceEnv): DataSourceDescriptor {
	const raw = env.MY_WEB_2026_DATA_SOURCE;
	if (raw === DATA_SOURCE.PRODUCTION_READONLY_LOCAL) {
		// The production-readonly MODE, with local bindings. The write
		// refusal is the same as the remote mode — that is the point:
		// the refusal can be proved without a write ever reaching the
		// production database.
		return {
			source: DATA_SOURCE.PRODUCTION_READONLY,
			label: 'Production-readonly mode',
			detail:
				'The write refusal of the production-readonly mode is active, but the bindings stayed local (the remote session was not established). Reads show local data.',
			write_policy: 'read-only',
			api_mode: 'live',
			binding_source: 'local',
			production_binding_read: false,
		};
	}
	if (raw === DATA_SOURCE.PRODUCTION_READONLY) {
		// The explicit production opt-in wins over the mock gate: a
		// stale `LOCAL_API_MODE=mock` in a developer's `.dev.vars`
		// must not silently downgrade the mode the operator asked
		// for. The mock gate is disabled in this mode (the boundary
		// asks this descriptor, not the raw variable).
		return {
			source: DATA_SOURCE.PRODUCTION_READONLY,
			label: 'Production-readonly mode',
			detail:
				'The dev server bindings point at the production D1 / R2. Reads show production data; every write is refused.',
			write_policy: 'read-only',
			api_mode: 'live',
			binding_source: 'production',
			production_binding_read: true,
			...(env.LOCAL_API_MODE === 'mock'
				? {
						warning:
							'LOCAL_API_MODE=mock is set, but the production-readonly mode takes precedence — the mock gate is disabled.',
					}
				: {}),
		};
	}
	if (env.LOCAL_API_MODE === 'mock') {
		return {
			source: DATA_SOURCE.MOCK,
			label: 'Mock data',
			detail:
				'The external boundary answers /api/v1/* from canned fixtures. No database is read or written.',
			write_policy: 'writable',
			api_mode: 'mock',
			binding_source: 'local',
			production_binding_read: false,
		};
	}
	if (raw === undefined) {
		// The deployed production Worker: the binding is declared in
		// development only, so its absence identifies production.
		return {
			source: DATA_SOURCE.PRODUCTION,
			label: 'Production',
			detail: 'The deployed Worker. Its bindings are the production D1 / R2.',
			write_policy: 'writable',
			api_mode: 'live',
			binding_source: 'production',
			production_binding_read: false,
		};
	}
	if (raw === DATA_SOURCE.LOCAL) {
		return {
			source: DATA_SOURCE.LOCAL,
			label: 'Local data',
			detail:
				'The dev server bindings point at the local (miniflare) copy of the schema. Nothing leaves this machine.',
			write_policy: 'writable',
			api_mode: 'live',
			binding_source: 'local',
			production_binding_read: false,
		};
	}
	// Unrecognised value — fail closed. Writes are refused and the
	// warning travels with the descriptor so the development screen
	// can name the mistake.
	return {
		source: DATA_SOURCE.PRODUCTION_READONLY,
		label: 'Unknown data source (read-only)',
		detail: `The runtime could not classify ${DATA_SOURCE_ENV_VAR}=${JSON.stringify(raw)}.`,
		write_policy: 'read-only',
		api_mode: 'live',
		binding_source: 'local',
		production_binding_read: false,
		warning: `Unrecognised ${DATA_SOURCE_ENV_VAR} value. Writes are refused until the value is one of ${Object.values(DATA_SOURCE).join(', ')}.`,
	};
}

/**
 * Whether the runtime accepts writes at all.
 *
 * Only the production-readonly mode refuses. The rule is deliberately
 * narrow: a refusal that also fired in production would break the
 * deployed platform, and a refusal that did not fire in
 * production-readonly mode would write to production.
 */
export function isWritable(env: DataSourceEnv): boolean {
	return resolveDataSource(env).write_policy === 'writable';
}

/**
 * The refusal a write operation must return while the runtime is
 * bound to production, or `null` when the write may proceed.
 *
 * Every write path against a durable store calls this BEFORE it
 * touches D1 / R2, and returns the refusal to its caller with a
 * reason — a silent no-op would look like a successful write.
 */
export function productionWriteRefusal(env: DataSourceEnv, operation: string): WriteRefusal | null {
	if (isWritable(env)) return null;
	return {
		code: PRODUCTION_READONLY_REFUSAL_CODE,
		operation,
		message: `Refused: the runtime is bound to production data (read-only). The operation "${operation}" was not performed.`,
	};
}
