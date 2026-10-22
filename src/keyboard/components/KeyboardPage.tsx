import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Container } from '../../editorial/primitives/Container';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { StateMark } from '../../editorial/primitives/StateMark';
import { ScrollRegion } from '../../editorial/table-code';
import { formatDate, layerLabel, shortRef } from '../format';
import { KEYBOARD_DEFAULT_LAYER } from '../types';
import type {
	KeyboardLayer,
	KeyboardLayerGroup,
	KeyboardPageData,
	KeyboardPlatform,
	KeyboardPlatformId,
} from '../types';
import { KeyDetail, KeyboardDiagram, layerCaption, syncedLine } from './KeyboardDiagram';

/**
 * `/keyboard` presentation shell.
 *
 * The page renders only the safe intermediate model produced by
 * `buildKeyboardCatalog` / `loadKeyboardPage`; it never parses a
 * source, never fetches a repository, and never invents a key that the
 * committed snapshot does not contain. All three failure states stay
 * visible:
 *
 *   - stale snapshot → the diagram still renders, with its age and a
 *     warning that it may no longer match the current configuration;
 *   - one platform unparseable → that platform's tab shows its fixed
 *     public reason, while the other platform remains usable;
 *   - invalid provenance → the whole page renders the safe state and
 *     no catalog.
 *
 * Interaction: two tablists (platform, layer). Both use roving
 * tabindex, Arrow keys, Home and End, and touch-sized buttons. The
 * diagram is a focusable horizontal scroll region below 710px, so a
 * phone keeps the key caps legible instead of shrinking six rows into
 * 320px. There is no motion at all.
 */

const PAGE_TITLE = 'キーボード配列';

const GROUP_ORDER: readonly KeyboardLayerGroup[] = [
	'base',
	'hub',
	'symbols',
	'automation',
	'mouse',
	'extra',
];

const GROUP_LABEL: Readonly<Record<KeyboardLayerGroup, string>> = {
	base: 'ベース',
	hub: 'HUB',
	symbols: '記号',
	automation: '自動化',
	mouse: 'マウス',
	extra: '追加',
};

const heroStyle = css({
	paddingBlock: { base: '12', md: '16' },
	borderBlockEndWidth: '1px',
	borderBlockEndStyle: 'solid',
	borderBlockEndColor: 'border.subtle',
});

const heroInnerStyle = css({
	display: 'flex',
	flexDirection: 'column',
	alignItems: 'flex-start',
	gap: '5',
	maxWidth: '52rem',
});

const eyebrowStyle = css({
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.08em',
	textTransform: 'uppercase',
	color: 'text.accent',
});

const titleStyle = css({
	margin: '0',
	fontFamily: 'heading',
	fontSize: { base: '3xl', md: '5xl' },
	fontWeight: '700',
	lineHeight: '1.15',
	letterSpacing: '-0.02em',
	color: 'text.default',
});

const leadStyle = css({
	margin: '0',
	fontSize: { base: 'md', md: 'lg' },
	lineHeight: '1.75',
	color: 'text.muted',
	textWrap: 'pretty',
});

const factRowStyle = css({
	display: 'flex',
	flexWrap: 'wrap',
	gap: '2',
});

const sectionStyle = css({
	paddingBlock: { base: '10', md: '14' },
	borderBlockEndWidth: '1px',
	borderBlockEndStyle: 'solid',
	borderBlockEndColor: 'border.subtle',
});

const bodyStyle = css({
	marginBlockStart: '6',
	display: 'flex',
	flexDirection: 'column',
	gap: '5',
});

const statusStripStyle = css({
	display: 'flex',
	flexDirection: { base: 'column', md: 'row' },
	alignItems: { base: 'flex-start', md: 'center' },
	gap: '3',
	padding: '4',
	borderRadius: 'md',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.surface',
});

const statusTextStyle = css({
	margin: '0',
	flex: '1',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.default',
});

const metaTextStyle = css({
	margin: '0',
	fontFamily: 'mono',
	fontSize: 'xs',
	color: 'text.muted',
});

const flowGridStyle = css({
	display: 'grid',
	gridTemplateColumns: { base: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
	gap: '4',
});

const flowCardStyle = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '3',
	padding: '5',
	borderRadius: 'md',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.surface',
});

const flowTitleStyle = css({
	margin: '0',
	display: 'flex',
	alignItems: 'center',
	gap: '2',
	fontFamily: 'heading',
	fontSize: 'lg',
	fontWeight: '700',
	color: 'text.default',
});

