import { Link, createFileRoute } from '@tanstack/react-router';
import { css } from '../../styled-system/css';
import { PublicNav } from '../editorial/nav';
import { BreadcrumbJsonLd, Breadcrumbs } from '../editorial/nav/Breadcrumbs';
import { breadcrumbsChrome } from '../editorial/nav/Breadcrumbs.styles';
import { Badge } from '../editorial/primitives/Badge';
import { listResetClassName } from '../editorial/primitives/Flow';
import { Grid } from '../editorial/primitives/Grid';
import { MaterialSymbol } from '../editorial/primitives/MaterialSymbol';
import { PageHero } from '../editorial/primitives/PageHero';
import { PageSection } from '../editorial/primitives/PageSection';
import { SectionHeading } from '../editorial/primitives/SectionHeading';
import { ARROW_FORWARD_PATH } from '../editorial/primitives/material-symbol-paths';
import {
	CALCULATE_PATH,
	CODE_PATH,
	EDIT_NOTE_PATH,
	EXTENSION_PATH,
	FUNCTIONS_PATH,
	HISTORY_EDU_PATH,
	KEYBOARD_PATH,
	MAIL_PATH,
	MENU_BOOK_PATH,
	MIC_PATH,
	MOTION_PATH,
	MOVIE_PATH,
	PALETTE_PATH,
	QR_CODE_2_PATH,
	TEXT_FIELDS_PATH,
	TIMER_PATH,
} from '../editorial/primitives/material-symbol-tool-paths';
import {
	eyebrowMonoSm,
	gridMin,
	noteSansMdPlain,
	pageTitleFlush,
	sizeDisplay,
} from '../editorial/primitives/shared-styles';
import { PrivacyNoticeCompact } from '../home/privacy-notice-compact';
import { getCompactPrivacyNotice } from '../home/privacy/load';
import { getHomeReactions } from '../home/public';
import { ReactionsWidget } from '../home/reactions/widget';
import { listToolIndexEntries } from '../tools/public';
import type { ToolIndexEntry } from '../tools/public';

/**
 * `/tools` — the Tool Registry index (Issues #195, #300, #785).
 *
 * Issue #195 (2026-09-29) flipped the show-all policy: the index lists
 * every manifest entry, not just the embeddable subset, so a visitor
 * sees the whole roadmap. `host_disabled` Tools render as a
 * non-interactive item with a 「準備中」 badge.
 *
 * Issue #785 (owner instruction 2026-11-01) rebuilt the page twice. The
 * first pass restored the page chrome and turned each row into a link;
 * the owner rejected that layout (「ツールの表示のさせ方が悪い。ダサい。
 * むしろ分かりづらいため、現在の縦積みからグリッドシステムにのせかえた
 * 方がいい。画像の使い方が下手。バランスが悪い。」), so the shipped
 * arrangement is:
 *
 *   - The page sits on the documented section grid — `Container`, then
 *     `SectionHeading` (`src/editorial/layout-system.md` §3). No second
 *     grid is invented here.
 *   - The two kinds of Tool are two sections, because they answer two
 *     different questions. 「使えるツール」 is the decision surface: two
 *     cards on the 2-up body grid, each a whole-card link. 「準備中」 is
 *     the roadmap: a denser 2-column list with no links and no images.
 *   - A screenshot appears only where it is true of the WHOLE group.
 *     `readmark` had none while Issue #786 left its frame on
 *     「読み込み中…」 (the then-sandboxed frame was denied every storage
 *     API):
 *     a picture of a broken screen is worse than no picture, and the
 *     owner's rule is that an image may not be faked. The fix was the
 *     upstream storage-free redesign (rebuildup/readmark ADR-0008 —
 *     no browser storage at all), which made its screen real again, so
 *     the capture script shoots it like any other target. The
 *     no-image branch still exists: the text block is vertically
 *     centred so a grid row stays even without one.
 *
 * Layout — the card grid is `repeat(2, minmax(0, 1fr))` with the 24 px
 * gutter and the 40 px row beat the other public surfaces use
 * (`src/home/capabilities/grid.tsx`), and `grid-auto-rows: 1fr` so two
 * cards never have two different heights. Borders, shadows and
 * background tinting are not used to draw a card: `layout-system.md` §1
 * and §4 forbid a bordered box on a public surface, and design #764
 * measured that the 1 px border is what made the old surfaces read as
 * "card grid" rather than editorial whitespace.
 */
