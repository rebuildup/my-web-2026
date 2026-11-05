import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PortfolioVideo } from '../video-facade';
import { PortfolioVideoFacade } from './PortfolioVideoFacade';

/**
 * Click-to-load contract (Issue #870).
 *
 * The assertions that matter are the NEGATIVE ones: before activation
 * the document must carry no iframe and no `src` pointing at a
 * third-party origin. The measured proof (zero network requests) lives
 * in `docs/verification/portfolio/video-facade.md`; this test pins the
 * markup shape that makes that measurement possible.
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
	watchUrl: 'https://www.youtube.com/watch?v=SewXH0Bbm-c',
};

describe('PortfolioVideoFacade', () => {
	it('renders no iframe before activation', () => {
		const { container } = render(<PortfolioVideoFacade video={video} />);
		expect(container.querySelector('iframe')).toBeNull();
	});

	it('names the source and the id before the visitor presses anything', () => {
		const { container } = render(<PortfolioVideoFacade video={video} />);
		const text = container.textContent ?? '';
		expect(text).toContain('YouTube');
		expect(text).toContain('SewXH0Bbm-c');
		expect(text).toContain('動画を読み込む');
	});

	it('offers a plain watch link that needs no script', () => {
		const { container } = render(<PortfolioVideoFacade video={video} />);
		const anchor = container.querySelector('a');
		expect(anchor?.getAttribute('href')).toBe(video.watchUrl);
		expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer');
		expect(anchor?.getAttribute('target')).toBe('_blank');
	});

	it('mounts exactly one iframe after activation, built from the id', () => {
		const { container } = render(<PortfolioVideoFacade video={video} />);
		const button = container.querySelector('button');
		expect(button).not.toBeNull();
		act(() => {
			if (button) fireEvent.click(button);
		});
		const frames = container.querySelectorAll('iframe');
		expect(frames).toHaveLength(1);
		const frame = frames[0];
		expect(frame?.getAttribute('src')).toBe(video.embedUrl);
		expect(frame?.getAttribute('src')).not.toContain('autoplay');
		expect(frame?.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
		expect(frame?.getAttribute('allow')).toBe('accelerometer; encrypted-media; picture-in-picture');
		expect(frame?.getAttribute('title')).toBe('YouTube の動画（SewXH0Bbm-c）');
	});

	it('drops the activation control once the frame is mounted', () => {
		const { container } = render(<PortfolioVideoFacade video={video} />);
		act(() => {
			const button = container.querySelector('button');
			if (button) fireEvent.click(button);
		});
		expect(container.querySelector('button')).toBeNull();
	});

	it('uses a recorded label as the frame title when one exists', () => {
		const { container } = render(
			<PortfolioVideoFacade video={{ ...video, link: { ...video.link, label: 'Aulymo PV' } }} />,
		);
		act(() => {
			const button = container.querySelector('button');
			if (button) fireEvent.click(button);
		});
		expect(container.querySelector('iframe')?.getAttribute('title')).toBe('Aulymo PV');
	});
});
