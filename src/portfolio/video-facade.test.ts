import { describe, expect, it } from 'vitest';
import type { PortfolioLink } from './schema';
import { composeVideoEmbedUrl, parseYouTubeVideoId, selectPortfolioVideo } from './video-facade';

/**
 * The YouTube facade contract (Issue #870).
 *
 * These cases exist because a stored link is UNTRUSTED input: it came
 * from a legacy SQLite file, through a seed script, into D1. The
 * module's job is to prove it understood the URL before the page
 * builds a frame from it, so the interesting cases are the refusals.
 */

const ID = 'SewXH0Bbm-c';

describe('parseYouTubeVideoId', () => {
	it.each([
		['watch on www', 'https://www.youtube.com/watch?v=SewXH0Bbm-c'],
		['watch on the apex', 'https://youtube.com/watch?v=SewXH0Bbm-c'],
		['watch on m', 'https://m.youtube.com/watch?v=SewXH0Bbm-c'],
		['watch with extra parameters', 'https://www.youtube.com/watch?list=PL123&v=SewXH0Bbm-c&t=42'],
		['short link', 'https://youtu.be/SewXH0Bbm-c'],
		['short link with a timestamp', 'https://youtu.be/SewXH0Bbm-c?t=30'],
		['embed url', 'https://www.youtube.com/embed/SewXH0Bbm-c'],
		['privacy-preserving embed url', 'https://www.youtube-nocookie.com/embed/SewXH0Bbm-c'],
		['http scheme', 'http://youtu.be/SewXH0Bbm-c'],
		['surrounding whitespace', '   https://youtu.be/SewXH0Bbm-c  '],
	])('accepts %s', (_label, url) => {
		expect(parseYouTubeVideoId(url)).toBe(ID);
	});

	it.each([
		['a ten-character id', 'https://youtu.be/SewXH0Bbm'],
		['a twelve-character id', 'https://youtu.be/SewXH0Bbm-cX'],
		['a non-id character', 'https://youtu.be/SewXH0Bbm.c'],
		['a path after the id', 'https://youtu.be/SewXH0Bbm-c/extra'],
		['shorts', 'https://www.youtube.com/shorts/SewXH0Bbm-c'],
		['live', 'https://www.youtube.com/live/SewXH0Bbm-c'],
		['a playlist', 'https://www.youtube.com/playlist?list=PL123'],
		['a channel', 'https://www.youtube.com/@someone'],
		['a watch url without v', 'https://www.youtube.com/watch'],
		['a lookalike host', 'https://youtube.com.example.test/watch?v=SewXH0Bbm-c'],
		['a prefixed lookalike host', 'https://evilyoutu.be/SewXH0Bbm-c'],
		['a suffixed lookalike host', 'https://notyoutube.com/watch?v=SewXH0Bbm-c'],
		['an unlisted subdomain', 'https://cdn.youtube.com/watch?v=SewXH0Bbm-c'],
		['a javascript scheme', 'javascript:alert(1)'],
		['a data scheme', 'data:text/html,<iframe>'],
		['a relative path', '/watch?v=SewXH0Bbm-c'],
		['a bare query', 'v=SewXH0Bbm-c'],
		['an empty string', ''],
		['only whitespace', '   '],
	])('refuses %s', (_label, url) => {
		expect(parseYouTubeVideoId(url)).toBeNull();
	});

	it('refuses a non-string at runtime', () => {
		// A D1 row can contain a value the TypeScript type does not
		// describe; the parser must not throw on it.
		expect(parseYouTubeVideoId(null as unknown as string)).toBeNull();
		expect(parseYouTubeVideoId(42 as unknown as string)).toBeNull();
	});
});

describe('compose URLs', () => {
	it('builds the embed URL on the privacy-preserving origin', () => {
		expect(composeVideoEmbedUrl(ID)).toBe(`https://www.youtube-nocookie.com/embed/${ID}`);
	});
});

describe('selectPortfolioVideo', () => {
	const link = (overrides: Partial<PortfolioLink>): PortfolioLink => ({
		id: 'l1',
		kind: 'video',
		label: null,
		url: 'https://youtu.be/SewXH0Bbm-c',
		displayOrder: 0,
		...overrides,
	});

	it('returns a facade for the first valid video link', () => {
		const result = selectPortfolioVideo([link({})]);
		expect(result).toEqual({
			id: ID,
			link: link({}),
			embedUrl: `https://www.youtube-nocookie.com/embed/${ID}`,
		});
	});

	it('skips non-video kinds', () => {
		expect(
			selectPortfolioVideo([
				link({ kind: 'repo', url: 'https://github.com/rebuildup/Aulymo_v03' }),
				link({ id: 'l2' }),
			])?.id,
		).toBe(ID);
	});

	it('skips a video row this repository cannot understand', () => {
		expect(selectPortfolioVideo([link({ url: 'https://vimeo.com/12345' })])).toBeNull();
		expect(
			selectPortfolioVideo([link({ url: 'https://www.youtube.com/shorts/SewXH0Bbm-c' })]),
		).toBeNull();
	});

	it('returns null when there is no video at all', () => {
		expect(selectPortfolioVideo([])).toBeNull();
	});
});
