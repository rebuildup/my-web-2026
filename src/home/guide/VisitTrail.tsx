import { useEffect, useState } from 'react';
import { css } from '../../../styled-system/css';
import { Cluster, listResetClassName } from '../../editorial/primitives/Flow';
import { readVisitTrail } from './trail';

/**
 * "続きから見られる場所" — the visit-trail chips inside the site
 * guide (Issue #936, Epic #928).
 *
 * Meaning
 * -------
 * A returning visitor sees the site-internal destinations this
 * browser visited most recently and can jump straight back. It is
 * the visitor's OWN memory rendered back to them — no server data,
 * no identifier, no score.
 *
 * Degradation contract
 * --------------------
 *   - SSR / no-JS / first visit / storage blocked → renders nothing.
 *     The guide above it is complete without this block, so losing
 *     the trail never loses the page.
 *   - `/` is filtered out: this section only renders on the home
 *     page, and "you are here" is not a destination.
 */

const trailLinkClassName = /*#__PURE__*/ css({
	display: 'inline-flex',
	alignItems: 'center',
	paddingInline: '3',
	paddingBlock: '1',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	borderRadius: 'full',
	fontFamily: 'mono',
	fontSize: 'xs',
	color: 'text.default',
	textDecoration: 'none',
	_hover: { borderColor: 'border.strong', color: 'accent.interactive' },
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
});

const trailLabelClassName = /*#__PURE__*/ css({
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	color: 'text.muted',
});

const trailNoteClassName = /*#__PURE__*/ css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'xs',
	lineHeight: '1.5',
	color: 'text.muted',
});

export function VisitTrail() {
	const [trail, setTrail] = useState<readonly string[]>([]);

	useEffect(() => {
		setTrail(readVisitTrail(window.localStorage));
	}, []);

	const destinations = trail.filter((path) => path !== '/');
	if (destinations.length === 0) return null;

	return (
		<nav aria-label="このブラウザで見たページ" data-testid="visit-trail">
			<p className={trailLabelClassName}>このブラウザで見たページ</p>
			<Cluster as="ul" gap="2" className={listResetClassName}>
				{destinations.map((path) => (
					<li key={path}>
						<a href={path} className={trailLinkClassName}>
							{path}
						</a>
					</li>
				))}
			</Cluster>
			<p className={trailNoteClassName}>
				この一覧はあなたのブラウザの中だけに保存され、サーバーには送信されません。
			</p>
		</nav>
	);
}
