import { css } from '../../../../styled-system/css';
import { Stack } from '../../../editorial/primitives/Flow';
import { Grid } from '../../../editorial/primitives/Grid';
import { PageSection } from '../../../editorial/primitives/PageSection';
import { Panel, type PanelVariant } from '../../../editorial/primitives/Panel';
import type { SectionTone } from '../../../editorial/primitives/tone-styles';

/**
 * ToneMatrix — the surface contract rendered, not described
 * (Issue #1110, Epic #1104).
 *
 * Every `SectionTone` gets one real `PageSection` band, and inside
 * each band every `PanelVariant` that the pairing contract allows
 * renders once (layout-system.md §4.3 — on `inverse` only `plain`
 * and `field.*` are valid). `e2e/design-system-tones.spec.ts` then
 * measures computed background, ink and contrast for every allowed
 * combination in both appearances — the exact regressions the tone
 * machinery exists to prevent (Panda dropping `--*` rebinds,
 * recipe-less class names, ink rebinding painted on the
 * background element itself).
 *
 * The bands are real `PageSection`s on purpose: a hand-rolled
 * matrix would keep passing after the primitive broke.
 */

const TONES: readonly SectionTone[] = [
	'ground',
	'sunken',
	'raised',
	'inverse',
	'field.design',
	'field.code',
	'field.writing',
	'field.tool',
];

const PANEL_VARIANTS: readonly PanelVariant[] = [
	'surface',
	'subtle',
	'plain',
	'inverse',
	'field.design',
	'field.code',
	'field.writing',
];

const toneKey = (tone: string) => tone.replaceAll('.', '-');

/**
 * The Panel variants valid on a tone (layout-system.md §4.3).
 * `surface` / `subtle` need the page ladder + normal ink, so they
 * only survive on `ground` / `sunken` / `raised` / `field.tool`;
 * `inverse` additionally retires `inverse` panels (plate-on-plate).
 */
function panelsForTone(tone: SectionTone): readonly PanelVariant[] {
	if (tone === 'inverse') {
		return ['plain', 'field.design', 'field.code', 'field.writing'];
	}
	if (tone !== 'field.tool' && tone.startsWith('field.')) {
		return ['plain', 'inverse', 'field.design', 'field.code', 'field.writing'];
	}
	return PANEL_VARIANTS;
}

export function ToneMatrix() {
	return (
		<>
			{TONES.map((tone, index) => {
				const key = toneKey(tone);
				return (
					<PageSection
						key={tone}
						tone={tone}
						labelledBy={`tone-matrix-${key}`}
						testId={`tone-matrix-${key}`}
						separator={index > 0}
					>
						<Stack gap="4">
							<div>
								<h3
									id={`tone-matrix-${key}`}
									className={css({
										margin: '0',
										fontFamily: 'heading',
										fontSize: 'lg',
										fontWeight: '700',
										color: 'text.default',
									})}
								>
									tone / {tone}
								</h3>
								<p
									className={css({
										margin: '0',
										marginBlockStart: '1',
										fontFamily: 'mono',
										fontSize: 'sm',
										color: 'text.muted',
									})}
								>
									section surface + ink rebind probe
								</p>
							</div>
							<p
								data-testid={`tone-probe-${key}`}
								className={css({
									margin: '0',
									fontFamily: 'sans',
									fontSize: 'md',
									lineHeight: '1.6',
									color: 'text.default',
								})}
							>
								Body probe — 既定の墨がこの面の上で 4.5:1 を満たすこと。Muted copy below must stay
								legible through the same rebind.
							</p>
							<p
								data-testid={`tone-probe-muted-${key}`}
								className={css({
									margin: '0',
									fontFamily: 'sans',
									fontSize: 'xs',
									lineHeight: '1.5',
									color: 'text.muted',
								})}
							>
								Muted probe — 補助の墨も同じ面で読めること。
							</p>
							<Grid columns={4} gap="4">
								{panelsForTone(tone).map((variant) => (
									<Panel
										key={variant}
										variant={variant}
										padding="4"
										radius="md"
										data-testid={`panel-${toneKey(variant)}-on-${key}`}
									>
										<p
											data-testid={`panel-ink-${toneKey(variant)}-on-${key}`}
											className={css({
												margin: '0',
												fontFamily: 'sans',
												fontSize: 'sm',
												lineHeight: '1.5',
												color: 'text.default',
											})}
										>
											{variant} / panel ink probe
										</p>
									</Panel>
								))}
							</Grid>
						</Stack>
					</PageSection>
				);
			})}
		</>
	);
}
