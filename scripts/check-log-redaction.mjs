#!/usr/bin/env node

/**
 * Log-redaction gate (Issue #467).
 *
 * Why this gate exists
 * --------------------
 * Redaction is only a property of the code that *uses* it. The
 * failure mode is a future log call — `console.error('[x]', err)`,
 * `console.log(result)` — that nobody routes through
 * `src/logging/`. Nothing in the type system stops that, and the
 * next audit is months away.
 *
 * So the rule is structural: **`src/**` may not call `console.*`
 * anywhere except `src/logging/`**. Every runtime record therefore
 * passes through `redactLogValue` by construction, and the redaction
 * contract has exactly one implementation.
 *
 * The second rule covers the operator-tooling surface
 * (`scripts/**`, AGENTS.md §4). Those scripts do not import
 * `src/logging/**` — they must stay runnable without a Worker
 * bundle — so their value-handling contract is checked statically
 * instead: an output call (`console.*`, `process.stdout.write`,
 * `process.stderr.write`) may not receive an expression that *reads*
 * a secret-named binding or field. A secret NAME printed in a
 * message (the whole point of the status-only contract, see
 * `docs/runbook/infisical-secrets.md`) is allowed; a secret VALUE
 * printed through any path is not.
 *
 * Scope boundaries (deliberate):
 *   - `*.test.*` / `*.stories.*` are exempt on the `src/**` side:
 *     they assert *on* console output, so calling console is the
 *     point. Test fixtures are repo-controlled, never real values.
 *   - `src/logging/logger.ts` is exempt because it IS the logging
 *     surface. The exemption is that one file, not the directory: a
 *     new `src/logging/raw.ts` that logs unredacted must still fail,
 *     or the "leaf obligation" would grow a second, ungated exit.
 *   - Third-party code (`external/**`, `node_modules/**`) is out of
 *     scope: the gate is about obligations this repository owns.
 *
 * Known limits (documented in `docs/security/log-redaction.md`):
 * this is a static read of the text, so a computed call
 * (`console['error'](x)`, `const c = console; c.error(x)`) does not
 * match. Type checking and review remain the backstop for those.
 *
 * Exit codes: 0 = clean, 1 = at least one violation, 2 = bad input.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_ROOT = join(ROOT, 'src');
const SCRIPTS_ROOT = join(ROOT, 'scripts');
const LOGGING_OWNER = join(SRC_ROOT, 'logging');
/** The one file allowed to touch `console` (AGENTS.md §3). */
const LOGGING_LOGGER = join(LOGGING_OWNER, 'logger.ts');

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

/** Console methods a runtime log call may use. */
const CONSOLE_METHOD_PATTERN = /\bconsole\s*\.\s*([A-Za-z]+)\s*\(/g;

/** Output sinks an operator script may print to. */
const OUTPUT_SINK_PATTERN =
	/\b(?:console\s*\.\s*[A-Za-z]+|process\s*\.\s*(?:stdout|stderr)\s*\.\s*write)\s*\(/g;

/**
 * Identifiers that hold a secret VALUE, matched as WHOLE
 * identifiers in the code an output call evaluates.
 *
 * Why a whole-identifier list instead of a substring pattern: the
 * status-only contract of the operator scripts is to print secret
 * NAMES (`REQUIRED_RUNTIME_SECRETS`, `SECRET_NAME`,
 * `Object.keys(secrets).length`) — see
 * `docs/runbook/infisical-secrets.md`. A substring rule would flag
 * every one of those and the gate would be switched off. A value
 * variable is named like a value: `secret`, `clientSecret`,
 * `bearer`, or a runtime secret binding read from the environment.
 */
const SECRET_VALUE_IDENTIFIERS = new Set(
	[
		// Generic value-shaped names.
		'secret',
		'secrets',
		'secretvalue',
		'secretvalues',
		'secretsjson',
		'secretpayload',
		'token',
		'tokens',
		'password',
		'passwords',
		'passwd',
		'apikey',
		'apikeys',
		'credential',
		'credentials',
		'clientsecret',
		'bearer',
		'bearertoken',
		'authsecret',
		'plaintext',
		'cleartext',
		// Runtime secret bindings (names declared in
		// `scripts/_cloudflare-contract.mjs` + the Infisical auth
		// helpers). Reading one of these IS reading a value.
		'BETTER_AUTH_SECRET',
		'BETTER_AUTH_SECRETS',
		'MY_WEB_2026_CONSUMER_API_KEY',
		'CLOUDFLARE_API_TOKEN',
		'INFISICAL_CLIENT_SECRET',
		'INFISICAL_TOKEN',
	].map((name) => name.toLowerCase()),
);

/**
 * Member reads that yield a secret value regardless of the variable
 * name (e.g. an Infisical API response field, a wrangler listing).
 */
const SECRET_VALUE_MEMBER_PATTERN =
	/\.\s*(?:secretValue|secret_value|secretKey|secret_key|apiKeyValue|api_key_value|tokenValue|token_value|passwordValue|password_value|clientSecret)\b/i;

/**
 * Prints of a secret value that the repository DELIBERATELY performs.
 *
 * Each entry is an owner decision with a stated reason, so an
 * exception is reviewed as prose rather than slipped in as a glob.
 * Adding an entry means accepting the exposure in review; the
 * marker-based `node --test` suites for the script still assert the
 * value reaches no other sink.
 */
const ALLOWED_SECRET_VALUE_PRINTS = [
	{
		file: 'scripts/bootstrap-home-api-key.mjs',
		identifier: 'plaintext',
		reason:
			'One-shot bootstrap display: the script MINTS the key, so the plaintext has no prior safe copy to be copied from. It is printed once, on stdout, before the process exits (see the comment above the call), and the script never re-reads or re-prints it. Issue #46 made the seeded `.dev.vars` the only other place it appears.',
	},
];

/** True when a denied identifier is an accepted exception for `file`. */
function isAllowedIdentifier(file, identifier) {
	return ALLOWED_SECRET_VALUE_PRINTS.some(
		(entry) => entry.file === file && entry.identifier.toLowerCase() === identifier.toLowerCase(),
	);
}

const TEST_FILE_PATTERN = /\.(?:test|spec|client\.test)\.[a-z]+$|\.stories\.[tj]sx?$/;

function isSourceFile(name) {
	return SOURCE_EXTENSIONS.includes(extname(name));
}

function sourceFilesUnder(directory) {
	let entries;
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries.flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourceFilesUnder(path);
		if (entry.isFile() && isSourceFile(entry.name)) return [path];
		return [];
	});
}

