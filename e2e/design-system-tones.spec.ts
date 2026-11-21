import { type Page, expect, test } from '@playwright/test';

/**
 * Tone / variant rendering contract — the browser half (Issue #1110,
 * Epic #1104).
 *
 * `src/editorial/primitives/tone-contract.test.tsx` pins the SSR
 * markup: which element carries the surface class, which carries the
 * `--colors-*` ink rebinds. This spec pins what only a real layout
 * engine can answer, against the `/design-system` tone matrix
 * (`sections/ToneMatrix.tsx`), which renders the full 8-tone ×
 * 7-variant matrix with the PRODUCTION `PageSection` / `Panel`:
 *
 *   - every non-ground tone paints an OPAQUE surface. A class name
 *     with no generated Panda rule computes to `rgba(0,0,0,0)` —
 *     the `field.*` regression exactly;
 *   - a tone surface is never the page canvas (the bands must
 *     separate);
 *   - default ink and muted ink on every tone clear WCAG AA 4.5:1
 *     against the EFFECTIVE surface (the section's own background,
 *     or the page canvas for `ground` / `plain`);
 *   - every non-`plain` Panel variant paints an opaque surface and
 *     its ink clears 4.5:1 — including `field.*` panels nested inside
 *     foreign tones, where the rebinding must still resolve.
 *
 * Pairing contract (layout-system.md §4.3): `surface` / `subtle`
 * panels need the page ladder + normal ink, so they are invalid on
 * `inverse` and the vivid `field.*` tones; `inverse` panels are
 * invalid on `inverse` itself. The spec measures every VALID pair
 * and asserts the invalid ones are not rendered by the matrix.
 *
 * The three defects this gate exists for all produce a contrast or
 * opacity failure here: Panda `css()` dropping `--*` rebinds (ink on
 * ink), `RECORD[prop]` class names with no rule (transparent field
 * cards), and rebinds applied to the background-painting element
 * (the plate painting in its own ink).
 */

const ROUTE = '/design-system';

const TONES = [
	'ground',
	'sunken',
	'raised',
	'inverse',
	'field-design',
	'field-code',
	'field-writing',
	'field-tool',
] as const;

const PANEL_VARIANTS = [
	'surface',
	'subtle',
	'plain',
	'inverse',
	'field-design',
	'field-code',
	'field-writing',
] as const;

/** Panel variants valid per tone (layout-system.md §4.3). */
const FIELD_TONE_VARIANTS = [
	'plain',
	'inverse',
	'field-design',
	'field-code',
	'field-writing',
] as const;
const INVERSE_TONE_VARIANTS = ['plain', 'field-design', 'field-code', 'field-writing'] as const;

/** Non-ground tones must paint a real surface; `plain` panels may not. */
const GROUND_TONE = 'ground';
const TRANSPARENT_VARIANT = 'plain';

function panelsForTone(tone: string): readonly string[] {
	if (tone === 'inverse') return INVERSE_TONE_VARIANTS;
	// `field.tool` shares the sunken map (normal ink), so it keeps the
	// full set; the vivid `field.*` tones carry `onColour` ink, which
	// the dark-mode card steps cannot carry.
	if (tone.startsWith('field-') && tone !== 'field-tool') return FIELD_TONE_VARIANTS;
	return PANEL_VARIANTS;
}

const APPEARANCES = ['light', 'dark'] as const;
type Appearance = (typeof APPEARANCES)[number];

interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

function parseColor(value: string): Rgba {
	const match = /rgba?\(([^)]+)\)/.exec(value);
	if (!match) throw new Error(`unparseable color: ${value}`);
	const parts = match[1].split(',').map((p) => Number.parseFloat(p.trim()));
	return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