export const TOOLS_INDEX_REACTIONS_TARGET = 'tools-index';

export const Route = createFileRoute('/tools/')({
	loader: async () => {
		// Issue #1005: the manifest read lives behind the server
		// boundary (`src/tools/public.ts`) — the client bundle and the
		// hydration payload only ever see `ToolIndexEntry` card fields.
		const { available, planned } = await listToolIndexEntries();
		const [reactions, privacyNotice] = await Promise.all([
			getHomeReactions({
				data: { target: TOOLS_INDEX_REACTIONS_TARGET },
			}),
			// Issue #370 — compact data-notice pointer for the reaction
			// surface below (see `src/routes/about.tsx`).
			getCompactPrivacyNotice(),
		]);
		return { available, planned, reactions, privacyNotice };
	},
	head: () => {
		const title = 'Tools — my-web-2026';
		const description =
			'ブラウザで動く小さなツールの一覧。各ツールの内容と、開けるかどうかが分かります。';
		const url = 'https://rebuildup.dev/tools';
		return {
			meta: [
				{ title },
				{ name: 'description', content: description },
				{ property: 'og:type', content: 'website' },
				{ property: 'og:title', content: title },
				{ property: 'og:description', content: description },
				{ property: 'og:url', content: url },
				{ name: 'twitter:card', content: 'summary' },
			],
			// Issue #418: the index declares its own canonical so the Tool
			// registry has a preferred URL. Issue #420 makes the same link
			// the sitemap entry's target; the per-Tool shells stay
			// `noindex` and out of the sitemap (see `src/routes/index.tsx`).
			links: [{ rel: 'canonical', href: url }],
		};
	},
	component: ToolsIndexRoute,
});

/**
 * One glyph per Tool, so a card is identifiable before it is read.
 * The paths come from `material-symbol-tool-paths.ts`, the module that
 * belongs to THIS route alone (Issue #823): the Tools glyph set must
 * not be reachable from the client entry shell, or every route would
 * download path data it never draws. `extension` is the explicit
 * fallback for a manifest entry nobody has classified yet — a new Tool
 * renders, it just is not mislabelled.
 */
const TOOL_ICONS: Readonly<Record<string, string>> = {
	prototype: KEYBOARD_PATH,
	readmark: MENU_BOOK_PATH,
	'text-counter': TEXT_FIELDS_PATH,
	'color-palette': PALETTE_PATH,
	'sequential-png-preview': MOTION_PATH,
	svg2tsx: CODE_PATH,
	'business-mail-block': MAIL_PATH,
	'code-type-p5': MOVIE_PATH,
	fillgen: EDIT_NOTE_PATH,
	'qr-generator': QR_CODE_2_PATH,
	pomodoro: TIMER_PATH,
	'history-quiz': HISTORY_EDU_PATH,
	'pi-game': CALCULATE_PATH,
	'ae-expression': FUNCTIONS_PATH,
	'mic-level': MIC_PATH,
};

/** The glyph an unclassified Tool renders. */
const FALLBACK_TOOL_ICON = EXTENSION_PATH;

/**
 * Screenshots, for the Tools whose screen explains them better than a
 * sentence does. Each file is generated by
 * `scripts/capture-tool-previews.mjs` and recorded in
 * `quality/asset-license-inventory.json`; the alt text describes the
 * captured screen.
 *
 * `readmark` returned with the Issue #786 fix: its then-sandboxed frame
 * used to stop on 「読み込み中…」 (an opaque-origin frame is denied
 * every storage API) and had no image here. ADR-0020 removed that
 * sandbox, so the current frame runs on the host origin; the Tool also
 * no longer uses browser storage at all (rebuildup/readmark ADR-0008),
 * the screen is real, and the capture is committed like any other.
 */
