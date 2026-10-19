/**
 * The ordered quality-gate plan, read from `quality/profile.yaml`
 * (Issue #566).
 *
 * Why this module exists
 * ----------------------
 * `package.json#scripts["validate:fast"]` used to be ONE line of
 * `&&`-joined commands. Adding a gate meant rewriting that entire
 * line, so every ticket PR that added a gate collided with every other
 * ticket PR that added a gate: in a trial merge of 20 parallel ticket
 * PRs, 17 of them conflicted on that one line.
 *
 * A gate roster is therefore declared ONE COMMAND PER LINE in
 * `quality/profile.yaml#gates.<name>.components` and executed by
 * `scripts/run-quality-gates.mjs`, so adding a gate is an appended
 * line in a reviewable list instead of a rewrite of a chain.
 *
 * This module is pure (parse -> validate -> resolve) so the plan can be
 * asserted from `scripts/_quality-gate-plan.test.mjs` without running a
 * single gate. It deliberately implements only the `gates:` block of
 * the profile and FAILS CLOSED on anything it does not understand: a
 * silently truncated gate list is the failure mode this file exists to
 * prevent.
 *
 * Contract notes
 * --------------
 * - `gates.<name>.components` is a list of single commands, in
 *   execution order. A shell operator (`&&`, `&`, `|`, `;`), a command
 *   substitution (`` ` `` or `$(`) or a newline inside one entry is
 *   rejected, so one line stays one reviewable step and a component
 *   cannot be backgrounded or silently rewritten by the shell.
 * - A bare `fast` / `integration` / `release` entry expands that gate's
 *   own components in place (composition, not reference-by-name
 *   indirection), which is what keeps `validate:release` a strict
 *   superset of `validate:integration`.
 * - Duplicates are preserved, not de-duplicated: the integration gate
 *   re-runs `build:cf:production` and `cloudflare:contract:check:build`
 *   on purpose (Storybook destroys the Build Output).
 * - Every `pnpm run <script>` component must name a script that exists
 *   in `package.json`, so a renamed script fails the plan instead of
 *   failing 20 steps later with a shell error.
 */

/** The three deterministic entry points (AGENTS.md section 5). */
export const GATE_NAMES = ['fast', 'integration', 'release'];

/** Repository-relative path of the declaration this module reads. */
export const PROFILE_RELATIVE_PATH = 'quality/profile.yaml';

/** Scalar keys allowed next to `components:` inside one gate. */
const GATE_META_KEYS = new Set(['command', 'cost_class', 'trigger']);

/** `pnpm run <script>` with optional trailing arguments. */
const PNPM_RUN = /^pnpm run ([A-Za-z0-9:._-]+)(?:\s|$)/;

function fail(line, message) {
	return new Error(`${PROFILE_RELATIVE_PATH}:${line}: ${message}`);
}

/**
 * Read one YAML scalar of the shape this profile uses: a single-quoted
 * or double-quoted string (with `''` as an escaped apostrophe), or a
 * bare token with an optional `# comment` tail.
 */
