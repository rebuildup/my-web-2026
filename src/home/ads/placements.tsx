import { AdLeaderboard, AdLinkCard, AdNative, AdRect, AdVideo } from './units';

/**
 * Concrete ad placements for the home page (Issue #925, second pass).
 *
 * Direction rule (owner feedback): an ad points at real content — a
 * published Tool — and carries a visual. Every unit below promotes one
 * Tool from the committed registry (`src/tools/manifest.json`) using
 * that Tool's own committed screen capture
 * (`public/tool-previews/<slug>.webp`, the same asset the Tools index
 * renders). Copy is deliberately minimal: one hook line plus the CTA,
 * the way image-led display ads actually run. No invented numbers,
 * no fake urgency, no self-referential meta pages.
 */

const preview = (slug: string) => `/tool-previews/${slug}.webp`;

// ---------------------------------------------------------------------------
// Leaderboard — page-top strip, product visual + one-line pitch + CTA
// ---------------------------------------------------------------------------

export function AdTopBanner() {
	return (
		<AdLeaderboard
			imageSrc={preview('mic-level')}
			imageAlt="Mic Level の画面。マイク入力レベルの目盛り表示。"
			headline="マイク音量、OBS と同じ目盛りで。"
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
			body="ブラウザだけで使えるツール、全15個。"
			domain="rebuildup.dev"
			headline="QR Generator — ブラウザで作る QR コード"
			description="テキストや URL から QR コードを生成。色やパラメータを調整して PNG / SVG で保存できます。"
			imageSrc={preview('qr-generator')}
			imageAlt="QR Generator の画面。入力設定と生成結果パネルが並ぶ。"
			href="/tools/qr-generator"
			ctaLabel="ツールを開く"
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
			headline="ブラウザで遊べるタイピングゲーム"
			ctaLabel="今すぐプレイ"
			href="/tools/prototype"
		/>
	);
}

// ---------------------------------------------------------------------------
// Display rectangle — image-led IAB unit, selling a Tool
// ---------------------------------------------------------------------------

export function AdToolRect() {
	return (
		<AdRect
			tone="dark"
			imageSrc={preview('pi-game')}
			imageAlt="Pi Memory Game の画面。タイトルと数字の盤面。"
			headline="円周率の桁を、どこまで覚えられる？"
			sub="順番に桁を入力する記憶ゲーム。"
			ctaLabel="挑戦する"
			href="/tools/pi-game"
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
			headline="PDF をブラウザ内で読む"
			description="ローカルファースト。文書は外へ出ません。"
			domain="rebuildup.dev"
			href="/tools/readmark"
		/>
	);
}
