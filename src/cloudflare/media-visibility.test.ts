import { describe, expect, it } from 'vitest';
import {
	PRIVATE_MEDIA_PREFIXES,
	PUBLIC_MEDIA_PREFIXES,
	classifyMediaKey,
	createPublicMediaDelivery,
	filterPublicMediaKeys,
	isPublicMediaKey,
	isValidMediaKey,
	listPublicMediaKeys,
	mediaKeyNamespace,
} from './media-visibility';

/**
 * Unit tests for the R2 object visibility boundary (Issue #459).
 *
 * The bucket itself is exercised in
 * `test/integration/r2-media-visibility.test.ts` against the real
 * workerd R2 binding; this file pins the pure policy so a failure
 * names the rule that broke instead of the binding.
 *
 * Threat model in one line: if a public R2 custom domain is attached
 * to the `MEDIA` bucket (Decision 5; the repository cannot verify
 * the production attachment), any key that exists can be fetched by
 * anyone who guesses it. These tests assert that the application never
 * creates that situation — it composes no URL for a non-public key,
 * returns no non-public key from a listing walk, and answers a
 * sequential sweep with 404 for every unpublished object.
 */

function stubSource(keys: readonly string[]) {
	const stored = new Set(keys);
	return {
		get: async (key: string) => (stored.has(key) ? { body: null, httpEtag: 'etag' } : null),
	};
}

/** A source that records every read, so "refused before the bucket" is assertable. */
function countingSource(keys: readonly string[]) {
	const stored = new Set(keys);
	const reads: string[] = [];
	return {
		reads,
		get: async (key: string) => {
			reads.push(key);
			return stored.has(key) ? { body: null, httpEtag: 'etag' } : null;
		},
	};
}

describe('classifyMediaKey', () => {
	it('accepts the declared public namespaces', () => {
		for (const prefix of PUBLIC_MEDIA_PREFIXES) {
			expect(classifyMediaKey(`${prefix}example.webp`).reason).toBe('public_namespace');
		}
		expect(isPublicMediaKey('portfolio/aulymo/cover.webp')).toBe(true);
		expect(isPublicMediaKey('reactions/abc123.webp')).toBe(true);
	});

	it('declares a prefix only when a producer writes it', () => {
		// No pre-declared namespaces (AGENTS.md §3): `public/` is the
		// Vite static-asset directory, and a namespace nobody writes
		// would be a key written later that becomes publicly servable
		// without anyone re-reading this decision.
		expect(PUBLIC_MEDIA_PREFIXES).toEqual(['portfolio/', 'reactions/']);
		expect(isPublicMediaKey('public/portfolio/aulymo/cover.webp')).toBe(false);
		expect(classifyMediaKey('public/x.webp').reason).toBe('unlisted_namespace');
	});

	it('refuses every declared private namespace', () => {
		for (const prefix of PRIVATE_MEDIA_PREFIXES) {
			expect(classifyMediaKey(`${prefix}draft.webp`).reason).toBe('private_namespace');
		}
	});

	it('refuses an undeclared namespace instead of defaulting to public', () => {
		// An allowlist that grows by accident is an accidental
		// publication. `wip/…` is a plausible producer prefix that
		// nobody declared, so it must fail closed.
		expect(classifyMediaKey('wip/aulymo/cover.webp').reason).toBe('unlisted_namespace');
		expect(classifyMediaKey('cover.webp').reason).toBe('unlisted_namespace');
		expect(isPublicMediaKey('wip/aulymo/cover.webp')).toBe(false);
	});

	it('refuses malformed keys before the namespace is even read', () => {
		for (const key of [
			'',
			'../etc/passwd',
			'portfolio/../private/x.webp',
			'/leading',
			'a b.webp',
		]) {
			expect(classifyMediaKey(key).reason).toBe('invalid_key');
			expect(classifyMediaKey(key).namespace).toBeNull();
		}
	});

	it('keeps the two prefix lists disjoint so precedence stays unambiguous', () => {
		// The module refuses private prefixes before consulting the
		// public allowlist, so an overlap would silently publish a
		// namespace one of the lists calls private. Disjointness is
		// the property that makes the precedence rule decidable.
		const overlap = PUBLIC_MEDIA_PREFIXES.filter((prefix) =>
			PRIVATE_MEDIA_PREFIXES.includes(prefix),
		);
		expect(overlap).toEqual([]);
		expect(PUBLIC_MEDIA_PREFIXES.length).toBeGreaterThan(0);
		expect(PRIVATE_MEDIA_PREFIXES.length).toBeGreaterThan(0);
	});

	it('reports the namespace of a well-formed key', () => {
		expect(mediaKeyNamespace('portfolio/aulymo/cover.webp')).toBe('portfolio');
		expect(mediaKeyNamespace('cover.webp')).toBeNull();
		expect(mediaKeyNamespace('../x')).toBeNull();
	});
});

