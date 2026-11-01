import { useLocation } from '@tanstack/react-router';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { css } from '../../../styled-system/css';

/**
 * PublicNav — site-wide chrome for every public route (Issue #168).
 *
 * Surfaces the five canonical public surfaces (`/`, `/portfolio`,
 * `/tools`, `/about`, `/contact`) so a visitor can reach any of
 * them in one click from any other public route. Mounted in
 * `src/routes/__root.tsx` and gated there on `pathname !==
 * '/admin/...'` — the admin area keeps its own chrome.
 *
 * Accessibility contract:
 *
 *   - `<nav aria-label="Public">` is the only top-level landmark.
 *   - The desktop strip and the mobile panel are real lists: every
 *     entry is an `<li>` inside the `<ul>` (WCAG 2.2 SC 1.3.1 —
 *     Issue #718). The link text itself never changes.
 *   - The active route is announced via `aria-current="page"` on the
 *     matching `<a>`. Active styling is colour + weight + underline;
 *     the `aria-current` attribute is the programmatic signal so
 *     screen readers identify it independently of the visual cue.
 *   - The compact menu takes over when the Japanese roster no longer
 *     fits one line — below 44em of the nav's own font size (Issue
 *     #777). That threshold is a container query, not a viewport
 *     breakpoint, so it follows the reader's text size: the strip
 *     never wraps onto a second row.
 *   - The compact menu is a `<button>` with `aria-expanded` /
 *     `aria-controls`. The panel
 *     is closed by default; `Escape` and a route change both close
 *     it; clicking a link inside the panel closes it as well.
 *     `Escape` hands the focus back to the trigger, so closing the
 *     panel never strands the focus on the document body (Issue #394).
 *     The
 *     hamburger button is always rendered so the affordance is
 *     predictable across viewports — only its `display` changes.
 *   - The brand mark on the left ("samuido") is part of the same
 *     nav landmark, links to `/`, and carries the `<h1>`-equivalent
 *     visual weight (its actual tag is `<a>`, since the page hero
 *     already owns the canonical h1).
 *
 * The nav is part of the editorial visual language, so it lives
 * under `src/editorial/` alongside `Container` and `SectionHeading`
 * (per AGENTS.md §3: `editorial` owns the shipped visual chrome).
 * The component is presentational — it reads only the router state
 * (`useLocation`) and emits `<a>` clicks; no data, no server fns.
 */

export interface PublicNavItem {
	/** Internal route. */
	to: string;
	/** Japanese label — first-class on Japanese-language pages. */
	labelJa: string;
	/** English label — secondary, set in the typographic eyebrow voice. */
	labelEn: string;
}

/**
 * Canonical nav roster. Order matters — left-to-right on desktop,
 * top-to-bottom on mobile. Order is editorial, not alphabetical.
 *
 * `/` sits first because it is the platform entry; `/contact` sits
 * last because it is the lowest-friction action ("just send me a
 * note"). The other three (Portfolio / Tools / About) are arranged
 * by the same left-to-right discovery order they appear in the home
 * hero / capabilities section.
 */
export const PUBLIC_NAV_ITEMS: ReadonlyArray<PublicNavItem> = [
	{ to: '/', labelJa: 'ホーム', labelEn: 'Home' },
	{ to: '/portfolio', labelJa: 'ポートフォリオ', labelEn: 'Portfolio' },
	{ to: '/tools', labelJa: 'ツール', labelEn: 'Tools' },
	{ to: '/about', labelJa: '自己紹介', labelEn: 'About' },
	{ to: '/contact', labelJa: 'お問い合わせ', labelEn: 'Contact' },
	{ to: '/design-system', labelJa: 'デザインシステム', labelEn: 'Design system' },
];

/**
 * Pure predicate — exported for unit testing so the active-route
 * rule can be checked without rendering the full component.
 *
 * Rules:
 *   - `/` is active only when the current path is exactly `/`
 *     (otherwise every page would highlight Home as well).
 *   - `/<segment>` is active when the current path is exactly the
 *     segment OR starts with `/<segment>/`. This covers both
 *     `/tools` and `/tools/prototype`.
 *
 * @param currentPath - `location.pathname`, e.g. `/about` or `/tools/prototype`
 * @param target      - one of `PUBLIC_NAV_ITEMS[*].to`
 */
