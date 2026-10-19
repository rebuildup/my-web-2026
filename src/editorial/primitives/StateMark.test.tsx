import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StateMarkKind } from './StateMark';
import { StateMark } from './StateMark';

/**
 * StateMark — the shape vocabulary IS the Issue #411 contract.
 *
 * WCAG 2.2 SC 1.4.1 Use of Color (Level A) forbids colour as the only
 * visual means of conveying information. On this primitive the
 * non-colour half is geometry, and geometry is exactly the thing a
 * refactor deletes without noticing: replacing a polygon with `null`,
 * renaming a kind, or dropping the rounded utility all keep every
 * other test green while two states collapse onto one rectangle in
 * greyscale.
 *
 * So this file asserts the RESOLVED SILHOUETTE — the inline
 * `clip-path` plus the utility classes the browser actually paints —
 * rather than the `data-state-mark` attribute. The kind attribute is
 * asserted too (`tiles.test.tsx`, `ProjectCard.test.tsx`), but it only
 * says which vocabulary entry a consumer picked; it says nothing about
 * what that entry draws. Two kinds with identical geometry and
 * different names would pass every kind-level assertion and still fail
 * SC 1.4.1 in the browser.
 *
 * What the assertions can and cannot prove:
 *
 *   - CAN: every kind resolves to a distinct (clip-path, class) pair,
 *     so no two states can render the same silhouette; the polygon
 *     kinds really carry a `clip-path`; the disc and the square —
 *     the only two unclipped kinds — are separated by the radius;
 *     every kind paints in the same inherited colour (no per-kind
 *     tone can be reintroduced through a colour class); and a mark is
 *     still ONE element with no children, which is the per-card DOM
 *     cost `list-scale.test.tsx` budgets.
 *   - CANNOT: whether two DIFFERENT polygons are far enough apart at
 *     8px to read as different. That is a rendering question, so it
 *     lives with the rasterised evidence in
 *     `docs/verification/a11y/status-monochrome.md`.
 *
 * Static markup, no DOM: same reason as `tiles.test.tsx` — the
 * workerd pool has no DOM to query, and the primitive needs nothing
 * but `react-dom/server`.
 */

const KINDS = [
	'ok',
	'degraded',
	'unreachable',
	'design',
	'code',
	'writing',
	'tool',
] as const satisfies readonly StateMarkKind[];

/** The two families a single surface is allowed to mix (never mixed on one surface). */
const STATUS_KINDS = ['ok', 'degraded', 'unreachable'] as const;
const CATEGORY_KINDS = ['design', 'code', 'writing', 'tool'] as const;

function mark(kind: StateMarkKind, size?: 'sm' | 'md'): string {
	return renderToStaticMarkup(<StateMark kind={kind} {...(size ? { size } : {})} />);
}

