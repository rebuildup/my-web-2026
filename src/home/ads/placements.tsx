import {
	AdCarousel,
	type AdCarouselItem,
	AdInstall,
	AdLeaderboard,
	AdLinkCard,
	AdNative,
	AdPlayable,
	AdProduct,
	AdRect,
	AdVideo,
} from './units';

/**
 * Concrete ad placements for the home page (Issue #925).
 *
 * Direction rules (owner feedback): an ad points at real content —
 * a published Tool or a published Portfolio project — carries a
 * visual, and makes only claims that are true of that content. Ads
 * are NOT only Tool ads: the roster mixes Tool creatives with
 * portfolio projects loaded through the real public API
 * (`listPortfolioProjects`, mapped by the route into
 * `HomeAdProject`). Every unit animates in (`adReveal`) and the
 * attention chrome pulses (`ad-pulse`); both honour the shared
 * reduced-motion contract.
 *
 * The roster mixes every observed format — banner, feed link card,
 * carousel, video spot, playable, display rect, app-install, product
 * listing and native card — because real ad surfaces run many formats
 * at once. Layout is ad-defined: a persistent sponsored rail at the
 * viewport's right edge plus in-article breaks inside the article
 * column.
 */

const preview = (slug: string) => `/tool-previews/${slug}.webp`;

/**
 * The narrow project shape the ad surface needs — mapped from the
 * real `PortfolioProject` rows by the route loader, so `home` never
 * imports the portfolio obligation (AGENTS.md §3).
 */
export interface HomeAdProject {
	readonly slug: string;
	readonly title: string;
	readonly summary: string;
	readonly coverUrl: string;
	readonly coverAlt: string;
}

const projectHref = (slug: string) => `/portfolio/${slug}`;

// ---------------------------------------------------------------------------
// Leaderboard — page-top banner creative
// ---------------------------------------------------------------------------

export function AdTopBanner() {
	return (
		<AdLeaderboard
			imageSrc={preview('mic-level')}
			imageAlt="Mic Level の画面。マイク入力レベルの目盛り表示。"
			headline="マイクの音量、もう勘で合わせていませんか？"
			ctaLabel="ツールを開く"
			href="/tools/mic-level"
		/>
	);
}

// ---------------------------------------------------------------------------
// In-feed link card — the Meta anatomy, selling a Tool
// ---------------------------------------------------------------------------

export function AdToolLinkCard() {
	return (
		<AdLinkCard
			advertiser="rebuildup"
			body={[
				'URL を送るたび、QR を作り直していませんか？',
				'・色もパラメータも自由に調整',
				'・PNG / SVG でそのまま保存',
			].join('\n')}
			domain="rebuildup.dev"
			headline="QR Generator — ブラウザで作る QR コード"
			description="テキストや URL から QR コードを生成。"
			imageSrc={preview('qr-generator')}
			imageAlt="QR Generator の画面。入力設定と生成結果パネルが並ぶ。"
			href="/tools/qr-generator"
			ctaLabel="ツールを開く"
		/>
	);
}

// ---------------------------------------------------------------------------
// Carousel — swipeable multi-item unit; Tools plus portfolio projects
// ---------------------------------------------------------------------------

export function AdToolCarousel({
	projects = [],
}: { readonly projects?: readonly HomeAdProject[] }) {
	const items: AdCarouselItem[] = [
		{
			imageSrc: preview('pomodoro'),
			imageAlt: 'Pomodoro の画面。カウントダウンと作業・休憩スケジュール。',
			title: 'Pomodoro — 作業と休憩のタイマー',
			href: '/tools/pomodoro',
		},
		{
			imageSrc: preview('history-quiz'),
			imageAlt: 'History Quiz の画面。空欄入りの歴史クイズ。',
			title: 'History Quiz — 歴史の穴埋めクイズ',
			href: '/tools/history-quiz',
		},
		{
			imageSrc: preview('code-type-p5'),
			imageAlt: 'Code Type p5 の画面。コードが打たれていくアニメーション。',
			title: 'Code Type p5 — タイプ演出メーカー',
			href: '/tools/code-type-p5',
		},
		...projects.slice(0, 2).map((project) => ({
			imageSrc: project.coverUrl,
			imageAlt: project.coverAlt,
			title: project.title,
			href: projectHref(project.slug),
		})),
	];
	return <AdCarousel items={items} />;
}

// ---------------------------------------------------------------------------
// Video spot — 16:9 creative + play affordance, selling a Tool
// ---------------------------------------------------------------------------

