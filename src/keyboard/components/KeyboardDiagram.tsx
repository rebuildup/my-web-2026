import { css, cx } from '../../../styled-system/css';
import { StateMark } from '../../editorial/primitives/StateMark';
import { ScrollRegion } from '../../editorial/table-code';
import { actionDescription, actionLabel, actionRaw, formatDate, layerLabel } from '../format';
import { resolveGeometry } from '../geometry';
import type { KeyboardAction, KeyboardLayer, KeyboardPlatform } from '../types';

/**
 * Key-position diagram for one platform + layer.
 *
 * The diagram is a real position grid: rows keep the source's key
 * order, each key is a button, and the selected key is the one whose
 * full action is shown below. The inner canvas has a fixed minimum
 * width and scrolls horizontally below that, which keeps the caps
 * readable at phone width instead of shrinking 14 keys into 320px.
 *
 * No motion is used. The only state change is colour, which the
 * reduced-motion gate treats as exempt (there is no transform or
 * animation).
 */

export interface KeyboardDiagramProps {
	readonly platform: KeyboardPlatform;
	readonly layer: KeyboardLayer;
	readonly selectedIndex: number | null;
	readonly onSelect: (index: number) => void;
}

const scrollChromeStyle = css({
	paddingBlockEnd: '2',
	// The primitive owns the scroll declaration; this only adds the
	// focus ring the keyboard user sees when the region is reached.
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
});

const canvasStyle = css({
	minWidth: '710px',
	display: 'flex',
	flexDirection: 'column',
	gap: '1.5',
	paddingBlock: '1',
});

const rowStyle = css({
	display: 'flex',
	justifyContent: 'center',
	gap: '1',
});

const keyStyle = css({
	appearance: 'none',
	display: 'flex',
	flexDirection: 'column',
	alignItems: 'flex-start',
	justifyContent: 'space-between',
	minHeight: '13',
	padding: '1.5',
	borderRadius: 'sm',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.canvas',
	color: 'text.default',
	cursor: 'pointer',
	textAlign: 'left',
	fontFamily: 'sans',
	_hover: {
		borderColor: 'border.strong',
		backgroundColor: 'bg.surface',
	},
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
	'&[aria-pressed="true"]': {
		borderColor: 'border.strong',
		backgroundColor: 'accent.surface',
	},
});

const capStyle = css({
	fontSize: 'xs',
	fontWeight: '600',
	lineHeight: '1.2',
	color: 'text.muted',
	whiteSpace: 'nowrap',
});

const actionStyle = css({
	fontSize: 'xs',
	lineHeight: '1.25',
	color: 'text.default',
	overflowWrap: 'anywhere',
});

const mutedActionStyle = css({
	color: 'text.muted',
});

const blockedActionStyle = css({
	color: 'accent.negative',
});

function actionTone(action: KeyboardAction): string | undefined {
	if (action.kind === 'transparent') return mutedActionStyle;
	if (action.kind === 'blocked') return blockedActionStyle;
	return undefined;
}

export function KeyboardDiagram({
	platform,
	layer,
	selectedIndex,
	onSelect,
}: KeyboardDiagramProps) {
	const geometry = resolveGeometry(platform.id, platform.defsrc);
	if (geometry === null) {
		return (
			<p className={css({ color: 'text.muted', fontSize: 'sm' })}>
				キー数が表示モデルと一致しないため、配列図を表示できません。
			</p>
		);
	}

	let index = 0;
	return (
		<div>
			<ScrollRegion
				label={`${platform.label} ${layer.label} のキー配置。横にスクロールできます。`}
				className={scrollChromeStyle}
			>
				<div className={canvasStyle}>
					{geometry.rows.map((row, rowIndex) => {
						const keys = layer.keys.slice(index, index + row.caps.length);
						const start = index;
						index += row.caps.length;
						return (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional by construction.
								key={`row-${rowIndex}`}
								className={rowStyle}
							>
								{row.caps.map((cap, columnIndex) => {
									const keyIndex = start + columnIndex;
									const action = keys[columnIndex];
									if (action === undefined) return null;
									const selected = selectedIndex === keyIndex;
									return (
										<button
											key={`key-${keyIndex}`}
											type="button"
											aria-pressed={selected}
											data-keyboard-key={cap}
											onClick={() => onSelect(keyIndex)}
											className={keyStyle}
											style={{ width: `${row.widths[columnIndex] * 42}px` }}
										>
											<span className={capStyle}>{cap}</span>
											<span className={cx(actionStyle, actionTone(action))}>
												{actionLabel(action, platform.id)}
											</span>
										</button>
									);
								})}
							</div>
						);
					})}
				</div>
			</ScrollRegion>
			<p
				className={css({
					display: { base: 'block', md: 'none' },
					margin: '0',
					marginBlockStart: '2',
					fontSize: 'xs',
					color: 'text.muted',
				})}
			>
				横にスクロールできます。キーをタップすると詳細を表示します。
			</p>
		</div>
	);
}

export interface KeyDetailProps {
	readonly platform: KeyboardPlatform;
	readonly layer: KeyboardLayer;
	readonly selectedIndex: number | null;
}

