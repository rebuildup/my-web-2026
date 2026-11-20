import { type ComponentType, useEffect, useState } from 'react';
import { css } from '../../../styled-system/css';
import { CLOSE_PATH, EMOTICONS_PATH } from '../primitives/material-symbol-paths';
import { MaterialSymbol } from '../primitives/MaterialSymbol';
import { useMediaQuery } from '../use-media-query';

/**
 * Loads the companion after hydration instead of with the page (Issue #274).
 *
 * The character is decoration. `PetSprite` carries the drag, gaze and
 * pose machinery, and the bundle budget (`quality/bundle-budget.json`)
 * charges everything a route imports STATICALLY to first paint. Shipping
 * the machinery to every visitor before the first frame — for a drawing
 * that greets, looks and can be dragged — is not a cost the decoration
 * justifies, so this wrapper holds the only static reference a page
 * makes and fetches the real module after mount.
 *
 * What the visitor sees is unchanged in kind: the server document and the
 * first client render are empty, then the character appears once its
 * chunk has arrived and plays the same arrival greeting it always did.
 * Reduced motion, persistence and the consent-surface inset all live in
 * `PetSprite` itself and are unaffected by when it mounts.
 *
 * If the chunk fails to load — offline, a stale deploy — the page simply
 * has no companion. That is the correct failure for decoration.
 *
 * Issue #1110 — the companion does not AUTO-MOUNT below the `md`
 * breakpoint, but it does not disappear either: a phone gets a small
 * summon control instead. The fixed overlay needs a permanent
 * inline-end corridor (`./safe-area.ts`) so scrolling text never sits
 * under it; on a phone-width viewport that corridor is ~20% of the
 * measure and turns every section into a narrow ribbon. Hiding the
 * character outright would spend the site's personality to buy that
 * measure back, so the mobile contract is OPTIONAL INVOCATION: the
 * reading column keeps its full width, and the visitor who wants the
 * companion taps the summon button — the same gesture budget as any
 * other optional affordance. Once summoned the sprite is the ordinary
 * draggable overlay (its own `--pet-overlay-offset` publication keeps
 * focus compensation honest), and the button becomes the way back.
 */

/**
 * The custom property this control publishes so the document's focus
 * compensation (`src/styles.css`) reserves the room the button
 * occupies. Same contract as `--pet-overlay-offset`, which
 * `PetSprite` publishes while IT is mounted — the button stays on
 * screen as the dismiss control after summoning, so this property is
 * published for as long as the button itself exists.
 *
 * The value is a `calc()` over the consent offset rather than a
 * measured pixel count: the button's bottom edge is
 * `max(16px, consent + 8px)` and it is 44 px tall, so its footprint
 * from the viewport's bottom edge is `max(60px, consent + 52px)`.
 * `consent + 64px` covers both branches with 4–12 px to spare, and the
 * stylesheet's `max()` keeps whichever reservation is taller.
 */
const SUMMON_OFFSET_PROPERTY = '--pet-summon-offset';
const SUMMON_OFFSET_VALUE = 'calc(var(--analytics-consent-offset, 0px) + 64px)';

const summonButtonStyle = css({
	position: 'fixed',
	insetInlineStart: '16px',
	// Above the analytics-consent surface: the band is full-width while
	// a decision is pending, so a fixed control that ignored it would
	// sit on top of a real control.
	bottom: 'max(16px, calc(var(--analytics-consent-offset, 0px) + 8px))',
	display: 'inline-flex',
	alignItems: 'center',
	justifyContent: 'center',
	width: '44px',
	height: '44px',
	padding: '0',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	borderRadius: 'full',
	backgroundColor: 'bg.surface',
	color: 'text.muted',
	cursor: 'pointer',
	_hover: { color: 'text.default', backgroundColor: 'bg.subtle' },
	_focusVisible: {
		outlineWidth: '2px',
		outlineStyle: 'solid',
		outlineColor: 'border.focus',
		outlineOffset: '2px',
	},
});

export function PetCompanion() {
	const [Sprite, setSprite] = useState<ComponentType | null>(null);
	const wideEnough = useMediaQuery('(width >= 768px)');
	const [summoned, setSummoned] = useState(false);
	// The summon control appears only after hydration: the server
	// document stays empty (the Issue #274 contract — decoration is
	// not first paint), and a no-JS visitor never sees a button that
	// cannot summon anything.
	const [mounted, setMounted] = useState(false);
	useEffect(() => {
		setMounted(true);
	}, []);

	useEffect(() => {
		if (!wideEnough && !summoned) return;
		let cancelled = false;
		void import('./PetSprite').then((module) => {
			if (!cancelled) setSprite(() => module.PetSprite);
		});
		return () => {
			cancelled = true;
		};
	}, [wideEnough, summoned]);

	// Publish the summon button's footprint for as long as the button
	// is on screen (narrow viewports only — the button is not rendered
	// at `md` and up, where the sprite mounts on its own).
	useEffect(() => {
		if (!mounted || wideEnough) return;
		const root = document.documentElement;
		root.style.setProperty(SUMMON_OFFSET_PROPERTY, SUMMON_OFFSET_VALUE);
		return () => {
			root.style.removeProperty(SUMMON_OFFSET_PROPERTY);
		};
	}, [mounted, wideEnough]);

	const spriteVisible = Sprite !== null && (wideEnough || summoned);

	return (
		<>
			{spriteVisible && Sprite !== null ? <Sprite /> : null}
			{mounted && !wideEnough ? (
				<button
					type="button"
					className={summonButtonStyle}
					aria-label={summoned ? 'コンパニオンをしまう' : 'コンパニオンを呼ぶ'}
					aria-pressed={summoned}
					onClick={() => setSummoned((value) => !value)}
				>
					<MaterialSymbol d={summoned ? CLOSE_PATH : EMOTICONS_PATH} size={20} />
				</button>
			) : null}
		</>
	);
}
