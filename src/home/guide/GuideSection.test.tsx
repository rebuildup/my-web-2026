import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GuideSection } from './GuideSection';

const TODAY = '2026-11-16';

function render(today = TODAY): string {
	return renderToStaticMarkup(<GuideSection today={today} />);
}

describe('GuideSection', () => {
	it('renders every ledger facility as a same-level link with its summary', () => {
		const html = render();
		for (const href of [
			'/about',
			'/portfolio',
			'/projects/dotfiles',
			'/tools',
			'/keyboard',
			'/contact',
		]) {
			expect(html, href).toContain(`href="${href}"`);
		}
		expect(html).toContain('サイト内案内');
	});

	it('marks external bases and keeps them distinguishable from site routes', () => {
		const html = render();
		expect(html).toContain('href="https://github.com/rebuildup"');
		expect(html).toContain('外部');
	});

	it('expands subordinate destinations inside a native details element', () => {
		const html = render();
		expect(html).toContain('<details');
		expect(html).toContain('下の階層を見る');
	});

	it('shows the featured badge only inside a promotion window', () => {
		// The shipped ledger has no active promotion today: no badge.
		expect(render()).not.toContain('注目');
	});

	it('never renders admin or private paths', () => {
		expect(render()).not.toContain('/admin');
	});
});