const TOOL_PREVIEWS: Readonly<
	Record<string, { src: string; alt: string; width: number; height: number }>
> = {
	prototype: {
		// `/tools/<slug>/` is the Tool's OWN artifact namespace: the
		// deploy-artifact gates compare the built `tools/**` file set
		// with the copied one exactly (`scripts/sync-cf-build-output.mjs`,
		// `scripts/verify-cf-build-output.mjs`), so a host-rendered
		// thumbnail must not sit in that tree — it made the sync count
		// 14 files against 13 built and failed `build:production`. The
		// preview lives in its own namespace instead.
		src: '/tool-previews/prototype.webp',
		alt: 'ProtoType のタイトル画面。中央に Game Start、左にゲーム・ランキング・サイト設定のメニューが並んでいる。',
		// The capture is the Tool FRAME's box, not the page: at the
		// script's 1440 × 900 context the frame is 811 px tall (900 minus
		// the 62 px nav and the 27 px breadcrumb band), and the 1200 px
		// width is that box scaled by 1200/1440. Restoring the chrome
		// (Issue #785) changed this ratio; the numbers here are the
		// committed file's real dimensions, so a stale pair cannot
		// reserve the wrong box and shift the card on load.
		width: 1200,
		height: 676,
	},
	readmark: {
		// Same namespace reasoning as the entry above: a host-rendered
		// thumbnail must not sit inside the Tool's own artifact tree.
		src: '/tool-previews/readmark.webp',
		alt: 'readmark のライブラリ画面。冒頭に「この readmark は保存しません」という一行の明示があり、空の一覧に「まだ文書がありません」と import の案内が出ている。',
		// The capture is the Tool FRAME's box at the script's
		// 1440 × 900 context, scaled to 1200 px wide. The numbers are
		// the committed file's real dimensions (measured), so a stale
		// pair cannot reserve the wrong box and shift the card on load.
		width: 1200,
		height: 669,
	},
	'color-palette': {
		// Same namespace reasoning as the entries above: a host-rendered
		// thumbnail must not sit inside the Tool's own artifact tree.
		src: '/tool-previews/color-palette.webp',
		alt: 'Color Palette Generator の初期画面。左に Algorithm & Limits の設定欄（Algorithm / Count / Sort By と Hue・Sat スライダー）と Saved Palettes（No saved palettes.）、右に Generate Colors と Save Palette のボタン、Generated Palette（Click "Generate Colors" to begin.）と Export がある。',
		// The capture is the Tool FRAME's box at the script's
		// 1440 × 900 context, scaled to 1200 px wide. The numbers are
		// the committed file's real dimensions (measured), so a stale
		// pair cannot reserve the wrong box and shift the card on load.
		width: 1200,
		height: 669,
	},
	'qr-generator': {
		// Same namespace reasoning as the entries above: a host-rendered
		// thumbnail must not sit inside the Tool's own artifact tree.
		src: '/tool-previews/qr-generator.webp',
		alt: 'QR Generator の画面。左に入力設定・QRパラメータ・色の設定、右に生成結果パネル（初期状態はデータなし）が並ぶ。',
		// The capture is the Tool FRAME's box at the script's
		// 1440 × 900 context, scaled to 1200 px wide. The numbers are
		// the committed file's real dimensions (measured), so a stale
		// pair cannot reserve the wrong box and shift the card on load.
		width: 1200,
		height: 669,
	},
	'text-counter': {
		src: '/tool-previews/text-counter.webp',
		alt: 'Text Counter の画面。テキスト入力欄と、文字数・単語数・行数・バイト数・文字種別（かな・漢字など）の集計結果が並ぶ。',
		width: 1200,
		height: 669,
	},
	'sequential-png-preview': {
		src: '/tool-previews/sequential-png-preview.webp',
		alt: 'Sequential PNG Preview の画面。複数ファイル・フォルダ・ZIP の読み込みタブと、PNG ファイルをドロップする領域が並ぶ。',
		width: 1200,
		height: 669,
	},
	svg2tsx: {
		src: '/tool-previews/svg2tsx.webp',
		alt: 'SVG to TSX の画面。SVGの入力欄、変換オプションのトグル、TSXの出力ペインが並ぶ。',
		width: 1200,
		height: 669,
	},
	'business-mail-block': {
		src: '/tool-previews/business-mail-block.webp',
		alt: 'Business Mail Block Tool の画面。見出しと説明の下に「Business」バッジとブロック検索欄・カテゴリフィルタ、テンプレート・バリデーション・ガイドライン・カスタムブロックのタブ、左に「利用可能なブロック」の挨拶ブロック一覧、右に「メール作成エリア」が並ぶ。',
		width: 1200,
		height: 669,
	},
	'ae-expression': {
		src: '/tool-previews/ae-expression.webp',
		alt: 'AE Expression の画面。Tool 内のヘッダーの下にカテゴリ・難易度・詳細設定のフィルタが並び、その下にエクスプレッションの一覧（Wiggle、Loop Out、Time-based Rotation、Bounce など）がカードで並ぶ。',
		width: 1200,
		height: 669,
	},
	pomodoro: {
		src: '/tool-previews/pomodoro.webp',
		alt: 'Pomodoro の実行中の画面。左上に「Warm up」のフェーズ表示、その下にカウントダウン表示（14:58.75 のように減っている）、さらに下に作業／休憩のスケジュール一覧（Warm up 15 min / Short Break 3 min / Deep Work I 30 min など）が並ぶ。',
		width: 1200,
		height: 669,
	},
	'pi-game': {
		src: '/tool-previews/pi-game.webp',
		alt: 'Pi Memory Game の初期画面。タイトル「Pi Memory Game」と説明文、左に「全画面」ボタン、中央に「3 to Start」と数字の盤面（7 8 9 / 4 5 6 / 1 2 3）が並んでいる。',
		width: 1200,
		height: 669,
	},
	fillgen: {
		src: '/tool-previews/fillgen.webp',
		alt: '穴埋めプリントジェネレーターの初期画面。上に「+ ページ追加」ボタン付きのエディタ（ページ1）、下にプレビュー／HTML／React タブの出力欄がある。',
		width: 1200,
		height: 669,
	},
	'code-type-p5': {
		src: '/tool-previews/code-type-p5.webp',
		alt: 'Code Type p5 の再生中の画面。操作欄に「Play」「Edit Code」のボタンがあり、下のキャンバスにサンプルプログラム（Rust のソースコード）が色付きで描かれている。',
		width: 1200,
		height: 669,
	},
	'history-quiz': {
		src: '/tool-previews/history-quiz.webp',
		alt: 'History Quiz の出題中の画面。上部に第1回〜第5回のタブが並び、その下に「第1回 第二次世界大戦の終焉」の見出しと、空欄入りの問題文（枢軸国の敗北・日本の敗戦）が続く。',
		width: 1200,
		height: 669,
	},
	'mic-level': {
		// Same namespace reasoning as the entries above: a host-rendered
		// thumbnail must not sit inside the Tool's own artifact tree.
		src: '/tool-previews/mic-level.webp',
		alt: 'Mic Level Checker の初期画面。冒頭に Home / Tools / Mic Level Checker のパンくずとタイトル「Mic Level Checker」、説明文、プライバシーに関する注記（音声はこのブラウザ内だけで処理します / 録音・保存・アップロードは一切行いません / サーバーへ送信されることはありません / 音量解析はブラウザ内のみ）、「マイクを使用する」ボタンが並ぶ。',
		// The capture is the Tool FRAME's box at the script's
		// 1440 × 900 context, scaled to 1200 px wide. The numbers are
		// the committed file's real dimensions (measured), so a stale
		// pair cannot reserve the wrong box and shift the card on load.
		width: 1200,
		height: 669,
	},
};