function channel(c: number): number {
	const s = c / 255;
	return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance({ r, g, b }: Rgba): number {
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio. Alpha is ignored — callers resolve it first. */
function contrast(a: Rgba, b: Rgba): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

async function inkColor(page: Page, selector: string): Promise<Rgba> {
	const value = await page.locator(selector).evaluate((el) => getComputedStyle(el).color);
	return parseColor(value);
}

async function backgroundColor(page: Page, selector: string): Promise<Rgba> {
	const value = await page.locator(selector).evaluate((el) => getComputedStyle(el).backgroundColor);
	return parseColor(value);
}

test.describe('tone / variant contract (/design-system tone matrix)', () => {
	for (const appearance of APPEARANCES) {
		test(`${appearance}: every tone paints its surface and every ink clears AA`, async ({
			page,
		}) => {
			await page.emulateMedia({ colorScheme: appearance });
			await page.goto(ROUTE);
			await expect(page.getByTestId('tone-matrix-ground')).toBeVisible();

			const canvas = parseColor(
				await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
			);
			expect(canvas.a, 'page canvas must be opaque').toBe(1);

			for (const tone of TONES) {
				const bg = await backgroundColor(page, `[data-testid="tone-matrix-${tone}"]`);

				if (tone === GROUND_TONE) {
					expect(bg.a, `${appearance}/${tone}: ground paints no surface`).toBe(0);
				} else {
					expect(
						bg.a,
						`${appearance}/${tone}: tone surface must be opaque — a class name with no generated rule computes transparent`,
					).toBe(1);
					expect(
						Math.abs(bg.r - canvas.r) + Math.abs(bg.g - canvas.g) + Math.abs(bg.b - canvas.b),
						`${appearance}/${tone}: tone surface must differ from the page canvas`,
					).toBeGreaterThan(8);
				}

				const surface = tone === GROUND_TONE ? canvas : bg;
				for (const probe of ['tone-probe', 'tone-probe-muted']) {
					const ink = await inkColor(page, `[data-testid="${probe}-${tone}"]`);
					const ratio = contrast(ink, surface);
					expect(
						ratio,
						`${appearance}/${tone}/${probe}: ink-on-surface contrast ${ratio.toFixed(2)}:1 must clear 4.5:1`,
					).toBeGreaterThanOrEqual(4.5);
				}

				for (const variant of panelsForTone(tone)) {
					const panelSelector = `[data-testid="panel-${variant}-on-${tone}"]`;
					const panelBg = await backgroundColor(page, panelSelector);
					// A transparent panel sits on the SECTION's surface —
					// for `plain` that is the tone plate itself, not the
					// page canvas `effectiveSurface` would fall back to.
					const panelSurface = panelBg.a > 0 ? panelBg : surface;

					if (variant !== TRANSPARENT_VARIANT) {
						expect(
							panelBg.a,
							`${appearance}/${tone}/panel.${variant}: panel surface must be opaque — missing CSS rule renders transparent`,
						).toBe(1);
					}

					const ink = await inkColor(page, `[data-testid="panel-ink-${variant}-on-${tone}"]`);
					const ratio = contrast(ink, panelSurface);
					expect(
						ratio,
						`${appearance}/${tone}/panel.${variant}: panel ink contrast ${ratio.toFixed(2)}:1 must clear 4.5:1`,
					).toBeGreaterThanOrEqual(4.5);
				}
			}

			// The invalid pairings must stay unrendered: if the matrix
			// ever ships a panel the contract forbids (layout-system.md
			// §4.3) the pairing rules have silently changed.
			const invalidPairs: Array<[string, string]> = [
				['inverse', 'surface'],
				['inverse', 'subtle'],
				['inverse', 'inverse'],
				['field-design', 'surface'],
				['field-design', 'subtle'],
				['field-code', 'surface'],
				['field-code', 'subtle'],
				['field-writing', 'surface'],
				['field-writing', 'subtle'],
			];
			for (const [tone, variant] of invalidPairs) {
				await expect(
					page.getByTestId(`panel-${variant}-on-${tone}`),
					`panel.${variant} on tone=${tone} is an invalid pairing`,
				).toHaveCount(0);
			}
		});
	}
});
