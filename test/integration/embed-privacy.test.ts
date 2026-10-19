/// <reference path="../../node_modules/@cloudflare/vitest-plugin/types/cloudflare-test.d.ts" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { evaluateEmbedPrivacy, toPrivacySubject } from '../../src/tools/embed-privacy';
import type { ManifestTool } from '../../src/tools/registry';
import { listAllTools, resolveToolEntryHtml } from '../../src/tools/registry';

/**
 * Third-party contact contract on real Worker documents (Issue #498).
 *
 * The unit suite pins the policy over object literals; this suite
 * proves the property on the documents a visitor actually receives,
 * through the local workerd pool and the real SSR pipeline:
 *
 *   1. **Non-empty guarantee.** Every embeddable Tool route returns
 *      200 and a document that references NO declared third-party
 *      origin through a request-bearing attribute. The origins are
 *      named as TEXT (the notice has to name them) — what must never
 *      happen is a URL that makes the browser fetch them.
 *   2. **The gate is real.** A Tool whose verdict is `click_to_load`
 *      ships a document with no `<iframe>` at all; a Tool whose verdict
 *      is `not_required` ships exactly one, pointing at the entry HTML
 *      the registry resolved.
 *   3. **Non-vacuity.** The detector has to fire on something: a
 *      synthetic document carrying a `<link rel=preconnect>` to a
 *      declared origin is caught, so a green row above is evidence
 *      rather than an empty matcher.
 *
 * No production origin is contacted: every request goes to `SELF` in
 * the local pool.
 */

/** Attributes that would make the browser issue a request. */
const REQUEST_BEARING = /(?:src|href|srcset|imagesrcset|data|poster)\s*=\s*"([^"]*)"/gi;

/** The canonical production origin (ADR-0014), as the pool serves it. */
const HOST_ORIGIN = 'https://rebuildup.dev';

/**
 * An embed-free host page, used as the control for the chrome baseline.
 * `/contact` carries the same site chrome as a Tool route (GA4 loader +
 * Google Fonts) and frames nothing, so any third-party URL a Tool route
 * adds beyond this set was added by the embed.
 */
const CONTROL_PATH = '/contact';

function embeddableTools(): ManifestTool[] {
	return listAllTools().filter((tool) => tool.delivery.kind !== 'host_disabled');
}

async function htmlOf(path: string): Promise<{ status: number; html: string }> {
	const res = await SELF.fetch(`https://rebuildup.dev${path}`, { redirect: 'manual' });
	return { status: res.status, html: await res.text() };
}

/** Request-bearing attribute values in a document. */
function referencedUrls(html: string): string[] {
	return [...html.matchAll(REQUEST_BEARING)].map((match) => match[1] ?? '');
}

/** The subset of those URLs a browser would fetch from another origin. */
function thirdPartyUrls(html: string): string[] {
	return referencedUrls(html).filter((url) => {
		if (url.startsWith('/') || url.startsWith('#')) return false;
		try {
			return new URL(url, HOST_ORIGIN).origin !== HOST_ORIGIN;
		} catch {
			return false;
		}
	});
}