/**
 * The catalogue's own inventory for the hero's right column.
 *
 * Issue #1163 — the tool cards below each carry a screenshot, so the
 * inventory here is deliberately type-only: the names and the state
 * (open now / in preparation), nothing that the cards repeat. It is
 * the shelf the visitor scans before the shelf they open.
 */
/**
 * How many names the entry's inventory shows before it counts the
 * rest. The cards below carry the whole catalogue with screenshots;
 * the entry's right column is a shelf PREVIEW, not a second list.
 */
const INVENTORY_PREVIEW = 6;

function ToolInventory({
	available,
	planned,
}: {
	readonly available: readonly ToolIndexEntry[];
	readonly planned: readonly ToolIndexEntry[];
}) {
	return (
		<div className={css({ display: 'flex', flexDirection: 'column', gap: '6' })}>
			{[
				{ label: 'Available', entries: available },
				{ label: 'In preparation', entries: planned },
			].map((group) => (
				<div key={group.label}>
					<p
						className={css({
							margin: '0',
							paddingBlockEnd: '2',
							borderBottomWidth: '1px',
							borderBottomStyle: 'solid',
							borderBottomColor: 'border.strong',
							fontFamily: 'mono',
							fontSize: 'xs',
							letterSpacing: '0.08em',
							textTransform: 'uppercase',
							color: 'text.muted',
						})}
					>
						{`${group.label} · ${group.entries.length}`}
					</p>
					<ul
						className={css({
							margin: '0',
							padding: '0',
							listStyle: 'none',
						})}
					>
						{group.entries.slice(0, INVENTORY_PREVIEW).map((entry) => (
							<li
								key={entry.slug}
								className={css({
									paddingBlock: '1',
									borderBottomWidth: '1px',
									borderBottomStyle: 'solid',
									borderBottomColor: 'border.subtle',
									fontFamily: 'sans',
									fontSize: 'xs',
									color: 'text.default',
								})}
							>
								{entry.display_name}
							</li>
						))}
						{group.entries.length === 0 ? (
							<li
								className={css({
									paddingBlock: '2',
									fontFamily: 'sans',
									fontSize: 'sm',
									color: 'text.muted',
								})}
							>
								なし
							</li>
						) : null}
						{group.entries.length > INVENTORY_PREVIEW ? (
							<li
								className={css({
									paddingBlock: '2',
									fontFamily: 'mono',
									fontSize: 'xs',
									color: 'text.muted',
								})}
							>
								{`他 ${group.entries.length - INVENTORY_PREVIEW} 件`}
							</li>
						) : null}
					</ul>
				</div>
			))}
		</div>
	);
}

