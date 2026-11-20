import { describe, expect, it } from 'vitest';
import biomeJsonRaw from '../../../biome.json?raw';
import { extractBiomeSettings } from './biome-facts';

/**
 * `biome.json` reader contract for the `/stack` Biome section
 * (Issue #382).
 *
 * The page's claim is "the table shows what `biome.json` declares".
 * These tests pin both halves: the committed file yields the real
 * values (read through the same `?raw` import the loader uses, so a
 * config change fails here before it can silently drift on the
 * page), and malformed input fails closed to `null` — never a
 * guessed row.
 */

const committedBiomeJson = biomeJsonRaw;

const rowValue = (rows: readonly { label: string; value: string }[], label: string) =>
	rows.find((row) => row.label === label)?.value;

describe('extractBiomeSettings over the committed biome.json', () => {
	const rows = extractBiomeSettings(committedBiomeJson);

	it('parses the committed file into rows', () => {
		expect(rows).not.toBeNull();
		expect(rows?.length).toBeGreaterThan(0);
	});

	it('reports the formatter contract the page claims', () => {
		expect(rowValue(rows ?? [], 'formatter.indentStyle')).toBe('tab');
		expect(rowValue(rows ?? [], 'formatter.lineWidth')).toBe('100');
		expect(rowValue(rows ?? [], 'formatter.lineEnding')).toBe('lf');
	});

	it('reports the JavaScript formatter overrides', () => {
		expect(rowValue(rows ?? [], 'javascript.formatter.quoteStyle')).toBe('single');
		expect(rowValue(rows ?? [], 'javascript.formatter.trailingCommas')).toBe('all');
		expect(rowValue(rows ?? [], 'javascript.formatter.semicolons')).toBe('always');
	});

	it('reports linter rules as dotted group.rule rows', () => {
		expect(rowValue(rows ?? [], 'linter.rules.recommended')).toBe('true');
		expect(rowValue(rows ?? [], 'linter.rules.suspicious.noExplicitAny')).toBe('warn');
		expect(rowValue(rows ?? [], 'linter.rules.complexity.noBannedTypes')).toBe('error');
	});
});

describe('extractBiomeSettings fail-closed', () => {
	it('returns null for unparseable JSON', () => {
		expect(extractBiomeSettings('{ not json')).toBeNull();
	});

	it('returns null for a non-object root', () => {
		expect(extractBiomeSettings('[1,2,3]')).toBeNull();
		expect(extractBiomeSettings('"biome"')).toBeNull();
	});

	it('returns null when none of the reported keys exist', () => {
		expect(extractBiomeSettings('{"vcs":{"enabled":true}}')).toBeNull();
	});

	it('omits keys the file does not declare instead of guessing', () => {
		const rows = extractBiomeSettings('{"formatter":{"lineWidth":80}}');
		expect(rows).toEqual([{ label: 'formatter.lineWidth', value: '80' }]);
	});
});