describe('isValidMediaKey', () => {
	it('keeps the conservative grammar', () => {
		expect(isValidMediaKey('portfolio/aulymo/cover.webp')).toBe(true);
		expect(isValidMediaKey('a.webp')).toBe(true);
		expect(isValidMediaKey('foo bar')).toBe(false);
		expect(isValidMediaKey('foo?bar')).toBe(false);
		expect(isValidMediaKey(`${'a'.repeat(513)}`)).toBe(false);
	});
});

describe('filterPublicMediaKeys', () => {
	it('drops private and unlisted keys from a candidate list', () => {
		const listed = [
			'portfolio/aulymo/cover.webp',
			'private/draft/secret.webp',
			'staging/wip.webp',
			'unknown-namespace/x.webp',
			'reactions/deadbeef.png',
		];
		expect(filterPublicMediaKeys(listed)).toEqual([
			'portfolio/aulymo/cover.webp',
			'reactions/deadbeef.png',
		]);
	});
});

describe('createPublicMediaDelivery — gated fetch', () => {
	const PUBLIC_KEY = 'portfolio/aulymo/cover.webp';
	const PRIVATE_KEY = 'private/draft/secret.webp';

	it('serves an approved public key', async () => {
		const delivery = createPublicMediaDelivery(stubSource([PUBLIC_KEY]), {
			isApproved: () => true,
		});
		const result = await delivery.fetch(PUBLIC_KEY);
		expect(result.status).toBe(200);
	});

	it('refuses a private key with 404 even though the object exists', async () => {
		// The refusal carries no reason code (the module header says
		// why), so the evidence that the *namespace* gate fired — not
		// the approval gate or a missing fixture — is that the bucket
		// was never read at all.
		const source = countingSource([PRIVATE_KEY]);
		const delivery = createPublicMediaDelivery(source);
		const result = await delivery.fetch(PRIVATE_KEY);
		expect(result.status).toBe(404);
		expect(result).toEqual({ status: 404, key: PRIVATE_KEY });
		expect(source.reads).toEqual([]);
	});

	it('answers a missing key and a private key identically', async () => {
		// 404 with the same observable payload for both: no existence
		// oracle, not even a reason code a caller could serialise by
		// accident. `key` is what the caller supplied, so it is the
		// only field that may differ.
		const delivery = createPublicMediaDelivery(stubSource([PRIVATE_KEY]));
		const missing = await delivery.fetch('portfolio/aulymo/nope.webp');
		const privateHit = await delivery.fetch(PRIVATE_KEY);
		const { key: missingKey, ...missingPayload } = missing;
		const { key: privateKey, ...privatePayload } = privateHit;
		expect(missingPayload).toEqual(privatePayload);
		expect(Object.keys(missingPayload)).toEqual(['status']);
		expect(missingKey).toBe('portfolio/aulymo/nope.webp');
		expect(privateKey).toBe(PRIVATE_KEY);
	});

	it('refuses an unlisted namespace and a malformed key without reading the bucket', async () => {
		const source = countingSource([]);
		const delivery = createPublicMediaDelivery(source);
		const unlisted = await delivery.fetch('wip/aulymo/cover.webp');
		const malformed = await delivery.fetch('../portfolio/aulymo/cover.webp');
		expect(unlisted).toEqual({ status: 404, key: 'wip/aulymo/cover.webp' });
		expect(malformed).toEqual({ status: 404, key: '../portfolio/aulymo/cover.webp' });
		expect(source.reads).toEqual([]);
	});

	it('refuses a public-namespace key the owner has not published', async () => {
		// The draft-project case: the key looks fine, the row is not
		// published. 404, not 403 — 403 would confirm the object exists.
		const source = countingSource([PUBLIC_KEY]);
		const delivery = createPublicMediaDelivery(source, { isApproved: () => false });
		const result = await delivery.fetch(PUBLIC_KEY);
		expect(result).toEqual({ status: 404, key: PUBLIC_KEY });
		expect(source.reads).toEqual([]);
	});

	it('answers a sequential sweep with 404 for every unpublished object', async () => {
		// The probe data is written out here rather than imported: the
		// shared helper for it lives in `test/helpers/`, and a test file
		// under `src/cloudflare/` cannot import from `test/` under the
		// workerd pool (verified — the import is left unresolved inside
		// the worker). Keeping the sweep inline is also the point: this
		// is an attacker's script, not a shipped export.
		const sweep = Array.from({ length: 40 }, (_, i) => `portfolio/aulymo/cover-${i + 1}.webp`);
		// Only cover-3 and cover-17 exist in the bucket, and neither is
		// published. A sweep over the published-looking key layout must
		// not learn anything about them.
		const delivery = createPublicMediaDelivery(stubSource([sweep[2], sweep[16]]), {
			isApproved: () => false,
		});
		const results = await Promise.all(sweep.map((k) => delivery.fetch(k)));
		expect(results.every((r) => r.status === 404)).toBe(true);
		expect(results.filter((r) => r.status === 200)).toHaveLength(0);
	});
});

