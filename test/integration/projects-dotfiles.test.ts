import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

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
	it('answers 200 with the committed introduction', async () => {
		const response = await SELF.fetch(`${WORKER}/projects/dotfiles`, { redirect: 'manual' });
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/html');

		const html = await response.text();
		expect(html).toContain('<title>dotfiles — rebuildup.dev</title>');
		expect(html).toContain(`<link rel="canonical" href="${CANONICAL}"/>`);
		expect(html).toContain('dotfiles と pc-setup の境界');
		expect(html).toContain('設計原則');
		expect(html).toContain('リポジトリ構成');
		expect(html).toContain('エージェントランチャー');
		expect(html).toContain('エージェント設定の固定');
		expect(html).toContain('設計判断と調査');
	});

	it('renders provenance for the pinned commit', async () => {
		const response = await SELF.fetch(`${WORKER}/projects/dotfiles`, { redirect: 'manual' });
		const html = await response.text();
		expect(html).toContain('source commit');
		expect(html).toContain('last verified');
		expect(html).toContain('237af590cca2afe48ccd47ff3f81538d2297899c');
		expect(html).toContain(
			'https://github.com/rebuildup/dotfiles/blob/237af590cca2afe48ccd47ff3f81538d2297899c/README.md',
		);
	});

	it('never publishes the source README as executable markup', async () => {
		const response = await SELF.fetch(`${WORKER}/projects/dotfiles`, { redirect: 'manual' });
		const html = await response.text();
		expect(html).not.toContain('<script>alert');
		expect(html).not.toContain('javascript:');
		expect(html).not.toContain('~/.gitconfig');
		expect(html).not.toContain('## Layout');
	});
});