const detailShellStyle = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '3',
	padding: '4',
	borderRadius: 'md',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.surface',
	minHeight: '40',
});

const detailLabelStyle = css({
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	textTransform: 'uppercase',
	color: 'text.muted',
});

const detailValueStyle = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.default',
	overflowWrap: 'anywhere',
});

const codeStyle = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	backgroundColor: 'bg.subtle',
	paddingInline: '1.5',
	paddingBlock: '0.5',
	borderRadius: 'sm',
	color: 'text.default',
	overflowWrap: 'anywhere',
});

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<p className={detailLabelStyle}>{label}</p>
			<div className={detailValueStyle}>{children}</div>
		</div>
	);
}

function branchSummary(action: KeyboardAction, platform: KeyboardPlatform): string {
	return actionDescription(action, platform.id);
}

export function KeyDetail({ platform, layer, selectedIndex }: KeyDetailProps) {
	const geometry = resolveGeometry(platform.id, platform.defsrc);
	if (selectedIndex === null || geometry === null) {
		return (
			<div className={detailShellStyle}>
				<p className={detailLabelStyle}>key detail</p>
				<p className={detailValueStyle}>
					キーを選択すると、その位置のアクション、tap / hold の分岐、alias と元の構文を表示します。
				</p>
			</div>
		);
	}

	const action = layer.keys[selectedIndex];
	if (action === undefined) {
		return (
			<div className={detailShellStyle}>
				<p className={detailValueStyle}>この位置にはアクションがありません。</p>
			</div>
		);
	}

	let rowIndex = 0;
	let columnIndex = 0;
	let offset = 0;
	for (let index = 0; index < geometry.rows.length; index += 1) {
		const row = geometry.rows[index];
		if (row === undefined) break;
		if (selectedIndex < offset + row.caps.length) {
			rowIndex = index;
			columnIndex = selectedIndex - offset;
			break;
		}
		offset += row.caps.length;
	}
	const cap = geometry.caps[selectedIndex] ?? `#${selectedIndex}`;

	return (
		<div className={detailShellStyle} aria-live="polite" data-keyboard-detail>
			<div>
				<p className={detailLabelStyle}>key detail · {layer.label}</p>
				<p
					className={css({
						margin: '0',
						fontFamily: 'heading',
						fontSize: 'xl',
						fontWeight: '700',
						color: 'text.default',
					})}
				>
					{cap}
				</p>
			</div>

			<DetailRow label="位置">
				第 {rowIndex + 1} 行 / {columnIndex + 1} 列（{platform.layout}・
				{platform.capSource === 'physical' ? '物理キー位置' : 'Kanata 入力順'}）
			</DetailRow>

			<DetailRow label="アクション">{actionDescription(action, platform.id)}</DetailRow>

			{action.reference !== undefined ? (
				<DetailRow label="alias">
					<code className={codeStyle}>{action.reference}</code> を展開した結果
				</DetailRow>
			) : null}

			{action.kind === 'tap-hold' ? (
				<>
					<DetailRow label="tap">
						{action.tap ? branchSummary(action.tap, platform) : '未定義'}
					</DetailRow>
					<DetailRow label="hold">
						{action.hold ? branchSummary(action.hold, platform) : '未定義'}
					</DetailRow>
					<DetailRow label="timing">
						tap {action.timing?.tapMs ?? '?'}ms / hold {action.timing?.holdMs ?? '?'}ms
					</DetailRow>
				</>
			) : null}

			{action.kind === 'one-shot' ? (
				<DetailRow label="one-shot">
					{action.timeoutMs ?? '?'}ms 以内の次の入力を{' '}
					{action.action ? actionDescription(action.action, platform.id) : '未定義'}
				</DetailRow>
			) : null}

			<DetailRow label="元の構文">
				<code className={codeStyle}>{actionRaw(action)}</code>
			</DetailRow>

			{action.note !== undefined ? (
				<p className={css({ margin: '0', fontSize: 'xs', color: 'text.muted' })}>
					<StateMark kind="degraded" size="sm" /> 表示のみの構文です（
					{action.note}）。
				</p>
			) : null}
		</div>
	);
}

/** Layer caption used above the diagram. */
export function layerCaption(platform: KeyboardPlatform, layer: KeyboardLayer): string {
	const base = `${platform.label} の ${layerLabel(layer.id)} レイヤー`;
	if (layer.group === 'base') return `${base}。起動時のベースレイヤー。`;
	if (layer.group === 'hub') return `${base}。Space を長押ししている間だけ有効。`;
	if (layer.group === 'symbols') return `${base}。HUB 内で Shift を長押ししている間だけ有効。`;
	if (layer.group === 'automation') return `${base}。Shift のワンショットで開く操作レイヤー。`;
	if (layer.group === 'mouse') return `${base}。Space / Esc で戻るまで持続するマウスモード。`;
	return `${base}。`;
}

/** Provenance date line used by the status strip. */
export function syncedLine(syncedAt: string): string {
	return `最終同期 ${formatDate(syncedAt)}`;
}
