/**
 * Issue #764 — comparison board (WORKTREE ONLY, never merged).
 *
 * `/compare?path=/&theme=dark` puts A / B / C on one page, each drawn by the
 * REAL route inside an iframe (desktop 1440 and mobile 390 side by side), so
 * the owner judges colour on screen instead of reading a contrast table.
 *
 * Both frames of a row are the same URL with a different viewport width; the
 * iframe itself is the only thing that changes size, so the comparison is
 * between directions, never between two different rendering setups.
 */
import { createFileRoute, useLocation, useNavigate } from '@tanstack/react-router';
import { PALETTES } from '../preview/preview-palettes.mjs';

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

/** The three or four colours that carry a direction; rendered, not listed. */
const CHIPS = [
	{ role: 'canvas', label: 'canvas' },
	{ role: 'surface', label: 'surface' },
	{ role: 'control', label: 'control' },
	{ role: 'accentFill', label: 'accent' },
	{ role: 'text', label: 'text' },
] as const;

const DESKTOP = { w: 1440, h: 1800, scale: 0.5 };
const MOBILE = { w: 390, h: 900 };

type Theme = 'dark' | 'light';

function ComparePage() {
	const location = useLocation();
	const navigate = useNavigate();
	const params = new URLSearchParams(location.searchStr ?? '');
	const path = params.get('path') ?? '/';
	const theme: Theme = params.get('theme') === 'light' ? 'light' : 'dark';

	const go = (next: { path?: string; theme?: Theme }) => {
		const p = new URLSearchParams({ path: next.path ?? path, theme: next.theme ?? theme });
		navigate({ to: '/compare', search: Object.fromEntries(p) as never });
	};

	return (
		<div style={{ minHeight: '100vh', background: '#101215', color: '#e8ecf3' }}>
			{/* The board is an internal comparison surface: no consent card, and
			    the shell's body keeps the board's ground instead of white. */}
			<style>
				{'body{background:#101215}section[class*="pos_fixed"]{display:none!important}'}
			</style>
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
				<span style={{ opacity: 0.6 }}>
					{path} · {theme} · 1440 / 390
				</span>
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
					{(['dark', 'light'] as const).map((t) => (
						<button key={t} type="button" onClick={() => go({ theme: t })} style={btn(t === theme)}>
							{t}
						</button>
					))}
				</div>
			</header>

			{DIRECTIONS.map((d) => {
				const palette = PALETTES[d.id][theme];
				const search = `direction=${d.id}&theme=${theme}`;
				return (
					<section key={d.id} style={{ borderTop: '1px solid #2b3038', padding: '16px 20px 28px' }}>
						<div
							style={{
								display: 'flex',
								gap: 12,
								alignItems: 'center',
								flexWrap: 'wrap',
								font: '13px/1.4 ui-sans-serif, system-ui, sans-serif',
							}}
						>
							<strong>{d.name}</strong>
							<span style={{ opacity: 0.6 }}>{d.note}</span>
							<div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
								{CHIPS.map((c) => (
									<span
										key={c.role}
										title={`${c.label} ${palette[c.role]}`}
										style={{
											display: 'inline-flex',
											alignItems: 'center',
											gap: 5,
											font: '10px/1 ui-monospace, monospace',
											opacity: 0.85,
										}}
									>
										<span
											style={{
												width: 14,
												height: 14,
												borderRadius: 2,
												background: palette[c.role],
											}}
										/>
										{c.label}
									</span>
								))}
							</div>
							<a
								href={`${path}?${search}`}
								target="_blank"
								rel="noreferrer"
								style={{ marginInlineStart: 'auto', color: '#67e8f9', fontSize: 12 }}
							>
								{d.id} を全画面で開く ↗
							</a>
						</div>

						<div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', marginTop: 12 }}>
							<figure style={{ margin: 0 }}>
								<figcaption style={cap}>desktop 1440px 幅・先頭 1800px（50% 表示）</figcaption>
								<Frame
									src={`${path}?${search}`}
									title={`${d.name} ${path} desktop`}
									w={DESKTOP.w}
									h={DESKTOP.h}
									scale={DESKTOP.scale}
								/>
							</figure>
							<figure style={{ margin: 0 }}>
								<figcaption style={cap}>mobile 390px 幅・先頭 900px</figcaption>
								<Frame
									src={`${path}?${search}`}
									title={`${d.name} ${path} mobile`}
									w={MOBILE.w}
									h={MOBILE.h}
								/>
							</figure>
						</div>
					</section>
				);
			})}
		</div>
	);
}

function Frame({
	src,
	title,
	w,
	h,
	scale = 1,
}: {
	src: string;
	title: string;
	w: number;
	h: number;
	scale?: number;
}) {
	return (
		<div
			style={{
				width: w * scale,
				height: h * scale,
				overflow: 'hidden',
				background: '#fff',
				outline: '1px solid #2b3038',
			}}
		>
			<iframe
				title={title}
				src={src}
				loading="lazy"
				style={{
					display: 'block',
					width: w,
					height: h,
					border: 0,
					transform: scale === 1 ? undefined : `scale(${scale})`,
					transformOrigin: 'top left',
				}}
			/>
		</div>
	);
}

const cap: React.CSSProperties = {
	font: '11px/1.4 ui-monospace, monospace',
	opacity: 0.55,
	marginBottom: 6,
};

function btn(active: boolean): React.CSSProperties {
	return {
		padding: '5px 10px',
		borderRadius: 4,
		background: active ? '#67e8f9' : '#23272e',
		color: active ? '#06202a' : 'inherit',
		font: '12px/1.2 inherit',
		cursor: 'pointer',
	};
}

export const Route = createFileRoute('/compare')({
	component: ComparePage,
});
