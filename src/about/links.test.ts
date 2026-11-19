import { describe, expect, it } from 'vitest';
import { ABOUT_LINKS, ABOUT_LINK_GROUPS } from './links';

/**
 * `/links` inventory contract (Issue #390).
 *
 * The page is only as trustworthy as its data: every row must be an
 * absolute `https:` URL or an internal `/path`, ids must be unique,
 * and no row may carry a contact channel (e-mail / `mailto:`) —
 * private channels stay owned by `src/contact/channels.json`.
 */

describe('ABOUT_LINK_GROUPS', () => {
	it('has at least one link per declared group', () => {
		for (const group of ABOUT_LINK_GROUPS) {
			expect(group.links.length, group.id).toBeGreaterThan(0);
		}
	});

	it('uses unique ids across the whole inventory', () => {
		const ids = ABOUT_LINKS.map((link) => link.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('flattens to every grouped link exactly once', () => {
		const grouped = ABOUT_LINK_GROUPS.flatMap((group) => group.links);
		expect(ABOUT_LINKS).toEqual(grouped);
	});
});

describe('ABOUT_LINKS rows', () => {
	it.each(ABOUT_LINKS.map((link) => [link.id, link] as const))(
		'%s carries an absolute https URL or an internal path',
		(_id, link) => {
			expect(link.url).toMatch(/^(https:\/\/|\/)/);
			expect(link.url.startsWith('http://')).toBe(false);
			expect(link.url).not.toContain('mailto:');
		},
	);

	it.each(ABOUT_LINKS.map((link) => [link.id, link] as const))(
		'%s marks external consistently with its URL',
		(_id, link) => {
			expect(link.external).toBe(link.url.startsWith('https://'));
		},
	);

	it('publishes no e-mail-shaped literal anywhere in the inventory', () => {
		const serialised = JSON.stringify(ABOUT_LINKS);
		expect(serialised).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/);
	});

	it('keeps the on-site rows that replaced the 2025 yusuke-kim.com links', () => {
		const internal = ABOUT_LINKS.filter((link) => !link.external).map((link) => link.url);
		expect(internal).toContain('/portfolio');
		expect(internal).toContain('/contact');
		expect(internal).toContain('/commission');
	});
});