describe('embed privacy — the documents visitors receive (Issue #498)', () => {
	it('adds no third-party request the host chrome did not already make', async () => {
		const control = await htmlOf(CONTROL_PATH);
		// Non-vacuity: the baseline is not empty, so the subset
		// assertion below compares against real chrome requests instead
		// of passing on an empty set.
		const chrome = thirdPartyUrls(control.html);
		expect(chrome.length).toBeGreaterThan(0);
		expect(chrome.some((url) => url.includes('fonts.googleapis.com'))).toBe(true);

		for (const tool of embeddableTools()) {
			const { status, html } = await htmlOf(`/tools/${tool.slug}`);
			expect(status).toBe(200);
			const added = thirdPartyUrls(html).filter((url) => !chrome.includes(url));
			expect(added, `${tool.slug} adds a third-party request before activation`).toEqual([]);
		}
	});

	it('never requests an origin the embed declared, outside the host chrome origins', async () => {
		// Overlap with the chrome origins is allowed — the host loads
		// Google Fonts on every page by owner decision (Issue #171 /
		// #447). What this Issue governs is the EMBED's own requests, so
		// the two services the Tool artefact would have pulled on load
		// (Typekit, Apps Script) must not appear at all.
		for (const tool of embeddableTools()) {
			const { html } = await htmlOf(`/tools/${tool.slug}`);
			const contacts = evaluateEmbedPrivacy(
				toPrivacySubject(tool.slug, tool.delivery),
			).contacts_after_activation;
			const offending = thirdPartyUrls(html).filter(
				(url) =>
					!url.includes('fonts.googleapis.com') &&
					!url.includes('fonts.gstatic.com') &&
					contacts.some((origin) => url.startsWith(origin)),
			);
			expect(offending, `${tool.slug} requests an embed-declared origin`).toEqual([]);
		}
	});

	it('mounts no frame at all while a Tool is waiting for activation', async () => {
		const gated = embeddableTools().filter(
			(tool) =>
				evaluateEmbedPrivacy(toPrivacySubject(tool.slug, tool.delivery)).consent ===
				'click_to_load',
		);
		expect(gated.length).toBeGreaterThan(0);
		for (const tool of gated) {
			const { html } = await htmlOf(`/tools/${tool.slug}`);
			expect(html, `${tool.slug} rendered an iframe before activation`).not.toMatch(/<iframe/i);
			expect(html).toContain('data-tool-consent="pending"');
			expect(html).toContain('data-testid="tool-embed-consent"');
		}
	});

	it('still mounts the frame for a Tool that declares no contact', async () => {
		const ungated = embeddableTools().filter(
			(tool) =>
				evaluateEmbedPrivacy(toPrivacySubject(tool.slug, tool.delivery)).consent === 'not_required',
		);
		for (const tool of ungated) {
			const { html } = await htmlOf(`/tools/${tool.slug}`);
			const frames = html.match(/<iframe[^>]*>/gi) ?? [];
			expect(frames, `${tool.slug} lost its frame`).toHaveLength(1);
			expect(frames[0]).toContain(`src="${resolveToolEntryHtml(tool)}"`);
		}
	});

	it('the detector is not vacuous — it catches a preconnect to a declared origin', () => {
		// Non-empty guarantee needs a positive control: a document that
		// DOES pull a declared origin has to be reported, otherwise the
		// assertions above would pass for a matcher that never matches.
		const origin = 'https://use.typekit.net';
		const synthetic = `<html><head><link rel="preconnect" href="${origin}"></head></html>`;
		expect(thirdPartyUrls(synthetic)).toEqual([origin]);
	});
});

describe('embed privacy measurements for the verification report (Issue #498)', () => {
	it('prints the measured matrix for the verification report', async () => {
		const rows: Array<Record<string, string | number>> = [];
		for (const tool of embeddableTools()) {
			const verdict = evaluateEmbedPrivacy(toPrivacySubject(tool.slug, tool.delivery));
			const { status, html } = await htmlOf(`/tools/${tool.slug}`);
			const frames = html.match(/<iframe[^>]*>/gi) ?? [];
			const urls = thirdPartyUrls(html);
			const control = await htmlOf(CONTROL_PATH);
			const chrome = thirdPartyUrls(control.html);
			rows.push({
				slug: tool.slug,
				path: `/tools/${tool.slug}`,
				delivery: tool.delivery.kind,
				frame_src: resolveToolEntryHtml(tool),
				contacts: verdict.contacts_after_activation.join(' '),
				consent: verdict.consent,
				status,
				ssr_iframes: frames.length,
				ssr_third_party_added: urls.filter((url) => !chrome.includes(url)).length,
				ssr_third_party_total: urls.length,
				notice: html.includes('data-testid="tool-embed-consent"') ? 'yes' : 'no',
				violations: verdict.violations.length,
			});
		}
		console.log(`EMBED_PRIVACY_MEASUREMENT ${JSON.stringify(rows)}`);
		expect(rows.length).toBe(embeddableTools().length);
		// The report would be meaningless if every row were ungated: at
		// least one shipped Tool must exercise the consent path.
		expect(rows.some((row) => row.consent === 'click_to_load')).toBe(true);
	});
});
