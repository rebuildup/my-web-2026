import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageSection } from './PageSection';
import { Panel, type PanelVariant } from './Panel';
import { type SectionTone, toneRebinds } from './tone-styles';

/**
 * Tone / variant rendering contract (Issue #1110, Epic #1104).
 *
 * The defects this file guards are all "the class name shipped but the
 * paint did not":
 *
 *   - Panda's `css()` drops `--*` keys, so a tone rebinding spread into
 *     a style object emitted NOTHING and inverse / field surfaces
 *     rendered with page ink (ink-on-ink);
 *   - a `RECORD[prop]` lookup emitted the right class name with no
 *     generated rule behind it, leaving `field.*` cards transparent;
 *   - applying the rebinding to the element that paints the tone
 *     background retargets the very var that background reads, so the
 *     plate painted in its own ink.
 *
 * SSR markup is the cheapest place all three are visible: the surface
 * class, the inline `--colors-*` rebinds and WHICH element carries
 * each. Computed style, contrast and rule generation are verified in
 * the real browser by `e2e/design-system-tones.spec.ts` against the
 * `/design-system` tone matrix — this file is the fast gate that runs
 * in `pnpm test`.
 */

interface ToneExpectation {
	/** Atomic background class the section must carry (null = ground). */
	bgClass: string | null;
	/** A `--colors-*` declaration the rebind wrapper must contain. */
	rebindProbe: string | null;
}

const TONE_EXPECTATIONS: Record<SectionTone, ToneExpectation> = {
	ground: { bgClass: null, rebindProbe: null },
	sunken: {
		bgClass: 'bg-c_bg.subtle',
		rebindProbe: '--colors-bg-canvas:var(--colors-mono-surface-sunken)',
	},
	raised: {
		bgClass: 'bg-c_bg.surface',
		rebindProbe: '--colors-bg-canvas:var(--colors-mono-surface-raised)',
	},
	inverse: {
		bgClass: 'bg-c_bg.inverse',
		rebindProbe: '--colors-text-default:var(--colors-mono-ink-inverse)',
	},
	'field.design': {
		bgClass: 'bg-c_accent.field.design',
		rebindProbe: '--colors-mono-ink-on-colour-inverse:var(--colors-mono-ink-on-colour)',
	},
	'field.code': {
		bgClass: 'bg-c_accent.field.code',
		rebindProbe: '--colors-mono-ink-on-colour-inverse:var(--colors-mono-ink-on-colour)',
	},
	'field.writing': {
		bgClass: 'bg-c_accent.field.writing',
		rebindProbe: '--colors-mono-ink-on-colour-inverse:var(--colors-mono-ink-on-colour)',
	},
	'field.tool': {
		bgClass: 'bg-c_bg.subtle',
		rebindProbe: '--colors-bg-canvas:var(--colors-mono-surface-sunken)',
	},
};

const SECTION_TONES = Object.keys(TONE_EXPECTATIONS) as SectionTone[];

/** The `<section …>` open tag of the rendered PageSection. */
function sectionOpenTag(html: string): string {
	const match = /^<section[^>]*>/.exec(html);
	expect(match, 'PageSection must render a <section> as its root').not.toBeNull();
	return match?.[0] ?? '';
}

/** The first inner `<div …>` open tag — the tone rebind wrapper. */
function firstInnerDivOpenTag(html: string): string | null {
	const match = /<div[^>]*>/.exec(html.slice(html.indexOf('>') + 1));
	return match?.[0] ?? null;
}

