import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CurrentProjects } from './CurrentProjects';
import type { CurrentProject } from './projects';

/**
 * The rendered "現在地 / Where I am now" section (Issue #316).
 *
 * `renderToStaticMarkup` is the shipped rendering path — the same
 * call the SSR document is built from — so what is asserted here is
 * the markup a browser receives, not an internal string.
 */
function render(props: { projects?: readonly CurrentProject[] }): string {
	return renderToStaticMarkup(<CurrentProjects {...props} />);
}

const POPULATED: CurrentProject[] = [
	{ id: 'my-web-2026', name: 'my-web-2026', statusJa: '個人 Web Platform の再構築。' },
	{ id: 'tastile', name: 'Tastile', statusJa: 'scheduling を扱う product。' },
];

const LINKED: CurrentProject[] = [
	{
		id: 'linked',
		name: 'リンク付き',
		statusJa: '公開先のあるプロジェクト。',
		link: { label: '詳しく見る', href: '/about' },
	},
];

describe('CurrentProjects', () => {
	it('names the section with its own heading', () => {
		const html = render({ projects: POPULATED });
		expect(html).toContain('aria-labelledby="current-projects-heading"');
		expect(html).toContain('id="current-projects-heading"');
		expect(html).toContain('現在地 / Where I am now');
	});

	it('publishes every project name and status', () => {
		const html = render({ projects: POPULATED });
		expect(html).toContain('my-web-2026');
		expect(html).toContain('個人 Web Platform の再構築。');
		expect(html).toContain('Tastile');
		expect(html).toContain('scheduling を扱う product。');
		// One <h3> per project.
		expect(html.match(/<h3/g)).toHaveLength(POPULATED.length);
	});

	it('publishes one meaningful sentence instead of an empty list', () => {
		const html = render({ projects: [] });
		expect(html).toContain('現在、公開中の進行中のプロジェクトはありません。');
		expect(html).not.toContain('<ul');
		expect(html).not.toContain('<li');
	});

	it('treats a missing snapshot as an empty publication', () => {
		const html = render({});
		expect(html).toContain('現在、公開中の進行中のプロジェクトはありません。');
	});

	it('renders no link when a project has none', () => {
		const html = render({ projects: POPULATED });
		expect(html).not.toContain('<a');
	});

	it('renders a link with a visible label and an aria-hidden arrow', () => {
		const html = render({ projects: LINKED });
		expect(html).toContain('href="/about"');
		expect(html).toContain('詳しく見る');
		expect(html).toContain('<span aria-hidden="true">→</span>');
	});

	it('drops an unpublishable link but keeps the project', () => {
		const html = render({
			projects: [
				{
					id: 'unsafe',
					name: '安全でないリンク',
					statusJa: '説明',
					link: { label: '開く', href: 'javascript:alert(1)' },
				},
			],
		});
		expect(html).toContain('安全でないリンク');
		expect(html).not.toContain('javascript:');
		expect(html).not.toContain('<a');
	});
});
