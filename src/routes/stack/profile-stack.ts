/**
 * `quality/profile.yaml` `stack:` block reader (Issue #381).
 *
 * The quality profile declares the platform's stack contract as a
 * flat map under a top-level `stack:` key — one `name: value` pair
 * per line, two-space indent, no nesting. The `/stack` page shows
 * those declared values, so it reads them from the file itself
 * instead of restating them as literals that could drift.
 *
 * The parser is deliberately narrow: it understands exactly the
 * shape the profile's own gate (`scripts/_quality-gate-plan.mjs`)
 * already enforces for `gates.*`, applied to `stack.*`. A richer YAML
 * dependency is not added for one flat block; a shape this parser
 * does not recognise yields an empty map and the page renders the
 * affected entries as 未確定 rather than guessing.
 */

/**
 * Extract the `stack:` map from profile YAML text.
 *
 * @param yamlText raw `quality/profile.yaml` contents
 * @returns key → declared value (the text after `key:`, trimmed)
 */
export function parseProfileStack(yamlText: string): Readonly<Record<string, string>> {
	const lines = yamlText.split('\n');
	const stackIndex = lines.findIndex((line) => /^stack:\s*$/.test(line));
	if (stackIndex === -1) return {};

	const entries: Record<string, string> = {};
	for (let i = stackIndex + 1; i < lines.length; i += 1) {
		const line = lines[i];
		// The block ends at the first line that is not a two-space
		// indented `key: value` pair (a dedent, a blank line, a
		// comment, or EOF).
		const match = /^ {2}([A-Za-z_][A-Za-z0-9_]*):\s*(.+?)\s*$/.exec(line);
		if (!match) break;
		// Values may be single-quoted in the profile (e.g.
		// `worker_test: '@cloudflare/vitest-plugin@1.1.x'`).
		entries[match[1]] = match[2].replace(/^'(.*)'$/, '$1');
	}
	return entries;
}
