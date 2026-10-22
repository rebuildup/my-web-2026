import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * `/projects/dotfiles` SSR contract (Issue #621).
 *
 * The route is deliberately database-free and network-free: it reads a
 * committed JSON snapshot at module load. This suite proves the Worker
 * answers the document from that snapshot, publishes the canonical the
 * route head declares, and renders the extracted README text as text —
 * not as an HTML sink.
 */
const WORKER = 'https://example.com';
const CANONICAL = 'https://rebuildup.dev/projects/dotfiles';

describe('/projects/dotfiles (Issue #621)', () => {
	// One SSR request shared by every assertion: the page is static, and
	// three SELF.fetch calls made this file time out when the integration
	// suite ran in parallel.
	let page: { status: number; contentType: string | null; html: string };

	beforeAll(async () => {
		const response = await SELF.fetch(`${WORKER}/projects/dotfiles`, { redirect: 'manual' });
		page = {
			status: response.status,
			contentType: response.headers.get('content-type'),
			html: await response.text(),
		};
	});

	it('answers 200 with the committed introduction', () => {
		expect(page.status).toBe(200);
		expect(page.contentType).toContain('text/html');
		expect(page.html).toContain('<title>dotfiles — rebuildup.dev</title>');
		expect(page.html).toContain(`<link rel="canonical" href="${CANONICAL}"/>`);
		expect(page.html).toContain('dotfiles と pc-setup の境界');
		expect(page.html).toContain('設計原則');
		expect(page.html).toContain('リポジトリ構成');
		expect(page.html).toContain('エージェントランチャー');
		expect(page.html).toContain('エージェント設定の固定');
		expect(page.html).toContain('設計判断と調査');
	});

	it('renders provenance for the pinned commit', () => {
		expect(page.html).toContain('README commit');
		expect(page.html).toContain('README blob');
		expect(page.html).toContain('last verified');
		expect(page.html).toContain('237af590cca2afe48ccd47ff3f81538d2297899c');
		expect(page.html).toContain(
			'https://github.com/rebuildup/dotfiles/blob/237af590cca2afe48ccd47ff3f81538d2297899c/README.md',
		);
	});

	it('never publishes the source README as executable markup', () => {
		expect(page.html).not.toContain('<script>alert');
		expect(page.html).not.toContain('javascript:');
		expect(page.html).not.toContain('~/.gitconfig');
		expect(page.html).not.toContain('## Layout');
	});
});