describe('PageSection — tone surface contract', () => {
	for (const tone of SECTION_TONES) {
		it(`tone="${tone}" paints its surface and rebinds ink on the content wrapper`, () => {
			const html = renderToStaticMarkup(
				<PageSection tone={tone} labelledBy="tone-heading">
					<p>probe</p>
				</PageSection>,
			);
			const expectation = TONE_EXPECTATIONS[tone];
			const openTag = sectionOpenTag(html);

			if (expectation.bgClass === null) {
				expect(openTag).not.toMatch(/bg-c_/);
			} else {
				expect(openTag).toContain(expectation.bgClass);
			}

			// The rebind wrapper must be a DIFFERENT element from the one
			// painting the background: putting `--colors-*` on the section
			// itself retargets the var its own `backgroundColor` reads.
			expect(openTag).not.toContain('style=');

			const inner = firstInnerDivOpenTag(html);
			if (expectation.rebindProbe === null) {
				// ground rebinds nothing: content sits directly in Container.
				expect(inner).not.toContain('--colors-');
			} else {
				expect(inner, `tone="${tone}" must wrap content in a rebind div`).not.toBeNull();
				expect(inner).toContain('style=');
				expect(inner).toContain(expectation.rebindProbe);
			}
		});
	}

	it('every non-ground tone rebinds exactly the vars toneRebinds() declares', () => {
		for (const tone of SECTION_TONES) {
			const html = renderToStaticMarkup(
				<PageSection tone={tone}>
					<p>x</p>
				</PageSection>,
			);
			const declared = toneRebinds(tone) as Record<string, string>;
			const keys = Object.keys(declared);
			if (keys.length === 0) {
				expect(firstInnerDivOpenTag(html)).not.toContain('--colors-');
				continue;
			}
			const inner = firstInnerDivOpenTag(html) ?? '';
			for (const [prop, value] of Object.entries(declared)) {
				expect(inner, `${tone}: missing rebind ${prop}`).toContain(`${prop}:${value}`);
			}
		}
	});
});

const PANEL_VARIANTS: PanelVariant[] = [
	'surface',
	'subtle',
	'plain',
	'inverse',
	'field.design',
	'field.code',
	'field.writing',
];

const PANEL_EXPECTATIONS: Record<PanelVariant, ToneExpectation> = {
	surface: { bgClass: 'bg-c_bg.surface', rebindProbe: null },
	subtle: { bgClass: 'bg-c_bg.subtle', rebindProbe: null },
	plain: { bgClass: 'bg-c_transparent', rebindProbe: null },
	inverse: {
		bgClass: 'bg-c_bg.inverse',
		rebindProbe: '--colors-text-default:var(--colors-mono-ink-inverse)',
	},
	'field.design': {
		bgClass: 'bg-c_accent.field.design',
		rebindProbe: '--colors-mono-ink-on-colour-inverse:var(--colors-mono-ink-on-colour)',
	},
	'field.code': {
		bgClass: 'bg-c_accent.field.code',
		rebindProbe: '--colors-mono-ink-on-colour-inverse:var(--colors-mono-ink-on-colour)',
	},
	'field.writing': {
		bgClass: 'bg-c_accent.field.writing',
		rebindProbe: '--colors-mono-ink-on-colour-inverse:var(--colors-mono-ink-on-colour)',
	},
};

describe('Panel — variant surface contract', () => {
	for (const variant of PANEL_VARIANTS) {
		it(`variant="${variant}" paints its surface and rebinds ink on the content wrapper`, () => {
			const html = renderToStaticMarkup(<Panel variant={variant}>probe</Panel>);
			const expectation = PANEL_EXPECTATIONS[variant];
			const openTag = /^<div[^>]*>/.exec(html)?.[0] ?? '';

			expect(openTag).toContain(expectation.bgClass ?? 'bg-c_');
			// Same self-reference rule as PageSection: the painting
			// element never carries the rebind custom properties.
			expect(openTag).not.toContain('style=');

			const inner = firstInnerDivOpenTag(html);
			if (expectation.rebindProbe === null) {
				// surface / subtle / plain rebind nothing: children render
				// directly inside the panel element.
				expect(html).not.toContain('--colors-');
			} else {
				expect(inner).toContain(expectation.rebindProbe);
			}
		});
	}
});

describe('tone machinery — closed vocabulary', () => {
	it('toneRebinds only ever emits --colors-* custom properties', () => {
		for (const tone of SECTION_TONES) {
			for (const key of Object.keys(toneRebinds(tone))) {
				expect(key).toMatch(/^--colors-/);
			}
		}
	});

	it('the rebind key set is non-empty for every tone but ground', () => {
		for (const tone of SECTION_TONES) {
			const keys = Object.keys(toneRebinds(tone));
			if (tone === 'ground') {
				expect(keys).toEqual([]);
			} else {
				expect(keys.length).toBeGreaterThan(0);
			}
		}
	});
});
