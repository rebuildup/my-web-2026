/**
 * Issue #764 — 色の体系を実描画で見せる (WORKTREE ONLY).
 *
 * owner の訂正（2026-11-02）をそのまま実装している:
 * 色は 1 色に収斂させない。コンテンツ（分類・状態）が自分の色を持ち、同じ画面に
 * 複数の色が同時に生きる。操作の系統は 1 つに固定し、地は無彩色のまま。
 *
 * 3 案はどれも **同じ題材**（同じ 3 作品・同じ 3 状態・同じ操作）で描くので、
 * 案の差は色の載り方だけになる。数値（同時色相数・彩色面積）は実描画から測る。
 */
import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react';
import { FAMILY_BY_ID, RULES, SYSTEMS } from './colour-systems.mjs';
import { MONO } from './scale-b.mjs';

type Theme = 'dark' | 'light';
type System = (typeof SYSTEMS)[number];

const FONT = 'ui-sans-serif, system-ui, -apple-system, "Hiragino Kaku Gothic ProN", sans-serif';

const WORKS = [
	{ id: 'design', title: '余白の設計', kind: 'design', phrase: '余白', state: 'done' },
	{ id: 'code', title: '同期の実装', kind: 'code', phrase: '同期', state: 'live' },
	{ id: 'writing', title: '月報の書き方', kind: 'writing', phrase: '月報', state: 'fail' },
];

const STATE_LABEL: Record<string, string> = { done: '公開中', live: '連載中', fail: '保留' };

function familyColor(id: string, theme: Theme): string {
	if (id === 'ink') return MONO[theme].text;
	return FAMILY_BY_ID[id][theme];
}

/** 中彩度に落とす（II 案）。地に寄せるだけで、色相は変えない。 */
function soften(colour: string, ground: string): string {
	return `color-mix(in oklab, ${colour} 64%, ${ground})`;
}

/** 薄い塗り（タグ・ピル）。面の上に 16% だけ色を載せる。 */
function wash(colour: string, surface: string): string {
	return `color-mix(in oklab, ${colour} 16%, ${surface})`;
}

type Measure = { hues: number; area: number };

function useColourMeasure(dep: unknown): [React.RefObject<HTMLDivElement | null>, Measure] {
	const ref = useRef<HTMLDivElement | null>(null);
	const [measure, setMeasure] = useState<Measure>({ hues: 0, area: 0 });

	useLayoutEffect(() => {
		const box = ref.current;
		if (!box) return;
		// `dep` は「どの標本か」の識別子。付け替えて、測り直しを 1 回に抑える。
		box.dataset.measureKey = String(dep);
		const raf = requestAnimationFrame(() => {
			const outer = box.getBoundingClientRect();
			const hues = new Set<string>();
			let area = 0;
			for (const el of box.querySelectorAll<HTMLElement>('[data-coloured]')) {
				const family = el.dataset.family;
				if (family && family !== 'ink') hues.add(family);
				const r = el.getBoundingClientRect();
				area += r.width * r.height;
			}
			setMeasure({
				hues: hues.size,
				area: outer.width * outer.height > 0 ? (area / (outer.width * outer.height)) * 100 : 0,
			});
		});
		return () => cancelAnimationFrame(raf);
	}, [dep]);

	return [ref, measure];
}

function WorkCard({
	system,
	theme,
	work,
}: { system: System; theme: Theme; work: (typeof WORKS)[number] }) {
	const m = MONO[theme] as Record<string, string>;
	const raw = familyColor(work.kind, theme);
	const colour = system.id === 'many' ? soften(raw, m.raised) : raw;
	const stateColour = familyColor(work.state, theme);

	const tagStyle: CSSProperties = {
		font: `600 10px/1.2 ${FONT}`,
		letterSpacing: '0.08em',
		color: colour,
		padding: '3px 0',
		alignSelf: 'start',
		justifySelf: 'start',
	};
	if (system.tag === 'tint') {
		tagStyle.background = wash(colour, m.ground);
		tagStyle.padding = '3px 8px';
	}
	if (system.tag === 'rule') {
		tagStyle.borderBottom = `2px solid ${colour}`;
		tagStyle.padding = '3px 0 2px';
	}

	const pillStyle: CSSProperties = {
		font: `600 10px/1.2 ${FONT}`,
		padding: '3px 8px',
		alignSelf: 'start',
		justifySelf: 'start',
	};
	if (system.state === 'tint') {
		pillStyle.background = wash(stateColour, m.ground);
		pillStyle.color = stateColour;
	} else if (system.state === 'borrow') {
		pillStyle.background = m.control;
		pillStyle.color = colour;
	} else {
		pillStyle.background = m.control;
		pillStyle.color = m.secondary;
	}

	return (
		<article
			style={{ background: m.raised, padding: 14, display: 'grid', gap: 10, alignContent: 'start' }}
		>
			<span data-coloured data-family={work.kind} style={tagStyle}>
				{FAMILY_BY_ID[work.kind]?.label ?? work.kind}
			</span>
			<h4 style={{ margin: 0, font: `700 15px/1.4 ${FONT}`, color: m.text }}>
				<span data-coloured data-family={work.kind} style={{ color: colour }}>
					{work.phrase}
				</span>
				のつくりかた
			</h4>
			<p style={{ margin: 0, font: `11px/1.6 ${FONT}`, color: m.muted }}>
				{work.title}。本文は無彩色のまま。色はここまでで、行全体は塗らない。
			</p>
			<span
				data-coloured={system.state === 'mono' ? undefined : true}
				data-family={
					system.state === 'tint' ? work.state : system.state === 'borrow' ? work.kind : undefined
				}
				style={pillStyle}
			>
				{STATE_LABEL[work.state]}
			</span>
		</article>
	);
}

