import type { ReactNode } from 'react';
import { css, cx } from '../../../styled-system/css';

/**
 * RecordList / RecordRow — the label/value list primitives
 * (ADR-0022 C-5, layout-system.md §2).
 *
 * The owned treatment for repeated label→value content (spec rows,
 * metadata, channel lists). Rows are separated by a hairline and
 * never draw their own box — the section already frames them.
 */

export interface RecordListProps {
	className?: string;
	children?: ReactNode;
}

export function RecordList({ className, children }: RecordListProps) {
	return (
		<dl className={cx(css({ margin: '0', display: 'flex', flexDirection: 'column' }), className)}>
			{children}
		</dl>
	);
}

export interface RecordRowProps {
	/** Row label — rendered muted, may be a string or node. */
	label: ReactNode;
	/** Row value. */
	children?: ReactNode;
	className?: string;
}

export function RecordRow({ label, children, className }: RecordRowProps) {
	return (
		<div
			className={cx(
				css({
					display: 'flex',
					flexWrap: 'wrap',
					gap: '2',
					paddingBlock: '4',
					borderTop: '1px solid',
					borderTopColor: 'border.subtle',
					'&:last-child': { borderBottom: '1px solid', borderBottomColor: 'border.subtle' },
				}),
				className,
			)}
		>
			<dt
				className={css({
					flex: '0 0 12rem',
					maxWidth: '100%',
					fontSize: 'sm',
					color: 'text.muted',
				})}
			>
				{label}
			</dt>
			<dd className={css({ margin: '0', flex: '1 1 16rem', minWidth: '0' })}>{children}</dd>
		</div>
	);
}
