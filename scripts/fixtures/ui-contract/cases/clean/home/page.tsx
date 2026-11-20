import { css } from '../../../styled-system/css';

const fine = css({ color: 'text.default', padding: '4', display: 'flex', gap: '2' });

export function CleanPage({ items }: { items: string[] }) {
	return (
		<div className={fine}>
			{items.slice(0, 3).map((item) => (
				<span key={item}>{item}</span>
			))}
			<a href="/bounded">bounded link</a>
			<ul>
				<li>plain item</li>
			</ul>
		</div>
	);
}