function Specimen({ system, theme }: { system: System; theme: Theme }) {
	const m = MONO[theme] as Record<string, string>;
	const actionRaw = familyColor(system.action, theme);
	const action = system.id === 'many' ? soften(actionRaw, m.ground) : actionRaw;
	const [ref, measure] = useColourMeasure(`${system.id}-${theme}`);

	// 実際にこの標本で色を持つ系統だけを並べる（説明と実描画をずらさない）。
	const stateFamilies = system.state === 'borrow' ? [] : system.states;
	const used = [...new Set([...system.categories, ...stateFamilies])].map((id) => FAMILY_BY_ID[id]);

	return (
		<div
			ref={ref}
			style={{ background: m.ground, padding: 18, display: 'grid', gap: 16, position: 'relative' }}
		>
			<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
				<span style={{ font: `600 11px/1.2 ${FONT}`, color: m.secondary }}>この画面で使う系統</span>
				{used.map((f) => (
					<span
						key={f.id}
						style={{
							display: 'inline-flex',
							gap: 5,
							alignItems: 'center',
							font: `10px/1.2 ${FONT}`,
							color: m.muted,
						}}
					>
						<span style={{ width: 10, height: 10, background: familyColor(f.id, theme) }} />
						{f.role.replace('コンテンツ識別', '分類')} {f.label}
					</span>
				))}
			</div>

			<div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
				{WORKS.map((work) => (
					<WorkCard key={work.id} system={system} theme={theme} work={work} />
				))}
			</div>

			<div
				style={{
					background: m.raised,
					padding: 14,
					display: 'flex',
					alignItems: 'center',
					gap: 14,
					flexWrap: 'wrap',
				}}
			>
				<a
					href="#colour"
					data-coloured
					data-family={system.action === 'ink' ? undefined : system.action}
					style={{
						font: `600 12px/1.4 ${FONT}`,
						color: action,
						textDecoration: 'underline',
						textUnderlineOffset: 3,
					}}
				>
					制作の記録を読む
				</a>
				<span
					data-coloured={system.action === 'ink' ? undefined : true}
					data-family={system.action === 'ink' ? undefined : system.action}
					style={{
						background: action,
						color: system.action === 'ink' ? m.inverseText : m.ground,
						padding: '7px 12px',
						font: `600 12px/1.2 ${FONT}`,
					}}
				>
					主操作
				</span>
				<span
					style={{
						outline: `2px solid ${action}`,
						outlineOffset: 2,
						color: m.text,
						padding: '5px 10px',
						font: `12px/1.4 ${FONT}`,
					}}
				>
					focus ring
				</span>
				<span style={{ marginInlineStart: 'auto', font: `10px/1.4 ${FONT}`, color: m.muted }}>
					操作は 1 系統に固定（ここには色を散らさない）
				</span>
			</div>

			<div style={{ font: `10px/1.4 ${FONT}`, color: m.muted }}>
				実測: 同時に色を持つ系統 {measure.hues} / 彩色面積 {measure.area.toFixed(1)}%（上限{' '}
				{system.limits.hues}・{system.limits.area}%）
			</div>
		</div>
	);
}

export function ColourSystemSection() {
	return (
		<section id="colour" style={{ padding: '28px 20px 8px', borderTop: '1px solid #2b3038' }}>
			<h2 style={{ font: `600 20px/1.3 ${FONT}`, margin: '0 0 4px', letterSpacing: '0.01em' }}>
				節 2 — 色の体系（B の上で色をどう使うか）
			</h2>
			<p style={{ font: `12px/1.6 ${FONT}`, opacity: 0.66, margin: '0 0 6px', maxWidth: 820 }}>
				色は「1
				色を選ぶ」話ではありません。役割ごとに系統を持たせ、コンテンツ（分類・状態）が自分の色を持ち、
				同じ画面で複数の色が同時に生きます。操作の系統だけは 1 つに固定し、地は無彩色のまま。3
				案とも
				<strong>同じ題材</strong>（同じ 3 作品・同じ 3
				状態・同じ操作）で描いているので、差は色の載り方だけです。
			</p>
			<ul
				style={{
					margin: '0 0 18px',
					paddingLeft: 18,
					font: `12px/1.6 ${FONT}`,
					opacity: 0.66,
					maxWidth: 820,
				}}
			>
				{RULES.map((rule) => (
					<li key={rule}>{rule}</li>
				))}
			</ul>

			{SYSTEMS.map((system) => (
				<div key={system.id} style={{ marginBottom: 30 }}>
					<h3 style={{ font: `600 14px/1.4 ${FONT}`, margin: '0 0 2px' }}>{system.name}</h3>
					<p style={{ font: `12px/1.5 ${FONT}`, opacity: 0.6, margin: '0 0 6px' }}>
						{system.summary}
					</p>
					<p style={{ font: `11px/1.5 ${FONT}`, opacity: 0.45, margin: '0 0 10px' }}>
						{system.rule}
					</p>
					<div
						style={{
							display: 'grid',
							gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
							gap: 14,
						}}
					>
						{(['dark', 'light'] as const).map((theme) => (
							<div key={theme}>
								<div style={{ font: `10px/1.4 ${FONT}`, opacity: 0.5, marginBottom: 6 }}>
									{theme}
								</div>
								<Specimen system={system} theme={theme} />
							</div>
						))}
					</div>
				</div>
			))}

			<p style={{ font: `11px/1.6 ${FONT}`, opacity: 0.45, margin: '0 0 4px', maxWidth: 820 }}>
				脚注: 系統の値は本文と同じ場所で読める明度に置いています（地に対するコントラストは概ね 4.5:1
				以上）。 ただしこの節の主役は上の実描画で、比は判断の補足です。
			</p>
		</section>
	);
}
