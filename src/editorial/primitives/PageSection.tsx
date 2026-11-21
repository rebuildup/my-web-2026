import type { ReactNode } from 'react';
import { css, cva, cx } from '../../../styled-system/css';
import { Container } from './Container';
import { type SectionTone, SectionToneContext, toneRebinds } from './tone-styles';

/**
 * PageSection — the only owner of section-level surface decisions
 * (ADR-0022 C-1/C-3, layout-system.md §3–§4).
 *
 * Owns: the `<section>` element, `aria-labelledby` wiring, the rhythm
 * `paddingBlock`, the `tone` surface (with its ink rebinding), and an
 * optional full-width hairline separator. Renders `Container`
 * internally so content always sits on the canonical 1024 px measure.
 *
 * Feature code composes inside it; it never sets section padding,
 * page background or a section-separating rule by hand.
 */

export type SectionRhythm = 'hero' | 'body' | 'closing';

export interface PageSectionProps {
	/** Surface tone — closed vocabulary, see `tone-styles.ts`. */
	tone?: SectionTone;
	/**
	 * Rhythm role. `hero` is the page entry (one per page); `body` and
	 * `closing` share the standard beat. The beat comes from the
	 * section's role, never its density.
	 */
	rhythm?: SectionRhythm;
	/**
	 * `id` of the section's heading element. Pairs with
	 * `SectionHeading`'s `id` prop to wire `aria-labelledby`.
	 */
	labelledBy?: string;
	/** Full-width hairline above the section (e.g. before a closing band). */
	separator?: boolean;
	/** `data-testid` hook for e2e/integration selectors. */
	testId?: string;
	className?: string;
	children?: ReactNode;
}

const RHYTHM_PADDING: Record<SectionRhythm, { base: string; lg: string }> = {
	hero: { base: '16', lg: '32' },
	body: { base: '16', lg: '24' },
	closing: { base: '16', lg: '24' },
};

// The tone → surface map is a `cva` recipe, not a lookup record:
// Panda resolves recipe variants statically, while a
// `RECORD[prop]` indirection can emit the class name with no rule
// behind it — the `field.*` tones had no generated background until
// the map moved here (Issue #1110).
const sectionRecipe = cva({
	variants: {
		tone: {
			ground: {},
			sunken: { backgroundColor: 'bg.subtle' },
			raised: { backgroundColor: 'bg.surface' },
			inverse: { backgroundColor: 'bg.inverse' },
			'field.design': { backgroundColor: 'accent.field.design' },
			'field.code': { backgroundColor: 'accent.field.code' },
			'field.writing': { backgroundColor: 'accent.field.writing' },
			'field.tool': { backgroundColor: 'bg.subtle' },
		},
	},
	defaultVariants: { tone: 'ground' },
});

export function PageSection({
	tone = 'ground',
	rhythm = 'body',
	labelledBy,
	separator = false,
	testId,
	className,
	children,
}: PageSectionProps) {
	const content = <Container>{children}</Container>;
	return (
		<section
			aria-labelledby={labelledBy}
			data-testid={testId}
			className={cx(
				css({
					paddingBlock: RHYTHM_PADDING[rhythm],
					borderTop: separator ? '1px solid' : undefined,
					borderTopColor: separator ? 'border.subtle' : undefined,
				}),
				sectionRecipe({ tone }),
				className,
			)}
		>
			{/* The rebinding wraps the CONTENT, never the section element
			    itself: several rebinds retarget the very vars the tone's
			    own `backgroundColor` reads (`bg.inverse` → ink-inverse),
			    so applying them here painted the plate in its own ink —
			    light-on-light (Issue #1110). The tone context lets `Panel`
			    refuse pairings the contract forbids (layout-system.md §4.3). */}
			<SectionToneContext.Provider value={tone}>
				{tone === 'ground' ? content : <div style={toneRebinds(tone)}>{content}</div>}
			</SectionToneContext.Provider>
		</section>
	);
}
