import { css } from '../../../styled-system/css';
import { TextLink } from './TextLink';

/**
 * EditorialIndex — the numbered, linked index a page's entry column
 * carries (Issue #1181).
 *
 * Why a primitive
 * ---------------
 * The entry's right column is an INDEX of that page's own content:
 * the sections of a profile, the groups of a link directory, the
 * sections of a stack, the channels of a contact page, the shelf of a
 * catalogue, the sections of the home page. Six pages drew that
 * index themselves, and the contract's C-7 caught it: the same style
 * literal in eight files is a missing primitive, not eight local
 * decisions.
 *
 * So the design system owns the SHAPE (the numbering, the hairline
 * rhythm, the quiet meta column) and every page owns the CONTENT
 * (which entries, which counts). The same rule the page-hero
 * primitive follows: the composition is shared, the meaning is not.
 */
export interface EditorialIndexItem {
	/** The href the row links to. Omit for a row that is not a link. */
	readonly href?: string;
	/** The ordinal, printed as a quiet tabular number ("01"). */
	readonly number?: string;
	/** The row's subject. */
	readonly label: string;
	/** A quiet suffix — a count, a date, a state. */
	readonly meta?: string;
}

export interface EditorialIndexProps {
	/** The accessible name of the index's navigation landmark. */
	readonly ariaLabel: string;
	readonly items: readonly EditorialIndexItem[];
	/**
	 * `linked` (the default) renders each row as a link to its
	 * anchor. `plain` renders the subject as text — for an index that
	 * names things rather than points at them.
	 */
	readonly variant?: 'linked' | 'plain';
}

const listClassName = css({
	margin: '0',
	padding: '0',
	listStyle: 'none',
});

const rowClassName = css({
	display: 'flex',
	alignItems: 'baseline',
	justifyContent: 'space-between',
	gap: '3',
	paddingBlock: '2',
	borderBottomWidth: '1px',
	borderBottomStyle: 'solid',
	borderBottomColor: 'border.subtle',
});

const subjectClassName = css({
	display: 'flex',
	alignItems: 'baseline',
	gap: '3',
	minWidth: '0',
});

const numberClassName = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	fontVariantNumeric: 'tabular-nums',
	color: 'text.muted',
});

const labelClassName = css({
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.default',
	textDecoration: 'none',
	_hover: { textDecoration: 'underline' },
});

const metaClassName = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	fontVariantNumeric: 'tabular-nums',
	color: 'text.muted',
});

export function EditorialIndex({ ariaLabel, items, variant = 'linked' }: EditorialIndexProps) {
	return (
		<nav aria-label={ariaLabel}>
			<ol className={listClassName}>
				{items.map((item) => (
					<li key={item.href ?? item.label} className={rowClassName}>
						<span className={subjectClassName}>
							{item.number ? (
								<span aria-hidden="true" className={numberClassName}>
									{item.number}
								</span>
							) : null}
							{variant === 'linked' && item.href ? (
								<TextLink href={item.href} className={labelClassName}>
									{item.label}
								</TextLink>
							) : (
								<span className={labelClassName}>{item.label}</span>
							)}
						</span>
						{item.meta ? <span className={metaClassName}>{item.meta}</span> : null}
					</li>
				))}
			</ol>
		</nav>
	);
}
