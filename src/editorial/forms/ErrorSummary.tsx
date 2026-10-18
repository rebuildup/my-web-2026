import type { ReactNode } from 'react';
import { css } from '../../../styled-system/css';

/**
 * Form-level error summary (Issue #404).
 *
 * Why a summary and not only per-field errors
 * ------------------------------------------
 * A per-field error is announced when the field receives focus, which
 * means the person who pressed submit has to hunt for it. The summary
 * is the form-level statement of "this submission did not go through,
 * and here is every reason", and it is the only LIVE region in the
 * form: it announces once, at the moment it appears, listing each
 * reason with a link to the field it belongs to.
 *
 * Three properties are deliberate:
 *
 *   - `role="alert"` (an assertive live region) rather than
 *     `role="status"`: a refused submission is the result of the
 *     action the person just took, so it outranks polite queueing.
 *   - `tabIndex={-1}`: the summary is programmatically focusable so a
 *     caller MAY move focus here, but it is not in the tab order, and
 *     its links are — the error text is reachable by keyboard without
 *     a focus-order change on every surface.
 *   - Entries link to `#<controlId>`: activating one moves focus to
 *     the control the sentence is about, which is also where
 *     `aria-describedby` repeats it (1.3.1 + 3.3.1).
 *
 * WCAG 2.2 3.3.1 requires the error be "described in text"; this
 * module therefore renders nothing but text and the caller-owned
 * sentence, never a colour-only or icon-only signal (1.4.1).
 */

/** One refused submission reason. */
export interface FormErrorEntry {
	/**
	 * The `name` of the field this error belongs to. When present the
	 * entry links to that field's control; when absent it is a
	 * form-level error (a refused action, not a refused value) and is
	 * rendered as plain text.
	 */
	field?: string;
	/** The field's visible label, so the link text is not a bare id. */
	label: string;
	/** The sentence that says what is wrong. Never empty. */
	message: string;
}

export interface ErrorSummaryProps {
	/** The sentence that opens the summary. */
	heading: string;
	/** One entry per refused field / refused action. Empty renders nothing. */
	errors: readonly FormErrorEntry[];
	/** Heading level, so the summary sits correctly in the page outline. */
	headingLevel?: 2 | 3 | 4;
	/** Id for the heading; the summary is labelled by it. */
	headingId?: string;
	/**
	 * Test hook. A caller that adopts the summary for a screen it
	 * already tests (e.g. `/admin/login`'s refused redirect target,
	 * asserted by `e2e/admin-login-return-to.spec.ts`) keeps its own
	 * selector instead of having its contract renamed by this module.
	 */
	testId?: string;
	/**
	 * Machine-readable facts about the refusal — the redirect
	 * classifier's reason, for instance. Text only; the summary never
	 * renders a raw value from here.
	 */
	dataAttributes?: Record<`data-${string}`, string>;
	/**
	 * Extra content under the list — a form-level explanation that is
	 * not tied to one field (a rate limit, a retry affordance).
	 */
	children?: ReactNode;
}

/**
 * The summary. Returns `null` for an empty `errors` array so callers
 * can render it unconditionally instead of threading a conditional
 * through every form.
 */
export function ErrorSummary({
	heading,
	errors,
	headingLevel = 3,
	headingId = 'form-error-summary-heading',
	testId = 'form-error-summary',
	dataAttributes,
	children,
}: ErrorSummaryProps) {
	if (errors.length === 0) return null;
	const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
	return (
		<div
			role="alert"
			tabIndex={-1}
			aria-labelledby={headingId}
			data-testid={testId}
			{...dataAttributes}
			className={summaryClassName}
		>
			<Heading id={headingId} className={headingClassName}>
				{heading}
			</Heading>
			<ul className={listClassName}>
				{errors.map((entry) => (
					<li key={entry.field ?? `${entry.label}:${entry.message}`} className={itemClassName}>
						{entry.field ? (
							<a href={`#${entry.field}`} className={linkClassName}>
								{entry.label}
							</a>
						) : (
							<span className={labelClassName}>{entry.label}</span>
						)}
						<span>: {entry.message}</span>
					</li>
				))}
			</ul>
			{children}
		</div>
	);
}

const summaryClassName = css({
	paddingBlock: '3',
	paddingInline: '4',
	border: '2px solid {colors.border.subtle}',
	borderLeftColor: 'accent.negative',
	borderRadius: '4',
	background: 'bg.surface',
	maxWidth: '640px',
});

const headingClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '700',
	color: 'accent.negative',
});

const listClassName = css({
	margin: '2',
	paddingInlineStart: '4',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.default',
});

const itemClassName = css({});

const linkClassName = css({
	color: 'text.default',
	fontWeight: '600',
	textDecoration: 'underline',
	_hover: { color: 'accent.negative' },
});

const labelClassName = css({
	fontWeight: '600',
});
