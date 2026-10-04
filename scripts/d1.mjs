#!/usr/bin/env node
/**
 * `d1.mjs` — CLI wrapper over the repository-owned D1 driver.
 *
 * Deliberately the ONLY place D1 is driven from a package script.
 *
 *   pnpm exec node scripts/d1.mjs list    [--target=local|production]
 *   pnpm exec node scripts/d1.mjs apply   [--target=local] [--execute]
 *   pnpm exec node scripts/d1.mjs query   --sql "<read-only sql>" [--target=...]
 *
 * `--target` defaults to `local`. A production APPLY additionally
 * requires `--execute`; without it this only lists what is pending.
 * That is the point: `cf` applies by default and treats remote as the
 * default, so "forgot a flag" must not mean "wrote to production".
 */
import { applyMigrations, listMigrations, queryRows } from './_d1.mjs';

/**
 * Parse the CLI boundary. Pure, so the execute gate can be tested
 * without spawning anything.
 *
 * Regression this exists for: the parser called `has('--execute')`
 * while `has()` already prefixes `--`, so it searched for
 * `----execute`, never matched, and silently downgraded a production
 * apply to a listing. The migration would never run in production.
 *
 * Accepts both `--name=value` and `--name value`; shell quoting turns
 * the second form into two argv entries.
 */
export function parseD1Args(argv) {
	const [command, ...rest] = argv;
	const has = (name) => rest.includes(`--${name}`);
	const flag = (name) => {
		const inline = rest.find((a) => a.startsWith(`--${name}=`));
		if (inline) return inline.slice(name.length + 3);
		const i = rest.indexOf(`--${name}`);
		return i !== -1 ? rest[i + 1] : undefined;
	};
	return {
		command,
		rest,
		target: flag('target') ?? 'local',
		// `has()` already prefixes `--`; passing the dashed name here
		// searched for `----execute` and never matched.
		execute: has('execute'),
		sql: flag('sql'),
	};
}

/** CLI entrypoint. Guarded so `parseD1Args` is importable in tests. */
function main() {
	const { command, target, execute, sql } = parseD1Args(process.argv.slice(2));

	try {
		if (command === 'list') {
			console.log(JSON.stringify(listMigrations({ target }), null, 2));
		} else if (command === 'apply') {
			const result = applyMigrations({ target, execute });
			console.log(
				result.applied
					? `[d1] migrations applied (${target})`
					: `[d1] dry run — nothing applied. Pending migrations for ${target}:`,
			);
			console.log(JSON.stringify(result.output ?? result.pending, null, 2));
			if (target === 'production' && !execute) {
				console.log('[d1] production apply requires --execute; re-run with it to write.');
			}
		} else if (command === 'query') {
			if (!sql) throw new Error('--sql is required for query');
			console.log(JSON.stringify(queryRows(sql, { target }), null, 2));
		} else {
			throw new Error(
				'usage: d1.mjs <list|apply|query> [--target=local|production] [--execute] [--sql=...]',
			);
		}
	} catch (error) {
		console.error(`[d1] ${error?.message ?? error}`);
		process.exit(1);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