const flowListStyle = css({
	margin: '0',
	padding: '0',
	listStyle: 'none',
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
});

const flowStepStyle = css({
	display: 'flex',
	gap: '2',
	alignItems: 'baseline',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.default',
});

const flowIndexStyle = css({
	fontFamily: 'mono',
	fontSize: 'xs',
	color: 'text.accent',
	minWidth: '1.5rem',
});

const noteListStyle = css({
	margin: '0',
	paddingInlineStart: '4',
	display: 'flex',
	flexDirection: 'column',
	gap: '1',
	fontSize: 'xs',
	lineHeight: '1.6',
	color: 'text.muted',
});

const tabListStyle = css({
	display: 'flex',
	flexWrap: 'wrap',
	gap: '2',
});

const platformTabStyle = css({
	appearance: 'none',
	display: 'inline-flex',
	alignItems: 'center',
	gap: '2',
	minHeight: '11',
	paddingInline: '4',
	paddingBlock: '2',
	borderRadius: 'full',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.canvas',
	color: 'text.default',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '600',
	cursor: 'pointer',
	_hover: { borderColor: 'border.strong' },
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
	'&[aria-selected="true"]': {
		borderColor: 'border.strong',
		backgroundColor: 'accent.surface',
	},
});

const layerTablistStyle = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
});

const layerGroupStyle = css({
	display: 'flex',
	flexWrap: 'wrap',
	alignItems: 'center',
	gap: '2',
});

const layerGroupLabelStyle = css({
	margin: '0',
	minWidth: '4.5rem',
	fontFamily: 'mono',
	fontSize: 'xs',
	color: 'text.muted',
});

const layerTabStyle = css({
	appearance: 'none',
	minHeight: '10',
	paddingInline: '3',
	paddingBlock: '2',
	borderRadius: 'sm',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.canvas',
	color: 'text.default',
	fontFamily: 'sans',
	fontSize: 'sm',
	cursor: 'pointer',
	_hover: { borderColor: 'border.strong' },
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
	},
	'&[aria-selected="true"]': {
		borderColor: 'border.strong',
		backgroundColor: 'accent.surface',
	},
});

const diagramGridStyle = css({
	display: 'grid',
	// `minmax(0, 1fr)`, not `1fr`: a bare `1fr` track is sized by its
	// items' min-content width, so the diagram's intrinsic width would
	// widen the DOCUMENT at phone width instead of scrolling inside the
	// diagram's own region. `e2e/keyboard.spec.ts` asserts that the
	// document does not scroll horizontally at 390px.
	gridTemplateColumns: { base: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) 21rem' },
	gap: '5',
	alignItems: 'start',
});

const captionStyle = css({
	margin: '0',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.muted',
});

const safePanelStyle = css({
	display: 'flex',
	alignItems: 'flex-start',
	gap: '3',
	padding: '5',
	borderRadius: 'md',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.strong',
	backgroundColor: 'bg.surface',
});

const tableWrapStyle = css({
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	borderRadius: 'md',
});

const tableStyle = css({
	width: '100%',
	minWidth: '40rem',
	borderCollapse: 'collapse',
	fontSize: 'sm',
	'& caption': {
		padding: '3',
		textAlign: 'left',
		fontSize: 'xs',
		color: 'text.muted',
	},
	'& th': {
		padding: '2.5',
		textAlign: 'left',
		fontFamily: 'mono',
		fontSize: 'xs',
		fontWeight: '600',
		color: 'text.muted',
		borderBlockEndWidth: '1px',
		borderBlockEndStyle: 'solid',
		borderBlockEndColor: 'border.subtle',
		backgroundColor: 'bg.subtle',
		whiteSpace: 'nowrap',
	},
	'& td': {
		padding: '2.5',
		color: 'text.default',
		borderBlockEndWidth: '1px',
		borderBlockEndStyle: 'solid',
		borderBlockEndColor: 'border.subtle',
		verticalAlign: 'top',
	},
	'& td code': {
		fontFamily: 'mono',
		fontSize: 'xs',
		overflowWrap: 'anywhere',
	},
});

const calloutStyle = css({
	margin: '0',
	padding: '4',
	borderRadius: 'md',
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
	backgroundColor: 'bg.subtle',
	fontSize: 'sm',
	lineHeight: '1.7',
	color: 'text.default',
});

const warningListStyle = css({
	margin: '0',
	paddingInlineStart: '4',
	display: 'flex',
	flexDirection: 'column',
	gap: '1',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.default',
});

