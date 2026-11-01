/**
 * Issue #764 — comparison board (WORKTREE ONLY, never committed).
 *
 * `/compare?path=/&theme=dark` stacks the three directions in one page, each
 * an iframe of the REAL route (`?direction=a|b|c&theme=…`), so the owner
 * compares one render against another instead of a mock against a mock.
 */
import { createFileRoute, useLocation, useNavigate } from '@tanstack/react-router';

const ROUTES = [
	{ path: '/', label: 'Home' },
	{ path: '/about', label: 'About' },
	{ path: '/portfolio', label: 'Portfolio' },
	{ path: '/tools', label: 'Tools' },
	{ path: '/design-system', label: 'Design system' },
];

const DIRECTIONS = [
	{ id: 'a', name: 'A — INK / SIGNAL', note: 'インク紺 + シアン + アンバー' },
	{ id: 'b', name: 'B — MONOCHROME / SIGNAL', note: '無彩色 + mark の黄 1 色' },
	{ id: 'c', name: 'C — SHARPENED CURRENT', note: '現行 sky / slate を dark 主に' },
] as const;

function ComparePage() {
	const location = useLocation();
	const navigate = useNavigate();
	const params = new URLSearchParams(location.searchStr ?? '');
	const path = params.get('path') ?? '/';
	const theme = params.get('theme') === 'light' ? 'light' : 'dark';

	const go = (next: { path?: string; theme?: string }) => {
		const p = new URLSearchParams({ path: next.path ?? path, theme: next.theme ?? theme });
		navigate({ to: '/compare', search: Object.fromEntries(p) as never });
	};

	return (
		<div style={{ minHeight: '100vh', background: '#101215', color: '#e8ecf3' }}>
			<header
				style={{
					position: 'sticky',
					top: 0,
					zIndex: 10,
					display: 'flex',
					flexWrap: 'wrap',
					gap: 16,
					alignItems: 'center',
					padding: '12px 20px',
					background: '#181b20',
					borderBottom: '1px solid #2b3038',
					font: '13px/1.4 ui-sans-serif, system-ui, sans-serif',
				}}
			>
				<strong style={{ letterSpacing: '0.04em' }}>#764 comparison</strong>
				<span style={{ opacity: 0.6 }}>{path}</span>
				<div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
					{ROUTES.map((r) => (
						<button
							key={r.path}
							type="button"
							onClick={() => go({ path: r.path })}
							style={btn(r.path === path)}
						>
							{r.label}
						</button>
					))}
				</div>
				<div style={{ display: 'flex', gap: 6, marginInlineStart: 'auto' }}>
					{['dark', 'light'].map((t) => (
						<button key={t} type="button" onClick={() => go({ theme: t })} style={btn(t === theme)}>
							{t}
						</button>
					))}
				</div>
			</header>

			{DIRECTIONS.map((d) => (
				<section key={d.id} style={{ borderTop: '1px solid #2b3038' }}>
					<div
						style={{
							display: 'flex',
							gap: 12,
							alignItems: 'baseline',
							padding: '10px 20px',
							font: '13px/1.4 ui-sans-serif, system-ui, sans-serif',
						}}
					>
						<strong>{d.name}</strong>
						<span style={{ opacity: 0.6 }}>{d.note}</span>
						<a
							href={`${path}?direction=${d.id}&theme=${theme}`}
							target="_blank"
							rel="noreferrer"
							style={{ marginInlineStart: 'auto', color: '#67e8f9', fontSize: 12 }}
						>
							この面だけ開く ↗
						</a>
					</div>
					<iframe
						title={`${d.name} ${path}`}
						src={`${path}?direction=${d.id}&theme=${theme}`}
						loading="lazy"
						style={{
							display: 'block',
							width: '100%',
							height: 'min(92vh, 980px)',
							border: 0,
							background: '#fff',
						}}
					/>
				</section>
			))}
		</div>
	);
}

function btn(active: boolean): React.CSSProperties {
	return {
		padding: '5px 10px',
		borderRadius: 4,
		border: '1px solid ' + (active ? '#67e8f9' : '#2b3038'),
		background: active ? '#67e8f9' : 'transparent',
		color: active ? '#06202a' : 'inherit',
		font: '12px/1.2 inherit',
		cursor: 'pointer',
	};
}

export const Route = createFileRoute('/compare')({
	component: ComparePage,
});
