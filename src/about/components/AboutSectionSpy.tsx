import { SectionSpy } from '../../editorial/nav';

/**
 * AboutSectionSpy — the `/about` half of the sticky section index
 * (Issue #1296; mechanism generalized to `SectionSpy` in
 * `src/editorial/nav/` for Issue #1320 so `/stack` can share it
 * without importing this obligation).
 *
 * Why it exists
 * -------------
 * The page runs ~9,600px on mobile across seven numbered sections.
 * The hero's `NarrativeIndex` names the sections once, at the top,
 * and then the reader is inside a section with no signal of where
 * they are or how much is left. The audit's acceptance line is
 * 「長大ページで現在位置が分かる」 — this strip is that signal: a
 * quiet mono row pinned to the top of the viewport that appears
 * once the hero has scrolled away, names the current section, and
 * links every section.
 *
 * This module owns only the SECTION LIST: `SPY_ITEMS` mirrors
 * `NARRATIVE_ORDER` in `AboutPage.tsx`. If a section is added
 * there, add its id here — the two lists are kept adjacent by
 * convention. The strip's behaviour (reading band, visibility,
 * focus-offset publication) lives in `SectionSpy`.
 */

interface SpyItem {
	readonly id: string;
	readonly label: string;
}

/** Mirrors NARRATIVE_ORDER in AboutPage.tsx — keep in sync. */
const SPY_ITEMS: readonly SpyItem[] = [
	{ id: 'identity', label: 'identity' },
	{ id: 'interests', label: 'interests' },
	{ id: 'skills', label: 'skills' },
	{ id: 'experience', label: 'experience' },
	{ id: 'career', label: 'career' },
	{ id: 'current', label: 'current' },
	{ id: 'future', label: 'future' },
];

export function AboutSectionSpy() {
	return (
		<SectionSpy
			items={SPY_ITEMS}
			idKey="id"
			labelKey="label"
			idPrefix="about-section-"
			ariaLabel="Section index"
		/>
	);
}
