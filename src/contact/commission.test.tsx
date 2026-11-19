import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
	COMMISSION_REQUIREMENTS,
	COMMISSION_SERVICE_GROUPS,
	COMMISSION_SOFTWARE,
	COMMISSION_STEPS,
} from './commission';
import { CommissionPage } from './commission-page';

/**
 * `/commission` page composition contract (Issue #390; parked
 * intake per #368 / #369).
 *
 * The page's first claim is the intake status. These assertions
 * pin that the paused state is rendered, that no intake affordance
 * (form / price / calculator) exists, and that the migrated
 * informational sections are present.
 */

describe('commission data', () => {
	it('declares the two service groups the 2025 pages published', () => {
		expect(COMMISSION_SERVICE_GROUPS.map((g) => g.id)).toEqual(['development', 'video']);
	});

	it('keeps the six-step request flow', () => {
		expect(COMMISSION_STEPS.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it('carries no price-shaped literal anywhere in the inventory', () => {
		const serialised = JSON.stringify({
			COMMISSION_SERVICE_GROUPS,
			COMMISSION_STEPS,
			COMMISSION_REQUIREMENTS,
			COMMISSION_SOFTWARE,
		});
		expect(serialised).not.toMatch(/[¥￥]\s?[\d,]+/);
		expect(serialised).not.toMatch(/\d+\s*円/);
	});
});

describe('CommissionPage', () => {
	const html = renderToStaticMarkup(<CommissionPage />);

	it('renders one h1 and the paused status notice', () => {
		expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
		expect(html).toContain('制作依頼 / Commission');
		expect(html).toContain('現在、制作依頼の受付は休止しています');
	});

	it('renders no form and no input affordance', () => {
		expect(html).not.toContain('<form');
		expect(html).not.toContain('<input');
		expect(html).not.toContain('<select');
		expect(html).not.toContain('<textarea');
	});

	it('states that pricing is not published', () => {
		expect(html).toContain('料金は公開していません');
	});

	it('renders the migrated sections', () => {
		expect(html).toContain('依頼できる内容');
		expect(html).toContain('MV 制作');
		expect(html).toContain('依頼の流れ');
		expect(html).toContain('見積もりに必要な情報');
		expect(html).toContain('使用ソフトウェア');
		expect(html).toContain('連絡方法');
	});

	it('routes contact to /contact and publishes no address', () => {
		expect(html).toContain('href="/contact"');
		expect(html).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
	});
});
