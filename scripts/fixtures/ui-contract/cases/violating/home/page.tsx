import { css } from '../../../styled-system/css';

const band = css({
	paddingBlock: '16',
	backgroundColor: 'bg.surface',
	minHeight: '20rem',
});

const raw = css({ color: '#ff0000', backgroundColor: 'rgb(1, 2, 3)' });

const grid = css({ display: 'grid', gridTemplateColumns: '1fr 1fr' });

const liBox = css({ border: '1px solid', borderRadius: 'md', padding: '4' });

const control = css({ padding: '4', borderRadius: 'md', backgroundColor: 'bg.accent' });

export function ViolatingPage({ items }: { items: string[] }) {
	return (
		<section className={band}>
			<div className={raw}>raw color</div>
			<div className={grid}>bespoke grid</div>
			<ul>
				{items.map((item) => (
					<li key={item} className={liBox}>
						{item}
					</li>
				))}
			</ul>
			{/* biome-ignore lint/a11y/useValidAnchor: fixture intentionally violates the contract */}
			<a className={control}>hand styled link</a>
		</section>
	);
}