function ToolsIndexRoute() {
	const { available, planned, reactions, privacyNotice } = Route.useLoaderData();
	return (
		<>
			<PublicNav />
			<Breadcrumbs className={breadcrumbsChrome} />
			<BreadcrumbJsonLd />
			{/* Issue #1163 — the entry's right column carries the
			    catalogue's own inventory: which tools can be opened now,
			    and which are still being prepared. The visitor can see
			    the whole shelf before the cards below, and the right
			    half of the entry is no longer empty. */}
			<PageHero
				labelledBy="tools-hero-title"
				eyebrow="Tools"
				title="ツール"
				description="ブラウザだけで動く小さなツールを、開けるものと準備中のものに分けて並べています。各ツールは独立した repository で開発し、同じ origin から配信しています。"
				asideLabel="Inventory"
				aside={<ToolInventory available={available} planned={planned} />}
			/>
			{available.length === 0 && planned.length === 0 ? (
				<PageSection>
					<p className={css(noteSansMdPlain)}>登録されているツールはまだありません。</p>
				</PageSection>
			) : null}
			{available.length > 0 ? (
				<PageSection labelledBy="tools-available-heading">
					<SectionHeading
						id="tools-available-heading"
						description="このページから開けます。カードを選ぶとツールが開きます。"
						eyebrow="01 — Available"
						title="使えるツール"
					/>
					<Grid
						as="ul"
						columns={2}
						columnGap="6"
						rowGap="10"
						equalRows
						className={listResetClassName}
					>
						{available.map((tool) => (
							<ToolCard key={tool.slug} tool={tool} />
						))}
					</Grid>
				</PageSection>
			) : null}
			{planned.length > 0 ? (
				<PageSection labelledBy="tools-planned-heading">
					<SectionHeading
						id="tools-planned-heading"
						description="公開に向けて準備しているツールです。開けるようになるまで、分かっている内容だけを載せています。"
						eyebrow="02 — Planned"
						title="準備中"
					/>
					<Grid
						as="ul"
						columns={2}
						columnGap="6"
						rowGap="6"
						equalRows
						className={listResetClassName}
					>
						{planned.map((tool) => (
							<PlannedToolItem key={tool.slug} tool={tool} />
						))}
					</Grid>
				</PageSection>
			) : null}
			<ReactionsWidget data={reactions} />
			<PrivacyNoticeCompact {...privacyNotice} />
		</>
	);
}

