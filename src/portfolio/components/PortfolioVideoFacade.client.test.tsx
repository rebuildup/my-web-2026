import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PortfolioVideo } from '../video-facade';
import { PortfolioVideoFacade } from './PortfolioVideoFacade';

/**
 * Direct-embed contract (Issue #870; click-to-load removed per owner
 * decision 2026-11-05, Issue #910).
 *
 * The assertions that matter are the ones that keep the embed safe:
 * the `src` is the built youtube-nocookie URL (never the stored link),
 * no `autoplay`, and a referrer policy. The measured proof (which
 * network requests a page load issues) lives in
 * `docs/verification/portfolio/video-facade.md`.
 *
 * happy-dom refuses to load a framed document and reports
 * `Failed to load iframe page … Iframe page loading is disabled` through
 * its virtual console. That is the expected state here — the unit suite
 * must not fetch youtube-nocookie.com — so the message is noise the
 * runner prints, not a failure.
 */

const video: PortfolioVideo = {
	id: 'SewXH0Bbm-c',
	link: {
		id: 'l1',
		kind: 'video',
		label: null,
		url: 'https://youtu.be/SewXH0Bbm-c',
		displayOrder: 1,
	},
	embedUrl: 'https://www.youtube-nocookie.com/embed/SewXH0Bbm-c',
};

describe('PortfolioVideoFacade', () => {
	it('mounts exactly one iframe on first render, built from the id', () => {
		const { container } = render(<PortfolioVideoFacade video={video} />);
		const frames = container.querySelectorAll('iframe');
		expect(frames).toHaveLength(1);
		const frame = frames[0];
		expect(frame?.getAttribute('src')).toBe(video.embedUrl);
		expect(frame?.getAttribute('src')).not.toContain('autoplay');
		expect(frame?.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
		expect(frame?.getAttribute('allow')).toBe('accelerometer; encrypted-media; picture-in-picture');
		expect(frame?.getAttribute('loading')).toBe('lazy');
		expect(frame?.getAttribute('allowfullscreen')).not.toBeNull();
		expect(frame?.getAttribute('title')).toBe('YouTube の動画（SewXH0Bbm-c）');
	});

	it('renders no activation control and no consent copy', () => {
		const { container } = render(<PortfolioVideoFacade video={video} />);
		expect(container.querySelector('button')).toBeNull();
		const text = container.textContent ?? '';
		expect(text).not.toContain('動画を読み込む');
		expect(text).not.toContain('押すまで');
	});

	it('uses a recorded label as the frame title when one exists', () => {
		const { container } = render(
			<PortfolioVideoFacade video={{ ...video, link: { ...video.link, label: 'Aulymo PV' } }} />,
		);
		expect(container.querySelector('iframe')?.getAttribute('title')).toBe('Aulymo PV');
	});
});