export function isActiveRoute(currentPath: string, target: string): boolean {
	if (target === '/') return currentPath === '/';
	if (currentPath === target) return true;
	return currentPath.startsWith(`${target}/`);
}

export interface PublicNavProps {
	/**
	 * Override the rendered pathname. Defaults to `useLocation()`.
	 * Provided so unit tests / Storybook can drive the component
	 * without wrapping it in a router.
	 */
	currentPath?: string;
}

const NAV_LABEL_TEXT = 'Public';

/**
 * Width, in the nav's own `em`, at or above which the desktop strip
 * renders and the compact menu steps out (Issue #777).
 *
 * The threshold is expressed in `em` and asked of a CONTAINER query,
 * not the viewport, because the failure it prevents is a *text* one:
 * at the reader's 110% text size the six-item strip needed more room
 * than the bar had and `flex-wrap` split it into two rows. A viewport
 * `@media` query cannot see that — its `em` resolves against the
 * initial font size, so it keeps reporting the same pixel width while
 * the labels grow. A container query's `em` resolves against this
 * nav's own computed font size, so 44em is ~704px at 100% and
 * ~1408px at 200%: the roster collapses into the menu exactly when it
 * would no longer fit on one line.
 *
 * 44em is the smallest value that fits the six labels plus the brand,
 * the row gap and the editorial padding at 100% text size.
 */
export const NAV_STRIP_QUERY = '@container (min-width: 44em)';

/**
 * Header bar + collapsible mobile panel. See module docstring for
 * the full accessibility contract.
 */
