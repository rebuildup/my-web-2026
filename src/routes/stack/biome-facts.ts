import type { StackFactRow } from './stack';

/**
 * `biome.json` → the settings rows the `/stack` Biome section
 * renders (Issue #382).
 *
 * Same contract as `profile-stack.ts`: this reader understands
 * exactly the shape the committed `biome.json` declares and nothing
 * more. It is deliberately narrow — no JSON-Schema validation, no
 * Biome API — because the page's claim is "these are the values the
 * file declares", not "this file is valid Biome config" (Biome
 * itself is the validator; `format:check` / `lint:check` fail on an
 * invalid config long before this page renders).
 *
 * Fail-closed: unparseable JSON, a non-object root, or a config with
 * none of the keys this page reports yields `null`, and the loader
 * then resolves the item's `facts` reference to nothing — the page
 * renders no table rather than guessed values.
 */

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

/** `tab` / `100` / `"all"` — the display form of one declared value. */
const scalar = (value: unknown): string =>
	typeof value === 'string' ? value : JSON.stringify(value);

const push = (
	rows: StackFactRow[],
	label: string,
	source: Record<string, unknown> | undefined,
	key: string,
): void => {
	const value = source?.[key];
	if (value === undefined) return;
	rows.push({ label, value: scalar(value) });
};

/**
 * Extract the formatter / linter rows `biome.json` declares.
 *
 * @param biomeJsonText raw `biome.json` contents
 * @returns labelled rows in declaration order, or `null` when the
 *   file yields nothing this page can honestly report
 */
export function extractBiomeSettings(biomeJsonText: string): readonly StackFactRow[] | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(biomeJsonText);
	} catch {
		return null;
	}
	const root = asRecord(parsed);
	if (root === undefined) return null;

	const formatter = asRecord(root.formatter);
	const jsFormatter = asRecord(asRecord(root.javascript)?.formatter);
	const linter = asRecord(root.linter);
	const linterRules = asRecord(linter?.rules);
	const organizeImports = asRecord(root.organizeImports);

	const rows: StackFactRow[] = [];

	// `formatter.*` — the shape every formatted file takes.
	push(rows, 'formatter.enabled', formatter, 'enabled');
	push(rows, 'formatter.indentStyle', formatter, 'indentStyle');
	push(rows, 'formatter.indentWidth', formatter, 'indentWidth');
	push(rows, 'formatter.lineWidth', formatter, 'lineWidth');
	push(rows, 'formatter.lineEnding', formatter, 'lineEnding');

	// `javascript.formatter.*` — language-level overrides.
	if (jsFormatter !== undefined) {
		for (const key of [
			'quoteStyle',
			'jsxQuoteStyle',
			'semicolons',
			'trailingCommas',
			'arrowParentheses',
		] as const) {
			push(rows, `javascript.formatter.${key}`, jsFormatter, key);
		}
	}

	push(rows, 'organizeImports.enabled', organizeImports, 'enabled');

	// `linter.*` — enabled flag, the recommended baseline, then every
	// declared rule override as `linter.rules.<group>.<rule>`.
	push(rows, 'linter.enabled', linter, 'enabled');
	if (linterRules !== undefined) {
		for (const [group, setting] of Object.entries(linterRules)) {
			const groupRecord = asRecord(setting);
			if (groupRecord === undefined) {
				// `recommended: true` sits directly under `rules`.
				rows.push({ label: `linter.rules.${group}`, value: scalar(setting) });
				continue;
			}
			for (const [rule, severity] of Object.entries(groupRecord)) {
				rows.push({ label: `linter.rules.${group}.${rule}`, value: scalar(severity) });
			}
		}
	}

	return rows.length > 0 ? rows : null;
}
