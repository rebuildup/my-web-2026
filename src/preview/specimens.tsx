/**
 * Issue #764 — B の「階層」を実描画で見せる標本
 * (WORKTREE ONLY, never merged).
 *
 * owner の判定（2026-11-02）は数値表では評価できない、という一貫した指示なので、
 * ここに置くのは hex の一覧ではなく「その面の上に本文・補助文字・罫線が実際に載ったもの」。
 * 選ぶのは owner。この component は候補を並べるだけで、どれかを推したり強調したりしない。
 */
import type { CSSProperties } from 'react';
import { MONO, MONO_ROLES } from './scale-b.mjs';

type Theme = 'dark' | 'light';

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Hiragino Kaku Gothic ProN", sans-serif';

function luminance(hex: string): number {
	const n = hex.replace('#', '');
	const v = [0, 2, 4].map((i) => Number.parseInt(n.slice(i, i + 2), 16) / 255);
	const [r, g, b] = v.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 補足としてだけ出す（評価の主役は実描画）。 */
function ratio(a: string, b: string): string {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return ((hi + 0.05) / (lo + 0.05)).toFixed(2);
}

const h2Style: CSSProperties = {
	font: `600 20px/1.3 ${FONT}`,
	margin: '0 0 4px',
	letterSpacing: '0.01em',
};
const noteStyle: CSSProperties = {
	font: `12px/1.5 ${FONT}`,
	opacity: 0.62,
	margin: '0 0 18px',
	maxWidth: 720,
};

/** 1 段ぶん。面は「その上に載る文字と罫線」、文字は「実際に読ませる」、罫線は「地と面の両方の上」。 */
function RolePanel({ theme, roleKey }: { theme: Theme; roleKey: string }) {
	const m = MONO[theme] as Record<string, string>;
	const role = MONO_ROLES.find((r) => r.key === roleKey);
	const kind = role?.kind ?? 'surface';

	if (kind === 'ink') {
		const ink = roleKey === 'disabled' ? m.disabledText : m[roleKey];
		return (
			<figure style={{ margin: 0 }}>
				<div
					style={{
						background: m.raised,
						height: 132,
						padding: '16px',
						display: 'flex',
						flexDirection: 'column',
						justifyContent: 'center',
						gap: 8,
					}}
				>
					<div style={{ font: `600 14px/1.4 ${FONT}`, color: ink }}>
						この文字が読めるか 制作の記録 0123
					</div>
					<div style={{ font: `11px/1.4 ${FONT}`, color: ink, opacity: 0.9 }}>
						subtitle / caption 0123 — 上がった面の上で
					</div>
					{roleKey === 'disabled' ? (
						<span
							style={{
								alignSelf: 'flex-start',
								background: m.disabledSurface,
								color: m.disabledText,
								padding: '4px 10px',
								font: `600 11px/1.2 ${FONT}`,
							}}
						>
							無効なボタン
						</span>
					) : null}
				</div>
				<figcaption style={{ font: `11px/1.5 ${FONT}`, opacity: 0.7, paddingTop: 6 }}>
					<span style={{ fontWeight: 600 }}>{role?.label}</span>
					{' · '}
					{role?.note}
				</figcaption>
			</figure>
		);
	}

	if (kind === 'line') {
		const line = m[roleKey];
		const weight = roleKey === 'rule' ? 2 : 1;
		return (
			<figure style={{ margin: 0 }}>
				<div
					style={{
						background: m.ground,
						height: 132,
						padding: '18px 16px',
						display: 'grid',
						gap: 14,
					}}
				>
					<div>
						<div style={{ font: `10px/1.4 ${FONT}`, color: m.muted, marginBottom: 8 }}>
							ページ地の上
						</div>
						<div style={{ height: weight, background: line }} />
					</div>
					<div style={{ background: m.raised, padding: '10px 12px' }}>
						<div style={{ font: `10px/1.4 ${FONT}`, color: m.muted, marginBottom: 8 }}>
							上がった面の上
						</div>
						<div style={{ height: weight, background: line }} />
					</div>
				</div>
				<figcaption style={{ font: `11px/1.5 ${FONT}`, opacity: 0.7, paddingTop: 6 }}>
					<span style={{ fontWeight: 600 }}>{role?.label}</span>
					{' · '}
					{role?.note}
				</figcaption>
			</figure>
		);
	}

	const bg = m[roleKey] ?? m.ground;
	const isInverse = roleKey === 'inverseGround';
	const onSurfaceText = isInverse ? m.inverseText : m.text;
	const onSurfaceMuted = isInverse ? 'rgba(255,255,255,0.62)' : m.muted;

	return (
		<figure style={{ margin: 0 }}>
			<div
				style={{
					background: bg,
					height: 132,
					padding: '14px 16px',
					display: 'flex',
					flexDirection: 'column',
					justifyContent: 'space-between',
					color: onSurfaceText,
				}}
			>
				<div style={{ font: `600 13px/1.35 ${FONT}` }}>本文 この段の上で読めるか 0123</div>
				<div style={{ font: `11px/1.3 ${FONT}`, color: onSurfaceMuted }}>
					補助文字 subtitle / caption 0123
				</div>
				<div style={{ display: 'grid', gap: 6 }}>
					<div style={{ height: 1, background: m.hairline }} />
					<div style={{ height: 2, background: m.rule }} />
				</div>
			</div>
			<figcaption style={{ font: `11px/1.5 ${FONT}`, opacity: 0.7, paddingTop: 6 }}>
				<span style={{ fontWeight: 600 }}>{role?.label}</span>
				{' · '}
				{role?.note}
			</figcaption>
		</figure>
	);
}

/** 面の重なり（地 / 沈み / 上がり / 押せる面）を 1 枚で見る。 */
function LayerStack({ theme }: { theme: Theme }) {
	const m = MONO[theme] as Record<string, string>;
	return (
		<div style={{ background: m.ground, padding: 24, display: 'grid', gap: 14 }}>
			<div
				style={{
					background: m.sunken,
					padding: '14px 16px',
					color: m.text,
					font: `12px/1.5 ${FONT}`,
				}}
			>
				沈んだ面（地より一段下） — 帯・窪み・表の余白行
			</div>
			<div
				style={{
					background: m.raised,
					padding: 18,
					color: m.text,
					display: 'grid',
					gap: 10,
					font: `12px/1.5 ${FONT}`,
				}}
			>
				<div style={{ fontWeight: 700 }}>上がった面（カード）</div>
				<div style={{ color: m.muted }}>補助文字はこの面の上でも沈む</div>
				<div style={{ height: 1, background: m.hairline }} />
				<div style={{ display: 'flex', gap: 8 }}>
					<span
						style={{
							background: m.control,
							color: m.text,
							padding: '7px 12px',
							font: `600 12px/1.2 ${FONT}`,
						}}
					>
						押せる面
					</span>
					<span
						style={{
							background: m.inverseGround,
							color: m.inverseText,
							padding: '7px 12px',
							font: `600 12px/1.2 ${FONT}`,
						}}
					>
						反転地の上
					</span>
					<span
						style={{
							background: m.disabledSurface,
							color: m.disabledText,
							padding: '7px 12px',
							font: `600 12px/1.2 ${FONT}`,
						}}
					>
						無効
					</span>
				</div>
			</div>
		</div>
	);
}

export function MonochromeSection() {
	return (
		<section id="scale" style={{ padding: '28px 20px 8px', borderTop: '1px solid #2b3038' }}>
			<h2 style={h2Style}>節 1 — モノクロ階層の標本（B）</h2>
			<p style={noteStyle}>
				11 段を、その段の上に本文・補助文字・hairline・強い罫線を載せて描いています。light と dark
				は
				反転ではなく、それぞれの地から独立に組んだ階層です。同じ役割の段は、両方で同じ前後関係（沈む
				/ 上がる / 弱い / 強い）を保っています。
			</p>
			{(['dark', 'light'] as const).map((theme) => (
				<div key={theme} style={{ marginBottom: 28 }}>
					<h3 style={{ font: `600 14px/1.4 ${FONT}`, margin: '0 0 10px', opacity: 0.85 }}>
						{theme}
					</h3>
					<div
						style={{
							display: 'grid',
							gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)',
							gap: 20,
							alignItems: 'start',
						}}
					>
						<div>
							<div style={{ font: `11px/1.4 ${FONT}`, opacity: 0.55, marginBottom: 6 }}>
								面の重なり
							</div>
							<LayerStack theme={theme} />
						</div>
						<div
							style={{
								display: 'grid',
								gridTemplateColumns: 'repeat(auto-fill, minmax(196px, 1fr))',
								gap: 14,
							}}
						>
							{MONO_ROLES.map((role) => (
								<RolePanel key={role.key} theme={theme} roleKey={role.key} />
							))}
						</div>
					</div>
				</div>
			))}
		</section>
	);
}