function readScalar(raw, line) {
	const text = raw.trim();
	if (text === '') throw fail(line, 'empty value');

	const quote = text[0];
	if (quote === "'" || quote === '"') {
		let value = '';
		for (let index = 1; index < text.length; index += 1) {
			const char = text[index];
			if (char === '\\' && quote === '"' && index + 1 < text.length) {
				value += text[index + 1];
				index += 1;
				continue;
			}
			if (char === quote) {
				if (quote === "'" && text[index + 1] === "'") {
					value += "'";
					index += 1;
					continue;
				}
				const trailing = text.slice(index + 1).trim();
				if (trailing !== '' && !trailing.startsWith('#')) {
					throw fail(line, `unexpected text after a quoted value: ${trailing}`);
				}
				if (value === '') throw fail(line, 'quoted value is empty');
				return value;
			}
			value += char;
		}
		throw fail(line, 'unterminated quoted value');
	}

	const commentAt = text.search(/\s#/);
	const bare = (commentAt === -1 ? text : text.slice(0, commentAt)).trim();
	if (bare === '') throw fail(line, 'value is only a comment');
	return bare;
}

/**
 * Parse the `gates:` block of the profile.
 *
 * Returns `{ gates: { fast: { command, components, cost_class, trigger }, ... } }`.
 * Throws on anything outside the subset it understands.
 */
export function parseGateProfile(text) {
	const gates = {};
	let inGates = false;
	let currentGate = null;
	let readingComponents = false;

	text.split(/\r?\n/).forEach((rawLine, offset) => {
		const line = offset + 1;
		if (rawLine.includes('\t')) throw fail(line, 'tab indentation (YAML forbids tabs)');
		const trimmed = rawLine.trim();
		if (trimmed === '' || trimmed.startsWith('#')) return;

		const indent = rawLine.length - rawLine.trimStart().length;
		if (indent === 0) {
			inGates = trimmed === 'gates:';
			currentGate = null;
			readingComponents = false;
			return;
		}
		if (!inGates) return;
		if (currentGate === null && indent !== 2) {
			throw fail(line, 'entry inside `gates:` outside a gate (expected a gate name at indent 2)');
		}

		if (indent === 2) {
			const name = /^([A-Za-z0-9_-]+):$/.exec(trimmed);
			if (!name) throw fail(line, `unsupported gate entry: ${trimmed}`);
			if (!GATE_NAMES.includes(name[1])) {
				throw fail(line, `unknown gate "${name[1]}" (expected one of ${GATE_NAMES.join(', ')})`);
			}
			currentGate = name[1];
			readingComponents = false;
			gates[currentGate] = { command: null, components: [] };
			return;
		}

		if (indent === 4) {
			const entry = /^([A-Za-z0-9_-]+):(?:\s*(.*))?$/.exec(trimmed);
			if (!entry) throw fail(line, `unsupported entry in gates.${currentGate}: ${trimmed}`);
			const [, key, rest = ''] = entry;
			if (key === 'components') {
				if (rest.trim() !== '') throw fail(line, '`components:` must be followed by a list');
				readingComponents = true;
			} else {
				if (!GATE_META_KEYS.has(key)) {
					throw fail(
						line,
						`unsupported key "${key}" in gates.${currentGate} (expected components, command, cost_class or trigger)`,
					);
				}
				gates[currentGate][key] = readScalar(rest, line);
				readingComponents = false;
			}
			return;
		}

		if (indent === 6 && readingComponents) {
			if (!trimmed.startsWith('- '))
				throw fail(line, `expected a "- <command>" list item: ${trimmed}`);
			gates[currentGate].components.push(readScalar(trimmed.slice(2), line));
			return;
		}

		throw fail(line, `unsupported structure inside gates.${currentGate} (indent ${indent})`);
	});

	for (const name of GATE_NAMES) {
		const gate = gates[name];
		if (!gate) throw new Error(`${PROFILE_RELATIVE_PATH}: gates.${name} is missing`);
		if (typeof gate.command !== 'string') {
			throw new Error(`${PROFILE_RELATIVE_PATH}: gates.${name}.command is missing`);
		}
		if (gate.components.length === 0) {
			throw new Error(`${PROFILE_RELATIVE_PATH}: gates.${name}.components is empty`);
		}
	}

	return { gates };
}

/**
 * Expand a gate into the flat, ordered list of commands it runs.
 *
 * A bare gate name expands in place, recursively; a repeated component
 * stays repeated. Order is the order written in the profile.
 */
export function resolveGatePlan(gates, gateName) {
	const plan = [];
	const walk = (name, stack) => {
		if (stack.includes(name)) {
			throw new Error(`gate composition cycle: ${[...stack, name].join(' -> ')}`);
		}
		const gate = gates[name];
		if (!gate) {
			throw new Error(`unknown gate "${name}" (expected one of ${GATE_NAMES.join(', ')})`);
		}
		for (const component of gate.components) {
			if (GATE_NAMES.includes(component)) {
				walk(component, [...stack, name]);
				continue;
			}
			plan.push(component);
		}
	};
	walk(gateName, []);
	return plan;
}

/**
 * Structural problems with a resolved plan.
 *
 * - one list entry must be exactly one command (no shell operators), so
 *   the roster stays one reviewable line per gate;
 * - every `pnpm run <script>` must name a script that exists.
 */
export function validateGateComponents(components, scriptNames) {
	const known = new Set(scriptNames);
	const problems = [];
	for (const component of components) {
		if (/(&&|&|\|\||;|\||\n|\r|`|\$\()/.test(component)) {
			problems.push(`one line must be one command: ${component}`);
			continue;
		}
		const match = PNPM_RUN.exec(component);
		if (match && !known.has(match[1])) {
			problems.push(`no such npm script: pnpm run ${match[1]} (in "${component}")`);
		}
	}
	return problems;
}

/** The npm script names a package declares. */
export function scriptNamesOf(pkg) {
	return Object.keys(pkg?.scripts ?? {});
}

/**
 * Resolve + validate one gate for one package manifest.
 *
 * Returns `{ plan, problems }`; `problems` is non-empty when the plan
 * cannot be run as written (an unknown gate, a cycle, a missing script).
 */
export function planForGate({ profileText, packageJsonText, gateName }) {
	const { gates } = parseGateProfile(profileText);
	const pkg = JSON.parse(packageJsonText);
	const plan = resolveGatePlan(gates, gateName);
	return { plan, problems: validateGateComponents(plan, scriptNamesOf(pkg)) };
}
