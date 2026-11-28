import { useEffect, useRef, useState } from 'react';
import { css, cx } from '../../../styled-system/css';
import { Container } from '../../editorial/primitives/Container';
import { Cluster, listResetClassName } from '../../editorial/primitives/Flow';
import { focusRing, noteMonoSm } from '../../editorial/primitives/shared-styles';

/**
 * AboutSectionSpy — the sticky section index for the long `/about`
 * page (Issue #1296).
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
 * Behaviour contract
 * ------------------
 *   - SSR / first paint renders NOTHING visible: `activeId` starts
 *     `null`, so the strip is `visibility: hidden` in the server
 *     document and only fades in after hydration measures scroll
 *     position. No layout shift, no hydration mismatch.
 *   - Visibility is derived, not toggled: the strip shows exactly
 *     when an `about-section-*` element occupies the reading band
 *     (IntersectionObserver with a centred root margin). At the top
 *     of the page the hero fills that band, so the strip stays
 *     hidden; inside a section it appears; past the last section
 *     the final entry stays current until the footer.
 *   - It is a `<nav>` landmark with real anchor links — the same
 *     targets the hero index uses — so it is a wayfinding device,
 *     not decoration. `aria-current="location"` marks the active
 *     row.
 *   - It owns no data: the section list mirrors `NARRATIVE_ORDER`
 *     in `AboutPage.tsx`. If a section is added there, add its id
 *     here — the two lists are kept adjacent by convention.
 */

interface SpyItem {
	readonly id: string;
	readonly number: string;
	readonly label: string;
}

/** Mirrors NARRATIVE_ORDER in AboutPage.tsx — keep in sync. */
const SPY_ITEMS: readonly SpyItem[] = [
	{ id: 'identity', number: '01', label: 'identity' },
	{ id: 'interests', number: '02', label: 'interests' },
	{ id: 'skills', number: '03', label: 'skills' },
	{ id: 'experience', number: '04', label: 'experience' },
	{ id: 'career', number: '05', label: 'career' },
	{ id: 'current', number: '06', label: 'current' },
	{ id: 'future', number: '07', label: 'future' },
];

const SECTION_ID_PREFIX = 'about-section-';

/**
 * The custom property this overlay publishes for the document's scroll
 * compensation (`src/styles.css` `scroll-padding`). Declared HERE, not
 * imported, because `scripts/check-a11y-focus-visible.mjs` closes the
 * chain only when the overlay's OWN file publishes the offset it
 * occupies (SC 2.4.11 — a focused element scrolled to the top edge
 * would sit under this strip).
 */
const FOCUS_OFFSET_PROPERTY = '--about-section-spy-offset';

export function AboutSectionSpy() {
	const [activeId, setActiveId] = useState<string | null>(null);
	const navRef = useRef<HTMLElement>(null);

	useEffect(() => {
		const elements = SPY_ITEMS.map((item) =>
			document.getElementById(`${SECTION_ID_PREFIX}${item.id}`),
		).filter((el): el is HTMLElement => el !== null);
		if (elements.length === 0 || typeof IntersectionObserver === 'undefined') return;

		// The "reading band": the middle ~45% of the viewport. A
		// section counts as current while it occupies that band, so
		// the strip names where the reader's eye actually is rather
		// than whichever section happens to touch the top edge.
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						setActiveId(entry.target.id.slice(SECTION_ID_PREFIX.length));
					}
				}
			},
			{ rootMargin: '-30% 0px -55% 0px' },
		);
		for (const el of elements) observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const visible = activeId !== null;

	// Publish the strip's height while it is shown so the document can
	// keep a focused element clear of the top edge (SC 2.4.11). While
	// hidden the property is absent and the compensation reserves
	// nothing — the strip occupies no visible band at the top of the
	// page.
	useEffect(() => {
		const nav = navRef.current;
		const root = document.documentElement;
		if (!nav || !visible) {
			root.style.removeProperty(FOCUS_OFFSET_PROPERTY);
			return;
		}
		const publish = () => {
			const { height } = nav.getBoundingClientRect();
			root.style.setProperty(FOCUS_OFFSET_PROPERTY, `${Math.ceil(height)}px`);
		};
		publish();
		if (typeof ResizeObserver === 'undefined') {
			return () => root.style.removeProperty(FOCUS_OFFSET_PROPERTY);
		}
		const observer = new ResizeObserver(publish);
		observer.observe(nav);
		return () => {
			observer.disconnect();
			root.style.removeProperty(FOCUS_OFFSET_PROPERTY);
		};
	}, [visible]);

	return (
		<nav
			ref={navRef}
			aria-label="Section index"
			data-section-spy={visible ? 'visible' : 'hidden'}
			className={css({
				position: 'fixed',
				top: '0',
				insetInline: '0',
				zIndex: '20',
				backgroundColor: 'bg.surface',
				borderBottomWidth: '1px',
				borderBottomStyle: 'solid',
				borderBottomColor: 'border.subtle',
				visibility: visible ? 'visible' : 'hidden',
			})}
		>
			<Container>
				<Cluster
					as="ul"
					gap="6"
					aria-label="Sections"
					className={cx(
						listResetClassName,
						css({
							flexWrap: 'nowrap',
							overflowX: 'auto',
							scrollbarWidth: 'none',
						}),
					)}
				>
					{SPY_ITEMS.map((item) => {
						const active = item.id === activeId;
						return (
							<li key={item.id} className={css({ flexShrink: '0' })}>
								<a
									href={`#${SECTION_ID_PREFIX}${item.id}`}
									aria-current={active ? 'location' : undefined}
									className={css({
										...noteMonoSm,
										display: 'inline-flex',
										alignItems: 'baseline',
										gap: '1',
										color: active ? 'text.default' : 'text.muted',
										textDecoration: 'none',
										_hover: { color: 'text.default' },
										_focusVisible: focusRing,
									})}
								>
									<span aria-hidden="true">{item.number}</span>
									{item.label}
								</a>
							</li>
						);
					})}
				</Cluster>
			</Container>
		</nav>
	);
}