export function PublicNav({ currentPath }: PublicNavProps = {}) {
	const location = useLocation();
	const resolvedPath = currentPath ?? location.pathname;
	const [menuOpen, setMenuOpen] = useState(false);
	const menuId = useId();
	const buttonId = useId();
	// The trigger keeps a ref so `Escape` can hand the focus back to it
	// (Issue #394). Closing the panel while the focus sits inside it
	// removes the focused element from the accessibility tree, and the
	// browser would drop the focus to the document body — the visitor
	// would have to rediscover the trigger. The trigger itself is always
	// rendered, so it is a valid focus target at any viewport.
	const buttonRef = useRef<HTMLButtonElement>(null);
	// Set only when `Escape` closed the menu, so the focus hand-back
	// runs for that gesture and for nothing else.
	//
	// The focus is restored AFTER the DOM update (the panel's
	// `hidden`): hiding the panel can drop the focus to the document
	// body when the hidden subtree still held it, so restoring before
	// the update would restore a focus that the update then takes
	// away. Issue #394's keyboard regression spec observed that race.
	const restoreFocusRef = useRef(false);

	const closeMenu = useCallback(() => setMenuOpen(false), []);

	// Close the mobile menu whenever the route changes — the
	// visitor has clicked a link, the panel must not stay open over
	// the new page. TanStack Router does not unmount the nav on
	// navigation, so an effect is the only reliable signal.
	// biome-ignore lint/correctness/useExhaustiveDependencies: the effect body is intentionally pure (no reads of `resolvedPath`) but must re-run on every route change.
	useEffect(() => {
		setMenuOpen(false);
	}, [resolvedPath]);

	// `Escape` closes the mobile menu when it is open. The handler
	// is mounted at all times but only acts when `menuOpen` is
	// true, so desktop users are not affected.
	//
	// The focus goes back to the trigger: closing the panel hides the
	// element that had the focus, and without this the focus would be
	// lost to the document body (WCAG 2.2 SC 2.4.3 Focus Order /
	// SC 2.1.2 No Keyboard Trap). Issue #394's keyboard regression
	// spec asserts this hand-back.
	useEffect(() => {
		if (!menuOpen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				restoreFocusRef.current = true;
				setMenuOpen(false);
			}
		};
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [menuOpen]);

	// The focus hand-back runs after the panel is actually hidden, so
	// the browser cannot move it to the document body afterwards.
	useEffect(() => {
		if (menuOpen) return;
		if (!restoreFocusRef.current) return;
		restoreFocusRef.current = false;
		buttonRef.current?.focus();
	}, [menuOpen]);

	return (
		<nav
			aria-label={NAV_LABEL_TEXT}
			className={css({
				borderBlockEndWidth: '1px',
				borderBlockEndColor: 'border.subtle',
				borderBlockEndStyle: 'solid',
				backgroundColor: 'bg.canvas',
				// Issue #777: the strip's collapse threshold is a
				// container query (see NAV_STRIP_QUERY), so the nav is
				// the query container for the strip, the trigger and the
				// panel alike.
				containerType: 'inline-size',
			})}
		>
			<div
				className={css({
					width: '100%',
					// Issue #777: rem, not px. The bar used to stay 1024px
					// while every label grew with the reader's text size,
					// so the chrome was the only thing on the page that
					// did not scale with its own contents.
					maxWidth: '64rem',
					marginInline: 'auto',
					paddingInline: { base: '4', md: '6', lg: '8' },
					paddingBlock: { base: '3', md: '4' },
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'space-between',
					gap: '4',
				})}
			>
				<a
					href="/"
					aria-label="samuido — Home"
					className={css({
						display: 'inline-flex',
						alignItems: 'baseline',
						gap: '2',
						fontFamily: 'heading',
						fontSize: 'lg',
						fontWeight: '700',
						letterSpacing: '-0.02em',
						color: 'text.default',
						textDecoration: 'none',
						_focusVisible: {
							outline: '2px solid {colors.border.focus}',
							outlineOffset: '2px',
							borderRadius: '2px',
						},
						_hover: {
							color: 'text.accent',
						},
					})}
				>
					samuido
				</a>

				{/* Desktop nav — visible at md and above. */}
				<ul
					data-testid="public-nav-desktop"
					className={css({
						display: 'none',
						margin: '0',
						padding: '0',
						listStyle: 'none',
						// Issue #777: one gap, one line. The strip has no
						// second row to fall back to — when 44em of text
						// does not fit, it is not rendered at all and the
						// compact menu takes over (see NAV_STRIP_QUERY).
						// `flex-wrap: nowrap` makes that contract
						// explicit: a reader never sees the roster split
						// across two lines.
						gap: '5',
						flexWrap: 'nowrap',
						alignItems: 'center',
						[NAV_STRIP_QUERY]: { display: 'flex' },
					})}
				>
					{/* Issue #718: the desktop strip is a real list, so every
					    entry is an `<li>` (WCAG 2.2 SC 1.3.1 — a `<ul>` may
					    only contain `<li>`). The `<li>` is `display: flex` so
					    the link keeps exactly the box it had when the `<a>`
					    was the flex item itself: the `<li>` generates no
					    line box, so the row's height, the item widths and
					    the wrap threshold are unchanged. */}
					{PUBLIC_NAV_ITEMS.map((item) => (
						<li key={item.to} className={css({ display: 'flex' })}>
							<NavLink item={item} isActive={isActiveRoute(resolvedPath, item.to)} />
						</li>
					))}
				</ul>

				{/* Mobile menu toggle — visible below md. Always
				    rendered (not conditionally mounted) so the
				    `aria-expanded` / `aria-controls` wiring is
				    stable and the hamburger affordance is predictable
				    even while the panel is closed. */}
				<button
					id={buttonId}
					ref={buttonRef}
					type="button"
					aria-label={menuOpen ? 'Close menu' : 'Open menu'}
					aria-expanded={menuOpen}
					aria-controls={menuId}
					onClick={() => setMenuOpen((open) => !open)}
					className={css({
						display: 'inline-flex',
						alignItems: 'center',
						justifyContent: 'center',
						gap: '2',
						height: '9',
						paddingInline: '3',
						borderRadius: 'md',
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: 'border.subtle',
						backgroundColor: 'bg.canvas',
						color: 'text.default',
						fontFamily: 'sans',
						fontSize: 'sm',
						fontWeight: '600',
						cursor: 'pointer',
						// Issue #777: the trigger and the strip are two
						// faces of the same decision, so both read the
						// same container query.
						[NAV_STRIP_QUERY]: { display: 'none' },
						_focusVisible: {
							outline: '2px solid {colors.border.focus}',
							outlineOffset: '2px',
						},
					})}
				>
					<span aria-hidden="true">{menuOpen ? '✕' : '☰'}</span>
					<span>{menuOpen ? 'Close' : 'Menu'}</span>
				</button>
			</div>

			{/* Mobile panel — collapsed by default; opens when
			    `menuOpen` is true. Hidden entirely (with `hidden`
			    attribute) when closed so it cannot receive focus
			    order. */}
			<div
				id={menuId}
				hidden={!menuOpen}
				data-testid="public-nav-mobile-panel"
				className={css({
					borderBlockStartWidth: '1px',
					borderBlockStartColor: 'border.subtle',
					borderBlockStartStyle: 'solid',
					paddingInline: { base: '4', md: '6' },
					paddingBlock: '4',
					[NAV_STRIP_QUERY]: { display: 'none' },
				})}
			>
				<ul
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '1',
						margin: '0',
						padding: '0',
						listStyle: 'none',
					})}
				>
					{PUBLIC_NAV_ITEMS.map((item) => (
						<li key={item.to}>
							<NavLink
								item={item}
								isActive={isActiveRoute(resolvedPath, item.to)}
								onNavigate={closeMenu}
								variant="mobile"
							/>
						</li>
					))}
				</ul>
			</div>
		</nav>
	);
}

