import { describe, expect, it } from 'vitest';
import type { CurrentProjectRecord } from '../../home/current/types';
import { CURRENT_HEIGHT, CURRENT_WIDTH, renderCurrentSvg } from './current';

/**
 * In-progress card contract (Issue #1216): the README needs "what is
 * being worked on" after `/now` retires. The card renders the same
 * `currentProjectsLoader` records the site shows — declarations and
 * measured facts, never invented values.
 */

const RECORD: CurrentProjectRecord = {
	id: 'my-web-2026',
	name: 'my-web-2026',
	statusJa: '個人 Web Platform の再構築。',
	weight: {
		level: {
			value: 'primary',
			source: 'handwritten',
			observedOn: '2026-11-20',
		},
	},
};

describe('renderCurrentSvg', () => {
	it('renders a fixed-size SVG document', () => {
		const svg = renderCurrentSvg([RECORD], '2026-11-24');
		expect(svg).toContain(`width="${CURRENT_WIDTH}" height="${CURRENT_HEIGHT}"`);
		expect(svg).toContain('role="img"');
	});

	it('shows the project name, status line and weight level', () => {
		const svg = renderCurrentSvg([RECORD], '2026-11-24');
		expect(svg).toContain('my-web-2026');
		expect(svg).toContain('個人 Web Platform の再構築。');
		expect(svg).toContain('PRIMARY');
	});

	it('omits the weight chip when the owner wrote no level', () => {
		const svg = renderCurrentSvg([{ ...RECORD, weight: undefined }], '2026-11-24');
		expect(svg).not.toContain('PRIMARY');
	});

	it('renders an honest empty state', () => {
		const svg = renderCurrentSvg([], '2026-11-24');
		expect(svg).toContain('No projects published right now.');
	});

	it('caps the list and points at the site for the rest', () => {
		const many = Array.from({ length: 8 }, (_, i) => ({
			...RECORD,
			id: `p${i}`,
			name: `project-${i}`,
		}));
		const svg = renderCurrentSvg(many, '2026-11-24');
		expect(svg).toContain('project-4');
		expect(svg).not.toContain('project-5');
		expect(svg).toContain('+3 more on rebuildup.dev');
	});

	it('escapes markup inside owner-written strings', () => {
		const svg = renderCurrentSvg(
			[{ ...RECORD, name: '<script>', statusJa: 'a & b' }],
			'2026-11-24',
		);
		expect(svg).not.toContain('<script>');
		expect(svg).toContain('a &amp; b');
	});
});
