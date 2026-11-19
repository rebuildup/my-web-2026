import { describe, expect, it } from 'vitest';
import type { PortfolioLink, PortfolioMedia, PortfolioProject } from './schema';
import {
	DEFAULT_PORTFOLIO_VIEW,
	WIDE_TILE_ASPECT_RATIO,
	designTileFrameRatio,
	designTileSpan,
	effectivePortfolioFacets,
	hasPeriodLabel,
	hasRecordedRole,
	mediaAspectRatio,
	parsePortfolioView,
	projectAspectRatio,
	projectCover,
	projectVideo,
} from './views';

/**
 * Exhibition-view mapping rules (Issue #1048).
 *
 * The view contract is: `?view=` picks a presentation, and every
 * per-project decision inside that presentation is a pure function
 * of stored facts — cover media, the Issue #870 video facade gate,
 * intrinsic media size, `pinned`. These tests pin those rules so a
 * view can never invent a thumbnail, a playable video, or a span the
 * data does not support.
 */

const EPOCH = 1_700_000_000_000;

function makeMedia(overrides: Partial<PortfolioMedia> = {}): PortfolioMedia {
	return {
		id: 'm-1',
		r2Key: 'portfolio/demo/cover.webp',
		contentType: 'image/webp',
		width: 1600,
		height: 900,
		alt: 'cover',
		caption: null,
		isCover: true,
		displayOrder: 0,
		url: 'https://rebuildup.dev/media/portfolio/demo/cover.webp',
		...overrides,
	};
}

function makeLink(overrides: Partial<PortfolioLink> = {}): PortfolioLink {
	return {
		id: 'l-1',
		kind: 'repo',
		label: null,
		url: 'https://example.com',
		displayOrder: 0,
		...overrides,
	};
}

function makeProject(overrides: Partial<PortfolioProject> = {}): PortfolioProject {
	return {
		id: 'p-1',
		slug: 'demo',
		title: 'Demo',
		summary: 'summary',
		role: null,
		periodStart: EPOCH,
		periodEnd: null,
		periodLabel: null,
		motivationMd: '',
		architectureMd: null,
		constraintsMd: null,
		implementationMd: null,
		evidenceMd: null,
		retrospectiveMd: null,
		facets: ['develop'],
		technologies: [],
		visibility: 'public',
		status: 'published',
		evidenceStatus: 'reviewed',
		pinned: false,
		displayOrder: 0,
		createdAt: EPOCH,
		updatedAt: EPOCH,
		links: [],
		media: [],
		...overrides,
	};
}

describe('parsePortfolioView', () => {
	it('defaults to `all` for absent and unknown values', () => {
		expect(parsePortfolioView(undefined)).toBe(DEFAULT_PORTFOLIO_VIEW);
		expect(parsePortfolioView(null)).toBe('all');
		expect(parsePortfolioView('')).toBe('all');
		expect(parsePortfolioView('bogus')).toBe('all');
		expect(parsePortfolioView('DESIGN')).toBe('all');
	});

	it('accepts the three exhibition views', () => {
		expect(parsePortfolioView('develop')).toBe('develop');
		expect(parsePortfolioView('video')).toBe('video');
		expect(parsePortfolioView('design')).toBe('design');
	});
});

describe('effectivePortfolioFacets', () => {
	it('imposes each named view its predecessor gallery scope', () => {
		expect(effectivePortfolioFacets('develop', [])).toEqual(['develop']);
		expect(effectivePortfolioFacets('video', [])).toEqual(['video']);
		// `video&design` listed video OR design OR both — reproduced
		// as the any-of facet set {design, video}.
		expect(effectivePortfolioFacets('design', [])).toEqual(['design', 'video']);
	});

	it('leaves `all` unrestricted when no facets are chosen', () => {
		expect(effectivePortfolioFacets('all', [])).toEqual([]);
	});

	it('lets an explicit facet selection replace the implied scope', () => {
		expect(effectivePortfolioFacets('video', ['design'])).toEqual(['design']);
		expect(effectivePortfolioFacets('all', ['other'])).toEqual(['other']);
	});
});

describe('projectCover', () => {
	it('prefers the isCover row, then the first row, then null', () => {
		const first = makeMedia({ id: 'a', isCover: false });
		const cover = makeMedia({ id: 'b', isCover: true });
		expect(projectCover(makeProject({ media: [first, cover] }))?.id).toBe('b');
		expect(projectCover(makeProject({ media: [first] }))?.id).toBe('a');
		expect(projectCover(makeProject({ media: [] }))).toBeNull();
	});
});

