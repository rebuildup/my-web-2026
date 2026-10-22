import { Fragment } from 'react';
import { css } from '../../styled-system/css';
import type { RichTextNode } from './types';

const linkClassName = css({
	color: 'text.accent',
	textDecoration: 'underline',
	textUnderlineOffset: '2px',
	textDecorationThickness: '1px',
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
		borderRadius: '1px',
	},
	_hover: {
		textDecorationThickness: '2px',
	},
});

/**
 * Render one extracted inline run.
 *
 * The snapshot is a list of text nodes plus already-validated absolute
 * URLs; there is no HTML string and therefore no HTML sink. Spacing is
 * reconstructed here because the extractor stores each Markdown token
 * separately: a space is inserted between adjacent runs unless the next
 * run starts with punctuation or the previous run ends with an opening
 * bracket.
 */
export function RichText({ nodes }: { nodes: readonly RichTextNode[] }) {
	let previousText = '';
	return (
		<>
			{nodes.map((node, index) => {
				const glue =
					previousText && !/^[,.;:!?)\]]/.test(node.text) && !/[([{]$/.test(previousText)
						? ' '
						: '';
				previousText = node.text;
				const key = `${index}:${node.text.slice(0, 12)}`;
				if (!node.href) {
					return (
						<Fragment key={key}>
							{glue}
							{node.text}
						</Fragment>
					);
				}
				return (
					<Fragment key={key}>
						{glue}
						<a href={node.href} target="_blank" rel="noopener noreferrer" className={linkClassName}>
							{node.image ? `画像: ${node.text}` : node.text}
						</a>
					</Fragment>
				);
			})}
		</>
	);
}