function nextTabIndex(
	event: KeyboardEvent<HTMLButtonElement>,
	current: number,
	count: number,
): number | null {
	if (count < 2) return null;
	if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
		return (current + 1) % count;
	}
	if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
		return (current - 1 + count) % count;
	}
	if (event.key === 'Home') return 0;
	if (event.key === 'End') return count - 1;
	return null;
}

export interface KeyboardPageProps {
	readonly data: KeyboardPageData;
}

export function KeyboardPage({ data }: KeyboardPageProps) {
	const baseId = useId().replaceAll(':', '');

	return (
		<>
			<section className={heroStyle} aria-labelledby={`${baseId}-title`}>
				<Container>
					<div className={heroInnerStyle}>
						<p className={eyebrowStyle}>/keyboard · input</p>
						<h1 id={`${baseId}-title`} className={titleStyle}>
							{PAGE_TITLE}
						</h1>
						<p className={leadStyle}>
							大西配列を土台にした macOS / Windows
							のキーボード設定を、実際のキー位置に沿って表示します。macOS の hidutil
							によるベース差し替えと、Kanata のレイヤーを分けて扱い、Space 長押しや Shift
							長押しで変わる操作も確認できます。
						</p>
						<div className={factRowStyle}>
							<Badge tone="neutral">大西配列 + QWERTY</Badge>
							<Badge tone="neutral">macOS: hidutil + Kanata</Badge>
							<Badge tone="neutral">Windows: Kanata</Badge>
						</div>
					</div>
				</Container>
			</section>
			{data.status === 'ready' ? (
				<KeyboardPageReady data={data} baseId={baseId} />
			) : (
				<KeyboardPageUnavailable data={data} />
			)}
		</>
	);
}