/**
 * The two tool sections share the `Grid` 2-column preset (the 6/6
 * placement of the documented 12-column contract) with `equalRows`,
 * so two cards never have two different heights — the measured fix
 * for uneven card heights (design #764: 22.4 px → 0 px). The roadmap
 * section uses the same columns with a tighter row beat. List
 * semantics stay on the `<ul>` via `as="ul"`; the reset comes from
 * the shared `listResetClassName` because `display` belongs to the
 * primitive (C-5).
 */
const cardItem = css(gridMin);

/**
 * The whole card is the link. `height: 100%` lets it fill the `1fr` row
 * track, so the two cards in a row share one height even when only one
 * of them carries a screenshot.
 *
 * No background, border or shadow: the affordance is the 「開く」 label
 * underlined at rest (Issue #887 — `text.accent` is ink, so colour can
 * no longer say "this is a link"), the title underline on hover, and
 * the focus ring — `layout-system.md` §5 forbids communicating state
 * by tinting something that then looks like a card.
 */
const cardLinkStyles = {
	display: 'flex',
	flexDirection: 'column',
	gap: '3',
	height: '100%',
	minWidth: '0',
	color: 'inherit',
	textDecoration: 'none',
	// `sm` is the 4 px radii token. The literal `4px` this used to carry
	// emitted a second utility for the same value (`.bdr_4px` next to the
	// existing `.bdr_sm`), which is 28 B of shared CSS every route pays
	// for; the token maps onto the class the rest of the platform already
	// ships.
	borderRadius: 'sm',
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '4px',
	},
	_hover: {
		'& [data-tool-title]': {
			textDecoration: 'underline',
		},
		'& [data-tool-cta]': {
			// Issue #887: the CTA carries a PERMANENT underline (see
			// `cta` below), so hover only fattens it instead of
			// repainting an ink that no longer differs from the body.
			textDecorationThickness: '2px',
		},
	},
} as const;

const cardLink = css(cardLinkStyles);

/** A card without a screenshot centres its text block in the same box. */
const cardLinkTextOnly = css({ ...cardLinkStyles, justifyContent: 'center' });

/**
 * Screenshot box. `width` / `height` attributes reserve the aspect ratio
 * before the bytes arrive (the same CLS rule `PortfolioMedia` documents
 * for Issue #486), the fill is `bg.subtle` rather than a border, and
 * `borderRadius` matches the media primitive. No `srcset`: this
 * repository has no image-variant pipeline, so inventing one here would
 * promise renditions the delivery surface cannot produce.
 */
const previewImage = css({
	display: 'block',
	width: '100%',
	height: 'auto',
	borderRadius: '6px',
	backgroundColor: 'bg.subtle',
});

const titleRow = css({
	display: 'flex',
	alignItems: 'center',
	gap: '2',
	minWidth: '0',
});

const toolIcon = css({
	flexShrink: '0',
	color: 'text.muted',
});

const toolTitle = css({
	fontFamily: 'heading',
	fontSize: 'xl',
	fontWeight: '700',
	color: 'text.default',
	lineHeight: '1.25',
	letterSpacing: '-0.01em',
	// Declared on the element rather than inside the card's `_hover`
	// block: the offset only has an effect once the hover rule draws the
	// underline, and a static declaration is one plain utility instead of
	// a second compound `:hover [data-tool-title]` selector (~78 B of
	// shared CSS for the same rendering).
	textUnderlineOffset: '3px',
});