/** 1-based line number of `index` inside `source`. */
function lineOf(source, index) {
	let line = 1;
	for (let i = 0; i < index && i < source.length; i += 1) {
		if (source[i] === '\n') line += 1;
	}
	return line;
}

/**
 * Extract the balanced argument list of the call that opens at
 * `openIndex` (the index of the opening `(`). Returns the raw text
 * between the parentheses, or `null` when the call is unbalanced
 * (a syntax error is biome's problem, not this gate's).
 */
function callArguments(source, openIndex) {
	let depth = 0;
	let quote = null;
	for (let i = openIndex; i < source.length; i += 1) {
		const ch = source[i];
		if (quote) {
			if (ch === '\\') {
				i += 1;
				continue;
			}
			if (ch === quote) quote = null;
			continue;
		}
		if (ch === "'" || ch === '"' || ch === '`') {
			quote = ch;
			continue;
		}
		if (ch === '(') depth += 1;
		else if (ch === ')') {
			depth -= 1;
			if (depth === 0) return source.slice(openIndex + 1, i);
		}
	}
	return null;
}

/**
 * Reduce an argument list to the code it actually evaluates: quoted
 * string bodies are removed (a message may name a secret), while the
 * `${…}` expressions of a template literal are kept (a message may
 * also interpolate one).
 */
function evaluatedCode(argumentText) {
	let out = '';
	// 'plain' | 'single' | 'double' | 'template' | 'expression'
	let state = 'plain';
	let braceDepth = 0;
	for (let i = 0; i < argumentText.length; i += 1) {
		const ch = argumentText[i];
		const next = argumentText[i + 1];
		if (state === 'single' || state === 'double') {
			if (ch === '\\') {
				i += 1;
				continue;
			}
			if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"')) {
				state = 'plain';
			}
			continue;
		}
		if (state === 'template') {
			if (ch === '\\') {
				i += 1;
				continue;
			}
			if (ch === '`') {
				state = 'plain';
				continue;
			}
			if (ch === '$' && next === '{') {
				state = 'expression';
				braceDepth = 1;
				out += ' ${';
				i += 1;
				continue;
			}
			continue;
		}
		if (state === 'expression') {
			// A nested string inside `${…}` is still a string: its
			// body is message text, not an evaluated value.
			if (ch === "'" || ch === '"') {
				state = ch === "'" ? 'single' : 'double';
				continue;
			}
			if (ch === '{') braceDepth += 1;
			if (ch === '}') {
				braceDepth -= 1;
				if (braceDepth === 0) {
					state = 'template';
					out += '}';
					continue;
				}
			}
			out += ch;
			continue;
		}
		if (ch === "'") {
			state = 'single';
			continue;
		}
		if (ch === '"') {
			state = 'double';
			continue;
		}
		if (ch === '`') {
			state = 'template';
			braceDepth = 0;
			continue;
		}
		out += ch;
	}
	return out;
}

