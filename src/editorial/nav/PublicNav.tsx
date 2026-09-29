import { useLocation } from '@tanstack/react-router';
import { useCallback, useEffect, useId, useState } from 'react';
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
 *   - The active route is announced via `aria-current="page"` on the
 *     matching `<a>`. Active styling is colour + weight + underline;
 *     the `aria-current` attribute is the programmatic signal so
 *     screen readers identify it independently of the visual cue.
 *   - Mobile (below the `md` breakpoint — 768px) collapses into a
 *     `<button>` with `aria-expanded` / `aria-controls`. The panel
 *     is closed by default; `Escape` and a route change both close
 *     it; clicking a link inside the panel closes it as well. The
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
 * Header bar + collapsible mobile panel. See module docstring for
 * the full accessibility contract.
 */
export function PublicNav({ currentPath }: PublicNavProps = {}) {
	const location = useLocation();
	const resolvedPath = currentPath ?? location.pathname;
	const [menuOpen, setMenuOpen] = useState(false);
	const menuId = useId();
	const buttonId = useId();

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
	useEffect(() => {
		if (!menuOpen) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				setMenuOpen(false);
			}
		};
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('keydown', onKeyDown);
		};
	}, [menuOpen]);

	return (
		<nav
			aria-label={NAV_LABEL_TEXT}
			className={css({
				borderBlockEndWidth: '1px',
				borderBlockEndColor: 'border.subtle',
				borderBlockEndStyle: 'solid',
				backgroundColor: 'bg.canvas',
			})}
		>
			<div
				className={css({
					width: '100%',
					maxWidth: '1024px',
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
						gap: '6',
						alignItems: 'center',
						md: { display: 'flex' },
					})}
				>
					{PUBLIC_NAV_ITEMS.map((item) => (
						<NavLink key={item.to} item={item} isActive={isActiveRoute(resolvedPath, item.to)} />
					))}
				</ul>

				{/* Mobile menu toggle — visible below md. Always
				    rendered (not conditionally mounted) so the
				    `aria-expanded` / `aria-controls` wiring is
				    stable and the hamburger affordance is predictable
				    even while the panel is closed. */}
				<button
					id={buttonId}
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
						md: { display: 'none' },
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
					md: { display: 'none' },
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
	 * `desktop` (default) renders a horizontally-padded inline link
	 * with the eyebrow EN label on hover; `mobile` renders a
	 * full-width row.
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
		</a>
	);
}
