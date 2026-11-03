import { useState } from 'react';
import { css } from '../../../../styled-system/css';
import { PickerModal } from '../../../home/reactions/widget';

/**
 * Reaction picker dialog — the `/design-system` fixture of the shipped
 * emoji picker (Issue #394).
 *
 * Why this fixture exists
 * -----------------------
 * The home page's picker renders only when the home consumer API key
 * (`MY_WEB_2026_CONSUMER_API_KEY`) is configured, so a deployment
 * without that key has no `<dialog>` at all and the dialog's keyboard
 * contract (focus trap, Escape, focus hand-back) cannot be measured
 * there. This fixture mounts the SHIPPED dialog component
 * (`PickerModal` from `src/home/reactions/widget.tsx`) with a no-op
 * selection, so `e2e/a11y/keyboard-navigation.spec.ts` can drive the
 * real dialog in any deployment — the key is not part of the contract,
 * the dialog is.
 *
 * The same pattern as the Issue #486 CLS fixture: the element under
 * test is the shipped element, only the data (here: the selection
 * callback) is fixed.
 *
 * Issue #804 (owner feedback, 2026-11-01): the fixture had one mono
 * line of context ("the shipped picker, mounted without the home
 * consumer API key"), which answered *why it is here* but not *what a
 * reader is looking at* or *how to operate it*. The fixture now states
 * the three things a reader needs — what the dialog is, why this copy
 * exists, and the keyboard contract it is here to demonstrate — and
 * the trigger is a filled control rather than a canvas-coloured
 * button with a hairline outline (the same border correction as the
 * secondary CTA in `InteractiveStates`).
 *
 * Copy
 * ----
 * The demo labels are English on purpose, like the other samples in
 * the interactive section (`Primary CTA`, `Secondary`, …). The visitor
 * facing copy of the picker itself (its search placeholder) stays in
 * `src/home/reactions/widget.tsx` where the component owns it, and
 * this fixture adds no visitor facing copy of its own.
 */
export function ReactionPicker() {
	const [open, setOpen] = useState(false);

	return (
		<div
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '6',
				// Separate the fixture from the state matrix above it. The
				// shared section slot is a plain flex column with no gap, and
				// a divider is not an option under the Issue #804 grid rule.
				marginBlockStart: '10',
			})}
		>
			<dl
				className={css({
					margin: '0',
					display: 'grid',
					gridTemplateColumns: { base: '1fr', md: '8rem minmax(0, 1fr)' },
					columnGap: { base: '0', md: '6' },
					rowGap: { base: '2', md: '4' },
					alignItems: 'start',
				})}
			>
				<dt className={fixtureTermClass}>What it is</dt>
				<dd className={fixtureDetailClass}>
					The shipped reaction picker: a searchable emoji catalogue with category tabs, opened as a
					native modal dialog.
				</dd>
				<dt className={fixtureTermClass}>Why here</dt>
				<dd className={fixtureDetailClass}>
					Home mounts this dialog only when the consumer API key is configured. This copy mounts the
					same component with a no-op selection, so the dialog can be inspected — and its keyboard
					contract measured — in any deployment.
				</dd>
				<dt className={fixtureTermClass}>Keyboard</dt>
				<dd className={fixtureDetailClass}>
					Tab moves through the dialog, typing in the search field filters by name, and Escape
					closes the dialog and returns focus to the trigger. Selecting an emoji closes it too; this
					copy discards the selection.
				</dd>
			</dl>
			<div>
				<button
					type="button"
					data-testid="design-system-reaction-picker-open"
					onClick={() => setOpen(true)}
					className={css({
						display: 'inline-flex',
						alignItems: 'center',
						gap: '2',
						paddingInline: '4',
						height: '9',
						borderRadius: 'md',
						// Issue #804: fill, not outline — the same secondary
						// contract as `InteractiveStates` (`bg.subtle` at
						// rest, ink inversion on hover, accent on press).
						borderWidth: '0',
						borderStyle: 'solid',
						backgroundColor: 'bg.subtle',
						color: 'text.default',
						fontFamily: 'sans',
						fontSize: 'md',
						cursor: 'pointer',
						_hover: {
							backgroundColor: 'text.default',
							color: 'bg.canvas',
						},
						_active: {
							backgroundColor: 'accent.interactive',
							color: 'text.inverse',
						},
						_focusVisible: {
							outline: '2px solid {colors.border.focus}',
							outlineOffset: '2px',
						},
					})}
				>
					Open the reaction picker
				</button>
			</div>
			<PickerModal open={open} onClose={() => setOpen(false)} onSelect={() => undefined} />
		</div>
	);
}

const fixtureTermClass = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.06em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

const fixtureDetailClass = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.default',
});
