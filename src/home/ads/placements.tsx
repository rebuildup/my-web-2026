import {
	AdCarousel,
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
 * Concrete ad placements for the home page (Issue #925, second pass).
 *
 * Direction rules (owner feedback): an ad points at real content — a
 * published Tool — carries a visual, keeps copy minimal, and is built
 * as a designed ad creative rather than a format shell. The roster
 * below mixes every format observed live — banner, feed link card,
 * carousel, video spot, playable, display rect, app-install, product
 * listing and native card — because real ad surfaces run many formats
 * at once, each with its own job (reach / consideration / play /
 * install / purchase). Every unit promotes one Tool from the committed
 * registry (`src/tools/manifest.json`) using that Tool's own committed
 * screen capture (`public/tool-previews/<slug>.webp`, the same asset
 * the Tools index renders); the playable unit embeds the chromeless
 * `/tools/<slug>` shell itself — the same surface a visitor gets.
 * Hooks use real ad techniques (question / offer / dare / play) but
 * every claim stays truthful: the tools are free, need no install or
 * account, and run entirely in the browser.
 */

const preview = (slug: string) => `/tool-previews/${slug}.webp`;

// ---------------------------------------------------------------------------
// Leaderboard — page-top banner creative
// ---------------------------------------------------------------------------

export function AdTopBanner() {
	return (
		<AdLeaderboard
			imageSrc={preview('mic-level')}
			imageAlt="Mic Level の画面。マイク入力レベルの目盛り表示。"
			chip="無料・登録不要"
			headline="マイクの音量、もう勘で合わせていませんか？"
			ctaLabel="無料で試す"
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
			description="テキストや URL から QR コードを生成。インストールも登録も不要です。"
			imageSrc={preview('qr-generator')}
			imageAlt="QR Generator の画面。入力設定と生成結果パネルが並ぶ。"
			href="/tools/qr-generator"
			ctaLabel="ツールを開く"
		/>
	);
}

// ---------------------------------------------------------------------------
// Carousel — swipeable multi-tool unit
// ---------------------------------------------------------------------------

export function AdToolCarousel() {
	return (
		<AdCarousel
			items={[
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
			]}
		/>
	);
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
			ctaLabel="無料で使う"
			href="/tools/svg2tsx"
		/>
	);
}

// ---------------------------------------------------------------------------
// Product/listing ad — commerce anatomy, selling a Tool
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

// ---------------------------------------------------------------------------
// Native card — thumbnail teaser unit, selling a Tool
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
