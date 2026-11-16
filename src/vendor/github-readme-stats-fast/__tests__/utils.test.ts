/**
 * Tests for github-readme-stats-fast common utilities.
 */

import { describe, it, expect } from 'vitest';
import {
	parseBoolean,
	parseArray,
	clampValue,
	isValidHexColor,
	fallbackColor,
	kFormatter,
	encodeHTML,
	renderError,
	wrapTextMultiline,
	CustomError,
	MissingParamError,
	CONSTANTS,
} from '../common/utils.ts';
import { normalizeParams } from '../common/normalizeparam.ts';

describe('parseBoolean', () => {
	it('returns true for "true"', () => {
		expect(parseBoolean('true')).toBe(true);
	});
	it('returns false for "false"', () => {
		expect(parseBoolean('false')).toBe(false);
	});
	it('returns undefined for other strings', () => {
		expect(parseBoolean('yes')).toBeUndefined();
		expect(parseBoolean('')).toBeUndefined();
	});
	it('passes through boolean values', () => {
		expect(parseBoolean(true)).toBe(true);
		expect(parseBoolean(false)).toBe(false);
	});
	it('returns undefined for undefined', () => {
		expect(parseBoolean(undefined)).toBeUndefined();
	});
});

describe('parseArray', () => {
	it('splits comma-separated strings', () => {
		expect(parseArray('a,b,c')).toEqual(['a', 'b', 'c']);
	});
	it('returns empty array for empty string', () => {
		expect(parseArray('')).toEqual([]);
	});
	it('returns empty array for undefined', () => {
		expect(parseArray(undefined)).toEqual([]);
	});
	it('handles single item', () => {
		expect(parseArray('single')).toEqual(['single']);
	});
});

describe('clampValue', () => {
	it('clamps to minimum', () => {
		expect(clampValue(5, 10, 20)).toBe(10);
	});
	it('clamps to maximum', () => {
		expect(clampValue(25, 10, 20)).toBe(20);
	});
	it('returns value within range', () => {
		expect(clampValue(15, 10, 20)).toBe(15);
	});
	it('handles string numbers', () => {
		expect(clampValue('15', 10, 20)).toBe(15);
	});
	it('returns min for NaN', () => {
		expect(clampValue('abc', 10, 20)).toBe(10);
	});
});

describe('isValidHexColor', () => {
	it('validates 6-char hex', () => {
		expect(isValidHexColor('ffffff')).toBe(true);
		expect(isValidHexColor('FF0000')).toBe(true);
	});
	it('validates 3-char hex', () => {
		expect(isValidHexColor('fff')).toBe(true);
	});
	it('validates 8-char hex (with alpha)', () => {
		expect(isValidHexColor('ffffffff')).toBe(true);
	});
	it('rejects invalid hex', () => {
		expect(isValidHexColor('gggggg')).toBe(false);
		expect(isValidHexColor('fffgg')).toBe(false);
		expect(isValidHexColor('')).toBe(false);
	});
});

describe('fallbackColor', () => {
	it('returns user color when valid', () => {
		expect(fallbackColor('ff0000', '#000000')).toBe('#ff0000');
	});
	it('returns fallback when color invalid', () => {
		expect(fallbackColor('invalid', '#000000')).toBe('#000000');
	});
	it('handles gradients', () => {
		expect(fallbackColor('45,ff0000,00ff00', '#000000')).toEqual([
			'45',
			'ff0000',
			'00ff00',
		]);
	});
});

describe('kFormatter', () => {
	it('formats thousands with k', () => {
		expect(kFormatter(1500)).toBe('1.5k');
		expect(kFormatter(1000)).toBe('1k');
		expect(kFormatter(10000)).toBe('10k');
	});
	it('returns number for values < 1000', () => {
		expect(kFormatter(500)).toBe(500);
		expect(kFormatter(999)).toBe(999);
	});
	it('handles negative numbers', () => {
		expect(kFormatter(-1500)).toBe('-1.5k');
	});
});

describe('encodeHTML', () => {
	it('encodes special characters', () => {
		expect(encodeHTML('<script>')).toBe('&#60;script&#62;');
		expect(encodeHTML('&')).toBe('&#38;');
		expect(encodeHTML('"')).toBe('&#34;');
	});
	it('handles unicode', () => {
		expect(encodeHTML('日本語')).toContain('&#');
	});
});

describe('renderError', () => {
	it('returns SVG with error message', () => {
		const svg = renderError('Test error', 'Details', { theme: 'default' });
		expect(svg).toContain('<svg');
		expect(svg).toContain('Test error');
		expect(svg).toContain('Details');
	});
	it('includes theme colors', () => {
		const svg = renderError('Error', '', { title_color: 'ff0000', theme: 'default' });
		expect(svg).toContain('ff0000');
	});
});

describe('normalizeParams', () => {
	it('removes undefined and empty values', () => {
		const result = normalizeParams({
			a: '1',
			b: '',
			c: undefined,
			d: '2',
		});
		expect(result).toEqual({ a: '1', d: '2' });
	});
	it('sorts keys', () => {
		const result = normalizeParams({ z: '1', a: '2' });
		expect(Object.keys(result)).toEqual(['a', 'z']);
	});
	it('converts values to strings', () => {
		const result = normalizeParams({ a: 1, b: true, c: false });
		expect(result).toEqual({ a: '1', b: 'true', c: 'false' });
	});
});

describe('wrapTextMultiline', () => {
	it('wraps long text', () => {
		const lines = wrapTextMultiline('This is a very long text that should be wrapped', 10, 3);
		expect(lines.length).toBeLessThanOrEqual(3);
	});
	it('handles empty string', () => {
		expect(wrapTextMultiline('', 10, 3)).toEqual([]);
	});
	it('respects maxLines', () => {
		const lines = wrapTextMultiline('a b c d e f g h i j k l m n o p', 5, 2);
		expect(lines.length).toBeLessThanOrEqual(2);
	});
});

describe('CustomError', () => {
	it('creates error with type and secondary message', () => {
		const err = new CustomError('Test message', 'USER_NOT_FOUND');
		expect(err.message).toBe('Test message');
		expect(err.type).toBe('USER_NOT_FOUND');
		expect(err.secondaryMessage).toBe('Make sure the provided username is not an organization');
	});
	it('uses type as secondary message for unknown types', () => {
		const err = new CustomError('Test', 'UNKNOWN_TYPE');
		expect(err.secondaryMessage).toBe('UNKNOWN_TYPE');
	});
});

describe('MissingParamError', () => {
	it('creates error with missed params', () => {
		const err = new MissingParamError(['username', 'repo'], '/api/pin');
		expect(err.message).toContain('username');
		expect(err.message).toContain('repo');
		expect(err.missedParams).toEqual(['username', 'repo']);
		expect(err.secondaryMessage).toBe('/api/pin');
	});
});

describe('CONSTANTS', () => {
	it('has expected cache durations', () => {
		expect(CONSTANTS.CARD_CACHE_SECONDS).toBe(86400); // 1 day
		expect(CONSTANTS.TOP_LANGS_CACHE_SECONDS).toBe(518400); // 6 days
		expect(CONSTANTS.PIN_CARD_CACHE_SECONDS).toBe(864000); // 10 days
		expect(CONSTANTS.ERROR_CACHE_SECONDS).toBe(600); // 10 minutes
	});
});