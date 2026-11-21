import { css } from '../../styled-system/css';
import { Container } from '../editorial/primitives/Container';
import { focusRing, linkAccent, noteSansSmBody } from '../editorial/primitives/shared-styles';
import type { BilingualText } from '../privacy/data-lifecycle';

/**
 * The compact data-notice pointer for public pages that are not the
 * home footer (Issue #370).
 *
 * Where the copy lives
 * --------------------
 * The sentences are NOT written here. They arrive as props projected
 * by `getCompactPrivacyNotice` (`src/home/privacy/load.ts`), which
 * reads `PUBLIC_COMPACT_DATA_NOTICE` from `src/privacy/data-lifecycle.ts`
 * — the obligation that owns the published wording. This component
 * only decides the shape: one muted line at the foot of the page,
 * ending in a link to the full notice on the home page.
 *
 * Why a pointer and not the registry
 * ----------------------------------
 * `PrivacyNotice` renders the whole `<details>` registry and belongs
 * to the home footer only. Duplicating it on five more pages would
 * repeat ~6 definition rows of retention prose in every document;
 * dropping it entirely is what Issue #370 reports — a visitor who
 * records a reaction on `/about` gets the `mw_actor_id` cookie and a
 * D1 row with no on-page explanation. The one-line pointer keeps the
 * claim next to the surface that causes it and sends the reader to
 * the single full notice (`/#data-notice`, the `id` on the home
 * footer's `<details>`).
 *
 * Fail-closed
 * -----------
 * The component renders the projected copy and nothing else: it
 * imports the registry for TYPES only (`import type` is erased), so
 * no `pending` entry, evidence pointer or classification field can
 * reach the markup through this surface.
 *
 * Language of parts
 * -----------------
 * Same contract as `PrivacyNotice`: the document language is `ja`,
 * so Japanese passages carry no `lang` and every English passage is
 * wrapped in `lang="en"` (`src/i18n/language-of-parts.ts`).
 */
export interface PrivacyNoticeCompactProps {
	readonly statement: BilingualText;
	readonly linkLabel: BilingualText;
}

export function PrivacyNoticeCompact({ statement, linkLabel }: PrivacyNoticeCompactProps) {
	return (
		<div
			data-privacy-notice="compact"
			className={css({
				paddingBlock: '10',
			})}
		>
			<Container>
				<p className={css(noteSansSmBody)}>
					{statement.ja}
					<span lang="en"> {statement.en}</span>
					{' — '}
					<a href="/#data-notice" className={css(linkAccent)}>
						{linkLabel.ja}
						<span lang="en"> {linkLabel.en}</span>
					</a>
				</p>
			</Container>
		</div>
	);
}