function KeyboardPageReady({
	data,
	baseId,
}: {
	data: Extract<KeyboardPageData, { status: 'ready' }>;
	baseId: string;
}) {
	const [platformId, setPlatformId] = useState<KeyboardPlatformId>('macos');
	const [layerId, setLayerId] = useState<string | null>(null);
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
	const platformTabs = useRef<Array<HTMLButtonElement | null>>([]);
	const layerTabs = useRef(new Map<string, HTMLButtonElement>());

	const platform =
		data.catalog.platforms.find((candidate) => candidate.id === platformId) ??
		data.catalog.platforms[0];

	if (platform === undefined) {
		return (
			<main className={sectionStyle}>
				<Container>
					<SafePanel
						title="表示できるプラットフォームがありません"
						message="同期マニフェストに有効なプラットフォームが含まれていません。"
					/>
				</Container>
			</main>
		);
	}

	const layers = platform.layers;
	const defaultLayer = layers.find((layer) => layer.id === KEYBOARD_DEFAULT_LAYER) ?? layers[0];
	const activeLayer =
		(layerId ? layers.find((layer) => layer.id === layerId) : undefined) ?? defaultLayer;

	function selectPlatform(nextPlatform: KeyboardPlatform) {
		setPlatformId(nextPlatform.id);
		setLayerId(null);
		setSelectedIndex(null);
	}

	function selectLayer(nextLayer: KeyboardLayer) {
		setLayerId(nextLayer.id);
		setSelectedIndex(null);
	}

	function onPlatformKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
		const next = nextTabIndex(event, index, data.catalog.platforms.length);
		if (next === null) return;
		event.preventDefault();
		const target = data.catalog.platforms[next];
		if (target === undefined) return;
		selectPlatform(target);
		platformTabs.current[next]?.focus();
	}

	const groupedLayers = GROUP_ORDER.map((group) => ({
		group,
		layers: layers.filter((layer) => layer.group === group),
	})).filter((entry) => entry.layers.length > 0);
	const flatLayers = groupedLayers.flatMap((entry) => entry.layers);

	function onLayerKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
		const next = nextTabIndex(event, index, flatLayers.length);
		if (next === null) return;
		event.preventDefault();
		const target = flatLayers[next];
		if (target === undefined) return;
		selectLayer(target);
		layerTabs.current.get(target.id)?.focus();
	}

	return (
		<main>
			<section className={sectionStyle} aria-label="同期状態">
				<Container>
					<div className={statusStripStyle}>
						<StateMark kind={data.freshness === 'fresh' ? 'ok' : 'degraded'} size="sm" />
						<p className={statusTextStyle}>
							{data.freshness === 'fresh'
								? '公開リポジトリから取得した時点の内容を表示しています。ページはリクエスト時に外部へアクセスしません。'
								: `最終同期から ${data.ageDays} 日経過しています。表示は取得時点の内容で、現在の設定と異なる可能性があります。`}
						</p>
						<p className={metaTextStyle}>
							{formatDate(data.syncedAt)} 同期 / {data.manifest.sources.length} sources
						</p>
					</div>
				</Container>
			</section>

			<section className={sectionStyle} aria-labelledby={`${baseId}-how`}>
				<Container>
					<SectionHeading
						id={`${baseId}-how`}
						eyebrow="01 — mechanism"
						title="二段階で決まる"
						description="macOS は OS 側のキー差し替えと Kanata のレイヤーが直列に重なります。Windows は Kanata の入力順そのものを表示します。"
					/>
					<div className={bodyStyle}>
						<div className={flowGridStyle}>
							{data.catalog.platforms.map((entry) => (
								<PlatformFlow key={entry.id} platform={entry} />
							))}
						</div>
					</div>
				</Container>
			</section>

			<section className={sectionStyle} aria-labelledby={`${baseId}-layers`} id="keyboard-layers">
				<Container>
					<SectionHeading
						id={`${baseId}-layers`}
						eyebrow="02 — layers"
						title="配列とレイヤー"
						description="プラットフォームを選び、次にレイヤーを選びます。キーを選ぶと、tap / hold の分岐と元の構文を表示します。"
					/>
					<div className={bodyStyle}>
						<div>
							<div role="tablist" aria-label="プラットフォーム" className={tabListStyle}>
								{data.catalog.platforms.map((entry, index) => {
									const selected = entry.id === platform.id;
									return (
										<button
											key={entry.id}
											ref={(node) => {
												platformTabs.current[index] = node;
											}}
											type="button"
											role="tab"
											id={`${baseId}-platform-${entry.id}`}
											aria-selected={selected}
											aria-controls={`${baseId}-panel-${entry.id}`}
											tabIndex={selected ? 0 : -1}
											className={platformTabStyle}
											onClick={() => selectPlatform(entry)}
											onKeyDown={(event) => onPlatformKeyDown(event, index)}
										>
											{entry.status === 'ready' ? (
												<StateMark kind="ok" size="sm" />
											) : (
												<StateMark kind="unreachable" size="sm" />
											)}
											{entry.label}
											<span className={metaTextStyle}>
												{entry.status === 'ready' ? `${entry.layers.length} layers` : '取得失敗'}
											</span>
										</button>
									);
								})}
							</div>

							<div
								role="tabpanel"
								id={`${baseId}-panel-${platform.id}`}
								aria-labelledby={`${baseId}-platform-${platform.id}`}
								className={css({ marginBlockStart: '5' })}
							>
								{platform.status === 'unavailable' || activeLayer === undefined ? (
									<SafePanel
										title={`${platform.label} の配列を表示できません`}
										message={
											platform.reason ?? 'このプラットフォームの設定を解析できませんでした。'
										}
									/>
								) : (
									<div>
										<div
											role="tablist"
											aria-label={`${platform.label} のレイヤー`}
											className={layerTablistStyle}
										>
											{groupedLayers.map((entry) => (
												<div key={entry.group} role="presentation" className={layerGroupStyle}>
													<p aria-hidden="true" className={layerGroupLabelStyle}>
														{GROUP_LABEL[entry.group]}
													</p>
													{entry.layers.map((layer) => {
														const index = flatLayers.indexOf(layer);
														const selected = layer.id === activeLayer.id;
														return (
															<button
																key={layer.id}
																ref={(node) => {
																	if (node) layerTabs.current.set(layer.id, node);
																	else layerTabs.current.delete(layer.id);
																}}
																type="button"
																role="tab"
																id={`${baseId}-layer-${platform.id}-${layer.id}`}
																aria-selected={selected}
																aria-controls={`${baseId}-layer-panel-${platform.id}`}
																tabIndex={selected ? 0 : -1}
																aria-label={`${layerLabel(layer.id)}（${GROUP_LABEL[layer.group]}）`}
																className={layerTabStyle}
																onClick={() => selectLayer(layer)}
																onKeyDown={(event) => onLayerKeyDown(event, index)}
															>
																{layerLabel(layer.id)}
															</button>
														);
													})}
												</div>
											))}
										</div>

										<div
											role="tabpanel"
											id={`${baseId}-layer-panel-${platform.id}`}
											aria-labelledby={`${baseId}-layer-${platform.id}-${activeLayer.id}`}
											className={css({ marginBlockStart: '5' })}
										>
											<div className={diagramGridStyle}>
												<div>
													<p className={captionStyle}>{layerCaption(platform, activeLayer)}</p>
													<div className={css({ marginBlockStart: '3' })}>
														<KeyboardDiagram
															platform={platform}
															layer={activeLayer}
															selectedIndex={selectedIndex}
															onSelect={setSelectedIndex}
														/>
													</div>
												</div>
												<KeyDetail
													platform={platform}
													layer={activeLayer}
													selectedIndex={selectedIndex}
												/>
											</div>
										</div>
									</div>
								)}
							</div>
						</div>

						{data.catalog.warnings.length > 0 ? (
							<div>
								<p className={metaTextStyle}>解析メモ</p>
								<ul className={warningListStyle}>
									{data.catalog.warnings.map((warning) => (
										<li key={warning}>{warning}</li>
									))}
								</ul>
							</div>
						) : null}
					</div>
				</Container>
			</section>

			{platform.status === 'ready' && platform.hidutil ? (
				<section className={sectionStyle} aria-labelledby={`${baseId}-hidutil`}>
					<Container>
						<SectionHeading
							id={`${baseId}-hidutil`}
							eyebrow="03 — hidutil"
							title="macOS のベース差し替え"
							description="hidutil は物理キーの出力を先に変えます。Kanata はその後の入力をレイヤーで解釈します。"
						/>
						<div className={bodyStyle}>
							<p className={captionStyle}>{platform.hidutil.note}</p>
							<ScrollRegion
								label="hidutil UserKeyMapping の対応表。横にスクロールできます。"
								className={tableWrapStyle}
							>
								<table className={tableStyle}>
									<caption>
										hidutil UserKeyMapping（{platform.hidutil.mappings.length} 件、元の JSON の順）
									</caption>
									<thead>
										<tr>
											<th scope="col">物理キー</th>
											<th scope="col">置き換え後</th>
											<th scope="col">src usage</th>
											<th scope="col">dst usage</th>
										</tr>
									</thead>
									<tbody>
										{platform.hidutil.mappings.map((mapping) => (
											<tr key={`${mapping.fromUsage}-${mapping.toUsage}`}>
												<td>{mapping.fromKey}</td>
												<td>{mapping.toKey}</td>
												<td>
													<code>0x{mapping.fromUsage.toString(16)}</code>
												</td>
												<td>
													<code>0x{mapping.toUsage.toString(16)}</code>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</ScrollRegion>
						</div>
					</Container>
				</section>
			) : null}

			<section className={sectionStyle} aria-labelledby={`${baseId}-sources`}>
				<Container>
					<SectionHeading
						id={`${baseId}-sources`}
						eyebrow="04 — provenance"
						title="出典と同期"
						description="表示しているのは公開リポジトリの特定 commit から取得したバイト列です。採用元と最新 head を分けて記録します。"
					/>
					<div className={bodyStyle}>
						<AdoptionCallout manifest={data.manifest} />
						<ScrollRegion
							label="出典と最終同期の一覧。横にスクロールできます。"
							className={tableWrapStyle}
						>
							<table className={tableStyle}>
								<caption>
									{syncedLine(data.syncedAt)} / stale 判定 {data.staleAfterDays} 日
								</caption>
								<thead>
									<tr>
										<th scope="col">用途</th>
										<th scope="col">repository</th>
										<th scope="col">ref</th>
										<th scope="col">path</th>
										<th scope="col">取得日</th>
									</tr>
								</thead>
								<tbody>
									{data.manifest.sources.map((source) => (
										<tr key={source.id}>
											<td>
												{source.platform === 'macos'
													? 'macOS'
													: source.platform === 'windows'
														? 'Windows'
														: '採用 ref'}
												<br />
												<span className={metaTextStyle}>
													{source.role === 'repository-latest'
														? 'repository latest'
														: 'pc-setup adopted'}
												</span>
											</td>
											<td>
												<a
													href={`https://github.com/${source.repository}/blob/${source.ref}/${source.path}`}
													rel="noreferrer"
												>
													{source.repository}
												</a>
											</td>
											<td>
												<code title={source.ref}>{shortRef(source.ref)}</code>
											</td>
											<td>
												<code>{source.path}</code>
											</td>
											<td>{formatDate(source.fetchedAt)}</td>
										</tr>
									))}
								</tbody>
							</table>
						</ScrollRegion>
						<p className={calloutStyle}>
							同期はローカルのスケジューラまたは release 手順で実行します。ページの表示時に GitHub
							へ問い合わせることはありません。壊れた
							source、未対応の構文、キー数の不一致は、そのプラットフォームだけを安全な状態に落とします。
						</p>
					</div>
				</Container>
			</section>
		</main>
	);
}

function SafePanel({ title, message }: { title: string; message: string }) {
	return (
		// `role="status"` announces the state change textually. `<output>`
		// is phrasing content, and this panel contains block paragraphs.
		// biome-ignore lint/a11y/useSemanticElements: the panel contains block content, so a div with role=status is the right element.
		<div className={safePanelStyle} role="status">
			<StateMark kind="unreachable" size="sm" />
			<div>
				<p
					className={css({
						margin: '0',
						fontFamily: 'heading',
						fontSize: 'lg',
						fontWeight: '700',
						color: 'text.default',
					})}
				>
					{title}
				</p>
				<p className={captionStyle}>{message}</p>
			</div>
		</div>
	);
}

function KeyboardPageUnavailable({
	data,
}: {
	data: Extract<KeyboardPageData, { status: 'unavailable' }>;
}) {
	return (
		<main className={sectionStyle}>
			<Container>
				<div className={bodyStyle}>
					<SafePanel title="現在、配列を表示できません" message={data.message} />
					<p className={captionStyle}>
						同期マニフェストの検証に失敗したため、古い、または不完全なデータを現在の設定として表示しません。診断コードのみ記録しています。
					</p>
					<ul className={noteListStyle}>
						{data.detailCodes.map((code) => (
							<li key={code}>
								<code>{code}</code>
							</li>
						))}
					</ul>
				</div>
			</Container>
		</main>
	);
}

function PlatformFlow({ platform }: { platform: KeyboardPlatform }) {
	const isMac = platform.id === 'macos';
	const ready = platform.status === 'ready';
	// Counts come from the parsed platform, not from prose. A source
	// change that adds or removes a layer must not leave a stale
	// number here, and an unparseable platform must not present the
	// diagram it failed to parse as a normal step list.
	const steps = !ready
		? []
		: isMac
			? [
					'物理キー（US ANSI）',
					`hidutil — ${platform.hidutil?.mappings.length ?? 0} 個のキー出力を大西配列の土台へ差し替え`,
					`Kanata — ${platform.layers.length} レイヤーを tap / hold で切り替え`,
					'Space 長押し → HUB / Shift 長押し → 記号',
				]
			: [
					`ChgKey 後の入力（${platform.defsrc.length} キー）`,
					'Kanata — defsrc の入力順をそのまま表示',
					'大西 / QWERTY を caps で切り替え',
					`Kanata — ${platform.layers.length} レイヤー（F1 長押し → extra）`,
				];

	return (
		<div className={flowCardStyle}>
			<p className={flowTitleStyle}>
				<StateMark kind={ready ? 'ok' : 'unreachable'} size="sm" />
				{platform.label}
				<Badge tone="neutral">{platform.layout}</Badge>
			</p>
			{ready ? (
				<ol className={flowListStyle}>
					{steps.map((step, index) => (
						<li key={step} className={flowStepStyle}>
							<span className={flowIndexStyle} aria-hidden="true">
								{String(index + 1).padStart(2, '0')}
							</span>
							<span>{step}</span>
						</li>
					))}
				</ol>
			) : (
				<p className={captionStyle}>
					{platform.reason ??
						'このプラットフォームの設定を解析できなかったため、手順を表示できません。'}
				</p>
			)}
			{platform.notes.length > 0 ? (
				<ul className={noteListStyle}>
					{platform.notes.map((note) => (
						<li key={note}>{note}</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

function AdoptionCallout({
	manifest,
}: {
	manifest: Extract<KeyboardPageData, { status: 'ready' }>['manifest'];
}) {
	const adopted = manifest.sources.find((source) => source.id === manifest.adoption.sourceId);
	const installed = manifest.sources.find(
		(source) => source.id === manifest.adoption.declaredBySourceId,
	);
	return (
		<p className={calloutStyle}>
			<strong>採用 status:</strong>{' '}
			{adopted ? `${adopted.repository}/${adopted.path}` : manifest.adoption.sourceId} は{' '}
			<code>{shortRef(manifest.adoption.declaredRef)}</code> を採用しています
			{installed ? `（${installed.id} が宣言）` : ''}。 {manifest.adoption.note}
		</p>
	);
}