describe('mediaAspectRatio / projectAspectRatio', () => {
	it('returns width/height only for positive integer sizes', () => {
		expect(mediaAspectRatio(makeMedia({ width: 1600, height: 900 }))).toBeCloseTo(16 / 9);
		expect(mediaAspectRatio(makeMedia({ width: null, height: 900 }))).toBeNull();
		expect(mediaAspectRatio(makeMedia({ width: 0, height: 900 }))).toBeNull();
		expect(mediaAspectRatio(makeMedia({ width: 100.5, height: 900 }))).toBeNull();
		expect(mediaAspectRatio(null)).toBeNull();
	});

	it('reads the ratio off the cover selection', () => {
		const project = makeProject({
			media: [
				makeMedia({ id: 'wide', width: 2000, height: 1000, isCover: true }),
				makeMedia({ id: 'other', width: 100, height: 100, isCover: false }),
			],
		});
		expect(projectAspectRatio(project)).toBeCloseTo(2);
	});
});

describe('designTileSpan', () => {
	it('spans two columns for pinned projects regardless of media', () => {
		expect(designTileSpan(makeProject({ pinned: true })).columnSpan).toBe(2);
		expect(designTileSpan(makeProject({ pinned: true, media: [] })).columnSpan).toBe(2);
	});

	it('spans two columns for wide covers at the documented threshold', () => {
		const wide = makeMedia({ width: 1600, height: 1000 }); // ratio 1.6
		const atThreshold = makeMedia({ width: 1500, height: 1000 }); // ratio 1.5
		const notWide = makeMedia({ width: 1400, height: 1000 }); // ratio 1.4
		expect(WIDE_TILE_ASPECT_RATIO).toBe(1.5);
		expect(designTileSpan(makeProject({ media: [wide] })).columnSpan).toBe(2);
		expect(designTileSpan(makeProject({ media: [atThreshold] })).columnSpan).toBe(2);
		expect(designTileSpan(makeProject({ media: [notWide] })).columnSpan).toBe(1);
	});

	it('keeps tall covers and media-less projects at one column', () => {
		const tall = makeMedia({ width: 800, height: 1200 });
		expect(designTileSpan(makeProject({ media: [tall] })).columnSpan).toBe(1);
		expect(designTileSpan(makeProject({ media: [] })).columnSpan).toBe(1);
		// Unknown intrinsic size cannot justify a span.
		expect(
			designTileSpan(makeProject({ media: [makeMedia({ width: null, height: null })] })).columnSpan,
		).toBe(1);
	});

	it('is deterministic — the same project always gets the same span', () => {
		const project = makeProject({ pinned: true, media: [makeMedia()] });
		expect(designTileSpan(project)).toEqual(designTileSpan(project));
	});
});

describe('designTileFrameRatio', () => {
	it('pairs one fixed ratio with each span', () => {
		expect(designTileFrameRatio({ columnSpan: 1 })).toBe('4 / 3');
		expect(designTileFrameRatio({ columnSpan: 2 })).toBe('2 / 1');
	});
});

describe('projectVideo', () => {
	it('returns a facade only for a validated YouTube video link', () => {
		const playable = makeProject({
			links: [
				makeLink({
					kind: 'video',
					url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
				}),
			],
		});
		const facade = projectVideo(playable);
		expect(facade?.id).toBe('dQw4w9WgXcQ');
		expect(facade?.embedUrl).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
	});

	it('refuses non-video links, unparseable URLs and missing links', () => {
		expect(
			projectVideo(
				makeProject({ links: [makeLink({ kind: 'repo', url: 'https://github.com/x/y' })] }),
			),
		).toBeNull();
		expect(
			projectVideo(
				makeProject({
					links: [makeLink({ kind: 'video', url: 'https://example.com/not-video' })],
				}),
			),
		).toBeNull();
		expect(projectVideo(makeProject({ links: [] }))).toBeNull();
	});
});

describe('role / period guards', () => {
	it('prints a role only when a real one is recorded', () => {
		expect(hasRecordedRole(makeProject({ role: 'Tool developer' }))).toBe(true);
		expect(hasRecordedRole(makeProject({ role: null }))).toBe(false);
		expect(hasRecordedRole(makeProject({ role: '   ' }))).toBe(false);
		// Facet-derived kind words are never a person's role (Issue #813).
		expect(hasRecordedRole(makeProject({ role: 'Development' }))).toBe(false);
		expect(hasRecordedRole(makeProject({ role: 'Video production' }))).toBe(false);
	});

	it('prints a period only when the label is non-empty', () => {
		expect(hasPeriodLabel(makeProject({ periodLabel: '2026' }))).toBe(true);
		expect(hasPeriodLabel(makeProject({ periodLabel: null }))).toBe(false);
		expect(hasPeriodLabel(makeProject({ periodLabel: '  ' }))).toBe(false);
	});
});