interface NavLinkProps {
	item: PublicNavItem;
	isActive: boolean;
	/**
	 * Optional click handler invoked AFTER the browser has handled
	 * the navigation. The mobile menu uses this to close itself
	 * after a link is tapped.
	 */
	onNavigate?: () => void;
	/**
	 * `desktop` (default) renders the Japanese label alone in the
	 * horizontal strip; `mobile` renders a full-width row that also
	 * carries the EN eyebrow (Issue #777).
	 */
	variant?: 'desktop' | 'mobile';
}

/**
 * Single nav link. The component is shared between the desktop
 * strip and the mobile panel — the only difference is the visual
 * treatment (`variant`). Both variants carry the same
 * `aria-current` semantics.
 */
function NavLink({ item, isActive, onNavigate, variant = 'desktop' }: NavLinkProps) {
	const isMobile = variant === 'mobile';
	return (
		<a
			href={item.to}
			aria-current={isActive ? 'page' : undefined}
			aria-label={`${item.labelJa} / ${item.labelEn}`}
			onClick={onNavigate}
			className={css({
				display: 'inline-flex',
				alignItems: 'center',
				gap: '2',
				fontFamily: 'sans',
				fontSize: isMobile ? 'md' : 'sm',
				fontWeight: '600',
				color: isActive ? 'text.default' : 'text.muted',
				textDecoration: 'none',
				// Issue #300: a nav label is a unit — it may move to
				// the next row as a whole, but never break inside a
				// Japanese word.
				whiteSpace: 'nowrap',
				paddingBlock: isMobile ? '3' : '1',
				paddingInline: isMobile ? '2' : '0',
				borderRadius: isMobile ? 'md' : '0',
				transition: 'color 120ms ease',
				...(!isMobile && {
					_hover: { color: 'text.default' },
				}),
				...(isMobile && {
					_hover: { backgroundColor: 'bg.surface' },
					borderWidth: '1px',
					borderStyle: 'solid',
					borderColor: isActive ? 'border.strong' : 'border.subtle',
				}),
				_focusVisible: {
					outline: '2px solid {colors.border.focus}',
					outlineOffset: '2px',
				},
			})}
		>
			<span lang="ja">{item.labelJa}</span>
			{/*
			 * Issue #777: the EN label is a *mobile panel* affordance.
			 * On the desktop strip it was a second, decorative copy of
			 * the same destination inside the same link — six extra text
			 * runs that bought ~380px of row width and no information
			 * (the EN name is still on the link's `aria-label`, so a
			 * screen reader announces it exactly once either way). The
			 * strip now carries one label per destination.
			 */}
			{isMobile && (
				<span
					aria-hidden="true"
					lang="en"
					className={css({
						fontFamily: 'mono',
						fontSize: 'xs',
						letterSpacing: '0.04em',
						textTransform: 'uppercase',
						color: 'text.muted',
					})}
				>
					{item.labelEn}
				</span>
			)}
		</a>
	);
}
