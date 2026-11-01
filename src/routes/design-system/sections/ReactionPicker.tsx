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
		<div className={css({ display: 'flex', flexDirection: 'column', gap: '6' })}>
			<p
				className={css({
					margin: '0',
					fontFamily: 'mono',
					fontSize: 'sm',
					color: 'text.muted',
				})}
			>
				Reaction picker dialog — the shipped picker, mounted without the home consumer API key
			</p>
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
					borderWidth: '1px',
					borderColor: 'border.subtle',
					borderStyle: 'solid',
					backgroundColor: 'bg.canvas',
					color: 'text.default',
					fontFamily: 'sans',
					fontSize: 'md',
					cursor: 'pointer',
					_focusVisible: {
						outline: '2px solid {colors.border.focus}',
						outlineOffset: '2px',
					},
				})}
			>
				Open the reaction picker
			</button>
			<PickerModal open={open} onClose={() => setOpen(false)} onSelect={() => undefined} />
		</div>
	);
}
