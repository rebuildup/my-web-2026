/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

/**
 * `/keyboard` SSR contract (Issue #620).
 *
 * The route has no D1 / R2 dependency: the loader reads the committed
 * snapshot, validates its manifest and parses it at module load. This
 * test therefore exercises the real Worker boundary without seeding a
 * database and pins the facts a reader must receive in the FIRST
 * document — before any client-side tab is activated:
 *
 *   - the macOS base layer is the default;
 *   - the diagram is a real position grid (buttons keyed by cap);
 *   - provenance (repository, pinned ref, adoption) is server-rendered;
 *   - the safe state is NOT shown when the committed manifest is valid;
 *   - the canonical and OGP tags are the contracted ones.
 */
const WORKER = 'https://example.com';

async function fetchKeyboard(): Promise<{ status: number; html: string }> {
	const response = await SELF.fetch(`${WORKER}/keyboard`, { redirect: 'manual' });
	return { status: response.status, html: await response.text() };
}

describe('keyboard — SSR route contract', () => {
	it('renders 200 with the macOS base layer and its key grid', async () => {
		const { status, html } = await fetchKeyboard();
		expect(status).toBe(200);
		expect(html).toContain('キーボード配列');
		expect(html).toContain('大西配列（ベース）');
		expect(html).toContain('data-keyboard-key="Space"');
		expect(html).toContain('HUB（大西）');
		expect(html).not.toContain('現在、配列を表示できません');
	});

	it('server-renders the provenance ledger and adoption note', async () => {
		const { html } = await fetchKeyboard();
		expect(html).toContain('key-map-kanata');
		expect(html).toContain('pc-setup');
		expect(html).toContain('0c02df504029');
		expect(html).toContain('mac/kanata-us.kbd');
		// React SSR separates an interpolated count from its unit with a
		// comment marker, so the raw document is `25<!-- --> 件`.
		expect(html.replaceAll('<!-- -->', '')).toContain('25 件');
	});

	it('server-renders the canonical and OGP head', async () => {
		const { html } = await fetchKeyboard();
		expect(html).toContain('rel="canonical" href="https://rebuildup.dev/keyboard"');
		expect(html).toContain('property="og:type" content="website"');
		expect(html).toContain('property="og:url" content="https://rebuildup.dev/keyboard"');
	});
});
