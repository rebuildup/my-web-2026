import { type ReactNode, useEffect, useRef, useState } from 'react';
import { css, cx } from '../../../styled-system/css';
import { Container } from '../primitives/Container';
import { Cluster, listResetClassName } from '../primitives/Flow';
import { focusRing, noteMonoSm } from '../primitives/shared-styles';
import { ScrollRegion } from '../table-code';

/**
 * SectionSpy — the sticky section index for a long single-page
 * surface (Issue #1320; mechanism extracted from the `/about`
 * original, Issue #1296).
 *
 * Why it exists
 * -------------
 * A page that runs many viewport-heights across numbered sections
 * leaves the reader inside a section with no signal of where they
 * are or how much is left. The hero's index names the sections once,
 * at the top; this strip is the positional signal that persists:
 * a quiet mono row pinned to the top of the viewport that appears
 * once the hero has scrolled away, names the current section, and
 * links every section.
 *
 * The component owns the MECHANISM only — which sections exist and
 * what they are called stays with the page that renders it, so the
 * same strip serves `/about` (seven narrative sections) and `/stack`
 * (the stack's committed sections) without either obligation
 * importing the other.
 *
 * Behaviour contract
 * ------------------
 *   - SSR / first paint renders NOTHING visible: `activeId` starts
 *     `null`, so the strip is `visibility: hidden` in the server
 *     document and only fades in after hydration measures scroll
 *     position. No layout shift, no hydration mismatch.
 *   - Visibility is derived, not toggled: the strip shows exactly
 *     when an observed section element occupies the reading band
 *     (IntersectionObserver with a centred root margin). At the top
 *     of the page the hero fills that band, so the strip stays
 *     hidden; inside a section it appears; past the last section
 *     the final entry stays current until the page footer.
 *   - It is a `<nav>` landmark with real anchor links — the same
 *     targets the page's own index uses — so it is a wayfinding
 *     device, not decoration. `aria-current="location"` marks the
 *     active row.
 *   - The observed elements are the ones whose id is
 *     `${idPrefix}${idOf(item)}`; the anchor href is the same id.
 *     The caller's heading elements must carry that id (the
 *     `PageSection`/`SectionHeading` `id` convention).
 */

export interface SectionSpyProps<T> {
	/** The sections to index, in page order. */
	readonly items: readonly T[];
	/**
	 * Key on `T` carrying the section's id suffix — appended to
	 * `idPrefix` for both the observed element id and the anchor
	 * href.
	 */
	readonly idKey: keyof T & string;
	/** Key on `T` carrying the visible row label (rendered as text). */
	readonly labelKey: keyof T & string;
	/**
	 * Element-id prefix shared by the observed headings and the
	 * anchors, e.g. `about-section-` / `stack-section-`.
	 */
	readonly idPrefix: string;
	/** Landmark label; defaults to the shared "Section index". */
	readonly ariaLabel?: string;
}

/**
 * The custom property this overlay publishes for the document's scroll
 * compensation (`src/styles.css` `scroll-padding`). Declared HERE, not
 * imported, because `scripts/check-a11y-focus-visible.mjs` closes the
 * chain only when the overlay's OWN file publishes the offset it
 * occupies (SC 2.4.11 — a focused element scrolled to the top edge
 * would sit under this strip). One property serves every page: only
 * one document renders at a time, so the publisher never competes
 * with itself.
 */
const FOCUS_OFFSET_PROPERTY = '--section-spy-offset';

export function SectionSpy<T>({
	items,
	idKey,
	labelKey,
	idPrefix,
	ariaLabel = 'Section index',
}: SectionSpyProps<T>) {
	const [activeId, setActiveId] = useState<string | null>(null);
	const navRef = useRef<HTMLElement>(null);

	// The observed id list as a stable string: `items` identity can
	// change between renders without the SECTION SET changing, and
	// re-subscribing the observer on every render would be wasted
	// work. The join is the dependency, not the array.
	const sectionKey = items.map((item) => String(item[idKey])).join('\n');

	useEffect(() => {
		const ids = sectionKey === '' ? [] : sectionKey.split('\n');
		const elements = ids
			.map((id) => document.getElementById(`${idPrefix}${id}`))
			.filter((el): el is HTMLElement => el !== null);
		if (elements.length === 0 || typeof IntersectionObserver === 'undefined') return;

		// The "reading band": the middle ~45% of the viewport. A
		// section counts as current while it occupies that band, so
		// the strip names where the reader's eye actually is rather
		// than whichever section happens to touch the top edge.
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						setActiveId(entry.target.id.slice(idPrefix.length));
					}
				}
			},
			{ rootMargin: '-30% 0px -55% 0px' },
		);
		for (const el of elements) observer.observe(el);
		return () => observer.disconnect();
		// `idKey`/`labelKey` are literal keys chosen by the caller; the
		// section set is fully described by `sectionKey` + `idPrefix`.
	}, [sectionKey, idPrefix]);

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
			aria-label={ariaLabel}
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
				<ScrollRegion label="Sections" className={css({ scrollbarWidth: 'none' })}>
					<Cluster as="ul" gap="6" className={cx(listResetClassName, css({ flexWrap: 'nowrap' }))}>
						{items.map((item, index) => {
							const id = String(item[idKey]);
							const active = id === activeId;
							const label = item[labelKey];
							return (
								<li key={id} className={css({ flexShrink: '0' })}>
									<a
										href={`#${idPrefix}${id}`}
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
										<span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
										{label as ReactNode}
									</a>
								</li>
							);
						})}
					</Cluster>
				</ScrollRegion>
			</Container>
		</nav>
	);
}