describe('listPublicMediaKeys — enumeration-safe listing', () => {
	it('returns only public keys and no withheld or scanned count', async () => {
		const keys = [
			'portfolio/aulymo/cover.webp',
			'portfolio/aulymo/thumb.webp',
			'private/draft/secret.webp',
			'staging/wip.webp',
			'unknown/x.webp',
		];
		const lister = {
			list: async () => ({ objects: keys.map((key) => ({ key })), truncated: false }),
		};
		const listing = await listPublicMediaKeys(lister);
		expect(listing.keys).toEqual(['portfolio/aulymo/cover.webp', 'portfolio/aulymo/thumb.webp']);
		// The return shape is the contract: a count of scanned or
		// withheld objects would answer "does this guessed key exist?"
		// whenever the caller forwards a visitor-supplied prefix.
		expect(listing).toEqual({
			keys: ['portfolio/aulymo/cover.webp', 'portfolio/aulymo/thumb.webp'],
			truncated: false,
		});
		expect(JSON.stringify(listing)).not.toContain('secret.webp');
	});

	it('withholds public-namespace keys that are not published', async () => {
		const keys = ['portfolio/aulymo/cover.webp', 'portfolio/draft-project/cover.webp'];
		const lister = {
			list: async () => ({ objects: keys.map((key) => ({ key })), truncated: false }),
		};
		const listing = await listPublicMediaKeys(lister, {
			isApproved: (key) => !key.includes('draft-project'),
		});
		expect(listing.keys).toEqual(['portfolio/aulymo/cover.webp']);
		expect(listing).not.toHaveProperty('withheld');
	});

	it('pages through a truncated listing', async () => {
		const pages: Record<string, Array<{ key: string }>> = {
			'': [{ key: 'portfolio/a/cover.webp' }, { key: 'private/a/secret.webp' }],
			page2: [{ key: 'portfolio/b/cover.webp' }, { key: 'draft/b/wip.webp' }],
		};
		const lister = {
			list: async (options?: { cursor?: string }) => {
				const cursor = options?.cursor ?? '';
				if (cursor === 'page2') return { objects: pages.page2, truncated: false };
				return { objects: pages[''], truncated: true, cursor: 'page2' };
			},
		};
		const listing = await listPublicMediaKeys(lister);
		expect(listing.keys).toEqual(['portfolio/a/cover.webp', 'portfolio/b/cover.webp']);
		expect(listing.truncated).toBe(false);
		expect(Object.keys(listing).sort()).toEqual(['keys', 'truncated']);
	});
});