const toolDescription = css({
	fontFamily: 'sans',
	fontSize: 'md',
	color: 'text.muted',
	lineHeight: '1.6',
	maxWidth: '640px',
});

const cta = css({
	display: 'inline-flex',
	alignItems: 'center',
	gap: '1',
	fontFamily: 'sans',
	fontSize: 'sm',
	fontWeight: '500',
	// Issue #887: `text.accent` is INK, so the CTA earns its link
	// affordance from a permanent underline (offset so it clears the
	// Japanese glyphs) rather than from a hue. Hover fattens it.
	color: 'text.accent',
	textDecoration: 'underline',
	textUnderlineOffset: '0.18em',
	textDecorationThickness: '1px',
});

const plannedItem = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	minWidth: '0',
	paddingBlock: '1',
});

const plannedTitle = css({
	fontFamily: 'heading',
	fontSize: 'lg',
	fontWeight: '700',
	color: 'text.default',
	lineHeight: '1.3',
	letterSpacing: '-0.01em',
});

const plannedDescription = css({
	fontFamily: 'sans',
	fontSize: 'sm',
	color: 'text.muted',
	lineHeight: '1.6',
});

function ToolCard({ tool }: { tool: ToolIndexEntry }) {
	const icon = TOOL_ICONS[tool.slug] ?? FALLBACK_TOOL_ICON;
	const preview = TOOL_PREVIEWS[tool.slug];
	// No `data-tool-state` on an OPEN card: the attribute is the disabled
	// marker the prod-smoke row-classification probe reads
	// (`e2e/prod-smoke.spec.ts`), and it treats "linked kind" as "carries
	// a /tools/<slug> anchor and NO state attribute". A state value on
	// this row would read there as a misclassified row even though
	// nothing is disabled.
	return (
		<li data-tool-slug={tool.slug} className={cardItem}>
			{/* The accessible name comes from the card's own content, NOT
			    from `aria-labelledby`/`aria-label`. The whole card is the
			    link, so its visible text is the name plus the description
			    plus 「開く」; pinning the name to the name alone is what
			    WCAG 2.2 SC 2.5.3 (Label in Name) forbids — the same
			    `label-content-name-mismatch` defect Issue #718 fixed on
			    the home capability links. The axe scan on `/tools`
			    caught it (Issue #785). */}
			<Link
				to="/tools/$slug"
				params={{ slug: tool.slug }}
				className={preview ? cardLink : cardLinkTextOnly}
			>
				{preview ? (
					<img
						alt={preview.alt}
						className={previewImage}
						decoding="async"
						height={preview.height}
						loading="lazy"
						src={preview.src}
						width={preview.width}
					/>
				) : null}
				<span className={titleRow}>
					<MaterialSymbol className={toolIcon} d={icon} size={18} />
					<span data-tool-title className={toolTitle}>
						{tool.display_name}
					</span>
				</span>
				<span className={toolDescription}>{tool.description_ja}</span>
				<span data-tool-cta className={cta}>
					開く
					<MaterialSymbol d={ARROW_FORWARD_PATH} size={16} />
				</span>
			</Link>
		</li>
	);
}

function PlannedToolItem({ tool }: { tool: ToolIndexEntry }) {
	const icon = TOOL_ICONS[tool.slug] ?? FALLBACK_TOOL_ICON;
	return (
		<li data-tool-slug={tool.slug} data-tool-state="host_disabled" className={plannedItem}>
			<span className={titleRow}>
				<MaterialSymbol className={toolIcon} d={icon} size={18} />
				<span className={plannedTitle}>{tool.display_name}</span>
				{/* `data-tool-badge` is the hook e2e/tools-index.spec.ts
				    asserts a host_disabled row by (Issue #195); the
				    visible word stays Japanese. */}
				<Badge
					data-tool-badge="coming-soon"
					className={css({ flexShrink: '0', fontFamily: 'mono', letterSpacing: '0.06em' })}
				>
					準備中
				</Badge>
			</span>
			<span className={plannedDescription}>{tool.description_ja}</span>
		</li>
	);
}
