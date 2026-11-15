import { AdLeaderboard, AdLinkCard, AdNative, AdRect, AdVideo } from './units';

/**
 * Concrete ad placements for the home page (Issue #925, second pass).
 *
 * Direction rules (owner feedback): an ad points at real content — a
 * published Tool — carries a visual, keeps copy minimal, and is built
 * as a designed ad creative rather than a format shell. Every unit
 * below promotes one Tool from the committed registry
 * (`src/tools/manifest.json`) using that Tool's own committed screen
 * capture (`public/tool-previews/<slug>.webp`, the same asset the
 * Tools index renders). Hooks use real ad techniques — a question, an
 * offer chip, a dare — but every claim stays truthful: the tools are
 * free, need no install or account, and run entirely in the browser.
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
// Display rectangle — full-bleed creative, selling a Tool
// ---------------------------------------------------------------------------

export function AdToolRect() {
	return (
		<AdRect
			imageSrc={preview('pi-game')}
			imageAlt="Pi Memory Game の画面。タイトルと数字の盤面。"
			headline="円周率の桁を、どこまで覚えられる？"
			sub="順番に桁を入力する記憶ゲーム。全画面・キーボード対応。"
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
			headline="PDF を、アプリなしで読む。"
			description="ローカルファースト。文書は外へ出ません。"
			domain="rebuildup.dev"
			href="/tools/readmark"
		/>
	);
}
