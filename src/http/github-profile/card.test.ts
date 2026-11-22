import { describe, expect, it } from 'vitest';
import { CARD_HEIGHT, CARD_WIDTH, renderProfileCardSvg } from './card';
import type { ProfileCardModel } from './model';

/**
 * SVG composer contract (Issue #1170): deterministic output, escaped
 * text, real work images referenced, honest unavailable states, and
 * NO interactive elements — Camo proxies the bytes, so a link inside
 * the image cannot work and must not pretend to.
 */

const TINY_PNG =
	'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const BASE_MODEL: ProfileCardModel = {
	works: [
		{
			title: 'MultiSlicer',
			summary: 'After Effects plugin',
			media: [{ r2Key: 'portfolio/multislicer/cover.jpg', contentType: 'image/jpeg' }],
			alt: 'MultiSlicer cover',
			dataUri: TINY_PNG,
		},
	],
	github: {
		state: 'ok',
		publicRepos: 3,
		privateRepos: 2,
		windowDays: 7,
		latest: {
			repoId: 'rebuildup/tool-pomodoro',
			type: 'PullRequestEvent',
			at: '2026-11-22T04:00:00Z',
		},
		observedAt: '2026-11-22T05:00:00Z',
	},
	discord: {
		state: 'ok',
		statusLabel: 'Online',
		detail: 'Playing: After Effects — scene-b.aep',
		observedAt: '2026-11-22T06:10:00Z',
	},
	generatedAt: '2026-11-22T06:12:00.000Z',
};

describe('renderProfileCardSvg', () => {
	it('renders a fixed-size SVG document', () => {
		const svg = renderProfileCardSvg(BASE_MODEL);
		expect(svg).toContain(
			`<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}"`,
		);
		expect(svg).toContain('role="img"');
	});

	it('is deterministic for the same model', () => {
		expect(renderProfileCardSvg(BASE_MODEL)).toBe(renderProfileCardSvg(BASE_MODEL));
	});

	it('embeds work covers as data: URIs — never remote hrefs', () => {
		const svg = renderProfileCardSvg(BASE_MODEL);
		expect(svg).toContain(`href="${TINY_PNG}"`);
		expect(svg).toContain('MultiSlicer');
		// An <img>-loaded SVG cannot fetch external subresources.
		expect(svg).not.toMatch(/href="https?:\/\//);
	});

	it('renders a placeholder panel when a cover could not be embedded', () => {
		const svg = renderProfileCardSvg({
			...BASE_MODEL,
			works: [
				{
					title: 'MultiSlicer',
					summary: 'After Effects plugin',
					media: [{ r2Key: 'portfolio/multislicer/cover.jpg', contentType: 'image/jpeg' }],
					alt: 'MultiSlicer cover',
				},
			],
		});
		expect(svg).not.toContain('<image');
		expect(svg).toContain('MultiSlicer');
	});

	it('shows GitHub and Discord observations with their times', () => {
		const svg = renderProfileCardSvg(BASE_MODEL);
		expect(svg).toContain('GITHUB ACTIVITY');
		expect(svg).toContain('DISCORD');
		expect(svg).toContain('3 public · 2 private projects active');
		expect(svg).toContain('Online');
		expect(svg).toContain('observed');
	});

	it('renders honest unavailable states', () => {
		const svg = renderProfileCardSvg({
			...BASE_MODEL,
			github: { state: 'unavailable', publicRepos: 0, privateRepos: 0, windowDays: 0 },
			discord: { state: 'unavailable', observedAt: null },
		});
		expect(svg).toContain('No GitHub activity observed yet');
		expect(svg).toContain('Discord presence unavailable');
	});

	it('marks stale presence instead of claiming online', () => {
		const svg = renderProfileCardSvg({
			...BASE_MODEL,
			discord: { state: 'stale', observedAt: '2026-11-22T05:00:00Z' },
		});
		expect(svg).toContain('Presence stale');
		expect(svg).toContain('last seen');
	});

	it('escapes XML in every interpolated string', () => {
		const svg = renderProfileCardSvg({
			...BASE_MODEL,
			works: [
				{
					title: '<script>alert(1)</script>',
					summary: 'a & b <c>',
					media: [],
					alt: 'x',
					dataUri: 'data:image/png;base64,AAAA',
				},
			],
			discord: {
				state: 'ok',
				statusLabel: 'Online',
				detail: '<b>bold</b>',
				observedAt: '2026-11-22T06:10:00Z',
			},
		});
		expect(svg).not.toContain('<script>');
		expect(svg).toContain('&lt;script&gt;');
		expect(svg).toContain('&lt;b&gt;bold&lt;/b&gt;');
		expect(svg).toContain('a &amp; b &lt;c&gt;');
	});

	it('contains no interactive elements', () => {
		const svg = renderProfileCardSvg(BASE_MODEL);
		expect(svg).not.toMatch(/<a[\s>]/);
		expect(svg).not.toContain('<script');
		expect(svg).not.toContain('onclick');
	});
});