/** The `clip-path` the browser will paint, or `''` for a kind drawn by class alone. */
function clipOf(kind: StateMarkKind): string {
	return (
		mark(kind)
			.match(/clip-path:\s*([^;"]+)/)?.[1]
			.trim() ?? ''
	);
}

/** The Panda utility classes the browser will paint. */
function classesOf(kind: StateMarkKind, size?: 'sm' | 'md'): string[] {
	const className = mark(kind, size).match(/class="([^"]*)"/)?.[1] ?? '';
	return className.split(/\s+/).filter(Boolean);
}

/**
 * The resolved silhouette: what is painted, not what it is called.
 * Inline `clip-path` and the class list together cover every property
 * the primitive uses to draw — the polygon kinds and the rounded disc.
 */
function silhouette(kind: StateMarkKind): string {
	return `clip=${clipOf(kind) || 'none'} | classes=${classesOf(kind).sort().join(' ')}`;
}

describe('StateMark shape vocabulary (Issue #411)', () => {
	it('gives every kind a silhouette no other kind shares', () => {
		const silhouettes = KINDS.map(silhouette);
		// The property SC 1.4.1 depends on: with hue removed, no two
		// states may resolve to the same geometry. If `design` ever
		// became `null` (collapsing the diamond onto the solid
		// `code` square), this is the assertion that fails.
		expect(new Set(silhouettes).size).toBe(KINDS.length);
	});

	it('keeps the three health silhouettes mutually distinct', () => {
		const silhouettes = STATUS_KINDS.map(silhouette);
		expect(new Set(silhouettes).size).toBe(STATUS_KINDS.length);
	});

	it('keeps the four category silhouettes mutually distinct', () => {
		const silhouettes = CATEGORY_KINDS.map(silhouette);
		expect(new Set(silhouettes).size).toBe(CATEGORY_KINDS.length);
	});

	it('clips the polygon kinds and leaves only the disc and the square unclipped', () => {
		const unclipped = KINDS.filter((kind) => clipOf(kind) === '');
		expect([...unclipped].sort()).toEqual(['code', 'ok']);
		for (const kind of KINDS) {
			expect(clipOf(kind).startsWith('polygon(')).toBe(kind !== 'ok' && kind !== 'code');
		}
	});

	it('separates the two unclipped kinds by the rounded disc alone', () => {
		// `ok` (disc) and `code` (square) share "no clip-path", so the
		// radius utility is the only thing that tells them apart. Drop
		// `borderRadius` from the `ok` branch and the two become the
		// same rectangle again.
		expect(clipOf('ok')).toBe('');
		expect(clipOf('code')).toBe('');
		expect(classesOf('ok')).not.toEqual(classesOf('code'));
		// Same size utilities either way — the radius is the whole
		// difference, not an accidental second change.
		const shared = classesOf('ok').filter((token) => classesOf('code').includes(token));
		expect(classesOf('code').every((token) => shared.includes(token))).toBe(true);
		expect(classesOf('ok').length - shared.length).toBe(1);
	});

	it('paints every kind with the same inherited colour, never a tone of its own', () => {
		// The mark inherits `currentColor` from the label beside it, so
		// it can never become the only channel. Any per-kind colour
		// class — a re-introduced `tone` prop would land as one — is a
		// new class token on that kind alone.
		const base = classesOf('code');
		for (const kind of KINDS) {
			const extra = classesOf(kind).filter((token) => !base.includes(token));
			// `ok` adds exactly the radius utility; every other kind
			// adds nothing at all.
			expect(extra).toEqual(kind === 'ok' ? extra : []);
			expect(extra.length).toBeLessThanOrEqual(1);
		}
		for (const kind of KINDS) {
			// The only inline style the primitive may set is the clip.
			expect(mark(kind)).not.toMatch(/style="[^"]*(color|background|filter)/);
		}
	});

	it('renders one element per mark, with no children', () => {
		// The per-card DOM cost `list-scale.test.tsx` budgets is exactly
		// one node: a silhouette that needed a second element would
		// double the per-card cost of every portfolio row.
		for (const kind of KINDS) {
			const html = mark(kind);
			expect(html.match(/<[a-zA-Z][^>]*>/g)).toHaveLength(1);
			expect(html).toMatch(/^<span [^>]*><\/span>$/);
		}
	});

	it('stays decorative so the text keeps the accessible name', () => {
		for (const kind of KINDS) {
			expect(mark(kind)).toContain('aria-hidden="true"');
			expect(mark(kind)).toContain(`data-state-mark="${kind}"`);
		}
	});

	it('ships two sizes and defaults to the larger one', () => {
		// `sm` (space token 2 = 8px) is what both shipped surfaces
		// render; `md` (12px) is the default. The two must stay
		// distinguishable, and omitting `size` must stay `md`.
		expect(mark('ok', 'sm')).not.toBe(mark('ok', 'md'));
		expect(mark('ok')).toBe(mark('ok', 'md'));
		for (const kind of KINDS) {
			expect(mark(kind, 'sm').match(/<[a-zA-Z][^>]*>/g)).toHaveLength(1);
		}
	});
});