export function AdToolVideo() {
	return (
		<AdVideo
			imageSrc={preview('prototype')}
			imageAlt="ProtoType のタイトル画面。Game Start とメニューが並ぶ。"
			durationLabel="0:32"
			headline="3 分で始まる、ブラウザのタイピングゲーム"
			ctaLabel="今すぐプレイ"
			href="/tools/prototype"
		/>
	);
}

// ---------------------------------------------------------------------------
// Playable ad — the product itself, playable inside the ad frame
// ---------------------------------------------------------------------------

export function AdToolPlayable() {
	return (
		<AdPlayable
			embedSrc="/tools/pi-game"
			embedTitle="Pi Memory Game — プレイアブル広告"
			headline="Pi Memory Game"
			domain="rebuildup.dev"
			ctaLabel="フル画面で遊ぶ"
			href="/tools/pi-game"
		/>
	);
}

// ---------------------------------------------------------------------------
// Display rectangle — full-bleed creative, selling a Tool
// ---------------------------------------------------------------------------

export function AdToolRect() {
	return (
		<AdRect
			imageSrc={preview('prototype')}
			imageAlt="ProtoType のタイトル画面。Game Start とメニューが並ぶ。"
			headline="3 分で始まる、ブラウザのタイピングゲーム"
			sub="gsap・three.js・pixi.js で作った演出つき。"
			ctaLabel="プレイする"
			href="/tools/prototype"
		/>
	);
}

// ---------------------------------------------------------------------------
// App-install ad — store-listing anatomy, selling a Tool
// ---------------------------------------------------------------------------

export function AdToolInstall() {
	return (
		<AdInstall
			iconSrc={preview('svg2tsx')}
			iconAlt="SVG to TSX の画面。SVG 入力と TSX 出力ペイン。"
			name="SVG to TSX"
			tagline="SVG を React コンポーネントに変換。色変数化・パス最適化つき。"
			ctaLabel="使ってみる"
			href="/tools/svg2tsx"
		/>
	);
}

// ---------------------------------------------------------------------------
// Product/listing ad — commerce anatomy. Two sources share the anatomy:
// a Tool (fallback) or a real Portfolio project from the public API.
// ---------------------------------------------------------------------------

export function AdToolProduct() {
	return (
		<AdProduct
			imageSrc={preview('fillgen')}
			imageAlt="Fillgen の画面。穴埋めプリントのエディタと出力欄。"
			title="Fillgen — 穴埋め教材ページ生成ツール | Markdown 風テキストから HTML / React を書き出し"
			description="Markdown 風のテキストから穴埋め問題つきの教材ページを生成。印刷してそのまま使えます。"
			domain="rebuildup.dev"
			ctaLabel="使ってみる"
			href="/tools/fillgen"
		/>
	);
}

export function AdPortfolioProduct({ project }: { readonly project: HomeAdProject }) {
	return (
		<AdProduct
			imageSrc={project.coverUrl}
			imageAlt={project.coverAlt}
			title={project.title}
			description={project.summary}
			domain="rebuildup.dev"
			ctaLabel="作品を見る"
			href={projectHref(project.slug)}
		/>
	);
}

// ---------------------------------------------------------------------------
// Native card — thumbnail teaser unit. Tool and Portfolio variants.
// ---------------------------------------------------------------------------

export function AdToolNative() {
	return (
		<AdNative
			imageSrc={preview('readmark')}
			imageAlt="readmark のライブラリ画面。"
			headline="PDF を、アプリなしで読む。"
			description="ローカルファースト。文書は外へ出ません。"
			domain="rebuildup.dev"
			href="/tools/readmark"
		/>
	);
}

/** Second native unit so the rail stack fills the page height. */
export function AdToolNativeCounter() {
	return (
		<AdNative
			imageSrc={preview('text-counter')}
			imageAlt="Text Counter の画面。入力テキストと文字数の計測結果。"
			headline="テキストの文字数、秒で数えられます。"
			description="文字数・バイト数・行数をブラウザだけで計測。"
			domain="rebuildup.dev"
			href="/tools/text-counter"
		/>
	);
}

export function AdPortfolioNative({ project }: { readonly project: HomeAdProject }) {
	return (
		<AdNative
			imageSrc={project.coverUrl}
			imageAlt={project.coverAlt}
			headline={project.title}
			description={project.summary}
			domain="rebuildup.dev"
			href={projectHref(project.slug)}
		/>
	);
}