/**
 * Count-shaped reads (`Object.keys(secrets).length`, `Object.entries(x)`)
 * describe HOW MANY secrets exist — the documented status-only output —
 * so they are neutralised before the identifier scan.
 */
function stripCountShapedReads(code) {
	return code
		.replace(/\bObject\s*\.\s*(?:keys|entries)\s*\(\s*[A-Za-z_$][A-Za-z0-9_$]*/g, 'countOf')
		.replace(/\.[A-Za-z_$][A-Za-z0-9_$]*\s*\.\s*(?:keys|entries)\s*\(\s*\)/g, '.count')
		.replace(/\.\s*length\b/g, '.count');
}

/**
 * The denied identifiers the code actually reads, minus the entries an
 * owner has explicitly accepted for this file.
 */
function deniedIdentifiers(file, code) {
	const relativeFile = relative(ROOT, file);
	return identifiersIn(stripCountShapedReads(code)).filter(
		(identifier) =>
			SECRET_VALUE_IDENTIFIERS.has(identifier.toLowerCase()) &&
			!isAllowedIdentifier(relativeFile, identifier),
	);
}

/** True when the code an output call evaluates reads a secret value. */
function evaluatesSecretValue(file, code) {
	if (SECRET_VALUE_MEMBER_PATTERN.test(code)) return true;
	return deniedIdentifiers(file, code).length > 0;
}

function identifiersIn(code) {
	return code.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [];
}

/** Collect `{ line, detail }` violations for one file's output calls. */
function inspectOutputCalls({ file, source, pattern, rule, secretNameOnly }) {
	const violations = [];
	pattern.lastIndex = 0;
	for (const match of source.matchAll(pattern)) {
		const sink = match[1] ?? match[0];
		const openIndex = match.index + match[0].lastIndexOf('(');
		const args = callArguments(source, openIndex);
		if (args === null) continue;
		const code = secretNameOnly ? evaluatedCode(args) : args;
		if (!evaluatesSecretValue(file, code)) continue;
		const line = lineOf(source, match.index);
		violations.push({
			file,
			line,
			rule,
			detail: `console/output sink \`${sink.trim()}\` evaluates a secret-named value`,
		});
	}
	return violations;
}

function checkRuntimeLogs() {
	const violations = [];
	for (const file of sourceFilesUnder(SRC_ROOT)) {
		if (file === LOGGING_LOGGER) continue;
		if (TEST_FILE_PATTERN.test(file)) continue;
		const source = readFileSync(file, 'utf8');
		CONSOLE_METHOD_PATTERN.lastIndex = 0;
		for (const match of source.matchAll(CONSOLE_METHOD_PATTERN)) {
			violations.push({
				file,
				line: lineOf(source, match.index),
				rule: 'runtime-console',
				detail: `console.${match[1]} bypasses src/logging (use createAuditLogger)`,
			});
		}
	}
	return violations;
}

function checkOperatorScripts() {
	const violations = [];
	for (const file of sourceFilesUnder(SCRIPTS_ROOT)) {
		if (TEST_FILE_PATTERN.test(file)) continue;
		const source = readFileSync(file, 'utf8');
		violations.push(
			...inspectOutputCalls({
				file,
				source,
				pattern: OUTPUT_SINK_PATTERN,
				rule: 'operator-output',
				secretNameOnly: true,
			}),
		);
	}
	return violations;
}

function main(argv) {
	if (argv.includes('--help') || argv.includes('-h')) {
		process.stdout.write(
			'Usage: check-log-redaction.mjs\n\n' +
				'Issue #467 — fails when src/** calls console.* outside src/logging/logger.ts, or when\n' +
				'scripts/** prints a secret-named value.\n',
		);
		return 0;
	}

	let violations = [];
	try {
		statSync(SRC_ROOT);
		statSync(SCRIPTS_ROOT);
	} catch (error) {
		process.stderr.write(`[log-redaction:check] cannot inspect the repo tree: ${error.message}\n`);
		return 2;
	}
	violations = [...checkRuntimeLogs(), ...checkOperatorScripts()];

	if (violations.length === 0) {
		process.stdout.write(
			'log redaction OK: src/** logs only through src/logging/logger.ts, scripts/** prints no secret value\n',
		);
		return 0;
	}

	process.stderr.write('[log-redaction:check] log surface can leak a value:\n');
	for (const violation of violations) {
		process.stderr.write(
			`- ${relative(ROOT, violation.file)}:${violation.line} [${violation.rule}] ${violation.detail}\n`,
		);
	}
	process.stderr.write(
		'\nRuntime logs must go through `createAuditLogger` (src/logging/logger.ts), which\n' +
			'redacts every argument. Operator scripts must print status-only output — a\n' +
			'name is fine, a value is not (AGENTS.md §4).\n',
	);
	return 1;
}

process.exit(main(process.argv.slice(2)));
