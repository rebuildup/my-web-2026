import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PortfolioLink, PortfolioMedia, PortfolioProject } from '../schema';
import { DesignView } from './DesignView';
import { DevelopView } from './DevelopView';
import { VideoView } from './VideoView';

/**
 * Exhibition views — static-markup contract (Issue #1048).
 *
 * `views.test.ts` pins the pure mapping rules; this file pins what
 * the three views actually render for the same project shapes:
 *
 *   - every view links to `/portfolio/<slug>` — the detail page stays
 *     the single owner of the full record;
 *   - a project with no media renders the honest `no media` frame,
 *     never a fabricated thumbnail;
 *   - the video view offers the play affordance ONLY when the
 *     Issue #870 facade gate accepts a link, and SSR never mounts an
 *     iframe (playback starts on the visitor's click);
 *   - no `aria-label` lands on a generic-role element (the Issue #490
 *     per-row defect `list-scale.test.tsx` gates for cards).
 *
 * Static markup, no DOM — the same reason `ProjectCard.test.tsx`
 * uses it: these components need no router and no bindings.
 */

const EPOCH = 1_700_000_000_000;

function makeMedia(overrides: Partial<PortfolioMedia> = {}): PortfolioMedia {
	return {
		id: 'm-1',
		r2Key: 'portfolio/demo/cover.webp',
		contentType: 'image/webp',
		width: 1600,
		height: 900,
		alt: 'cover art',
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
		label: 'repo',
		url: 'https://github.com/example/demo',
		displayOrder: 0,
		...overrides,
	};
}

function makeProject(overrides: Partial<PortfolioProject> = {}): PortfolioProject {
	return {
		id: 'p-1',
		slug: 'demo',
		title: 'Demo project',
		summary: 'A synthetic summary for the view contract test.',
		role: 'Tool developer',
		periodStart: EPOCH,
		periodEnd: null,
		periodLabel: '2026',
		motivationMd: '',
		architectureMd: null,
		constraintsMd: null,
		implementationMd: null,
		evidenceMd: null,
		retrospectiveMd: null,
		facets: ['develop'],
		technologies: ['TypeScript'],
		visibility: 'public',
		status: 'published',
		evidenceStatus: 'reviewed',
		pinned: false,
		displayOrder: 0,
		createdAt: EPOCH,
		updatedAt: EPOCH,
		links: [],
		media: [makeMedia()],
		...overrides,
	};
}

const WITH_VIDEO = makeProject({
	id: 'p-video',
	slug: 'motion-demo',
	title: 'Motion demo',
	facets: ['video'],
	links: [
		makeLink({
			id: 'l-video',
			kind: 'video',
			label: 'watch',
			url: 'https://youtu.be/dQw4w9WgXcQ',
		}),
	],
});

const NO_MEDIA = makeProject({
	id: 'p-empty',
	slug: 'text-only',
	title: 'Text only project',
	media: [],
	links: [],
	technologies: [],
});

function expectNoGenericAriaLabel(markup: string) {
	expect(markup).not.toMatch(/<(div|span|p)\b(?![^>]*\brole=)[^>]*\saria-label=/);
}

describe('DevelopView', () => {
	it('renders one row per project linking to the detail page', () => {
		const markup = renderToStaticMarkup(
			<DevelopView
				projects={[
					makeProject({ links: [makeLink()] }),
					makeProject({ id: 'p-2', slug: 'second' }),
				]}
			/>,
		);
		expect((markup.match(/<article/g) ?? []).length).toBe(2);
		expect(markup).toContain('href="/portfolio/demo"');
		expect(markup).toContain('href="/portfolio/second"');
		expect(markup).toContain('Demo project');
		// Role / period / technology / link rows are real recorded facts.
		expect(markup).toContain('Tool developer');
		expect(markup).toContain('2026');
		expect(markup).toContain('TypeScript');
		expect(markup).toContain('https://github.com/example/demo');
	});

	it('renders the honest placeholder for a media-less project', () => {
		const markup = renderToStaticMarkup(<DevelopView projects={[NO_MEDIA]} />);
		expect(markup).toContain('no media');
		expect(markup).toContain('href="/portfolio/text-only"');
		expectNoGenericAriaLabel(markup);
	});
});

describe('VideoView', () => {
	it('offers playback only for a validated video link and never SSRs an iframe', () => {
		const markup = renderToStaticMarkup(<VideoView projects={[WITH_VIDEO, NO_MEDIA]} />);
		// The play affordance exists for the video project…
		expect(markup).toContain('aria-label="Play video for Motion demo"');
		// …and not for the project the facade gate refuses.
		expect(markup).not.toContain('Play video for Text only project');
		// Playback is click-driven: no iframe in the server render.
		expect(markup).not.toContain('<iframe');
		expect(markup).toContain('href="/portfolio/motion-demo"');
		expect(markup).toContain('no media');
		expectNoGenericAriaLabel(markup);
	});
});

describe('DesignView', () => {
	it('renders a linked tile per project with facet and period caption', () => {
		const markup = renderToStaticMarkup(
			<DesignView
				projects={[makeProject(), makeProject({ id: 'p-2', slug: 'wide', pinned: true })]}
			/>,
		);
		expect((markup.match(/<article|<a /g) ?? []).length).toBeGreaterThanOrEqual(2);
		expect(markup).toContain('href="/portfolio/demo"');
		expect(markup).toContain('href="/portfolio/wide"');
		expect(markup).toContain('Develop');
		expect(markup).toContain('Pinned');
		expectNoGenericAriaLabel(markup);
	});

	it('renders the honest placeholder for a media-less project', () => {
		const markup = renderToStaticMarkup(<DesignView projects={[NO_MEDIA]} />);
		expect(markup).toContain('no media');
		expect(markup).toContain('Text only project');
		expectNoGenericAriaLabel(markup);
	});
});
