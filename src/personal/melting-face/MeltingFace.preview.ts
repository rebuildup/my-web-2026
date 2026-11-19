/**
 * Melting face — preview data (Issue #522).
 *
 * What this module is
 * --------------------
 * The *data* behind the standalone preview of the "melting face"
 * brand motif: the chain 361℃ → 『時間を溶かしています』 → melting
 * face → SNS icon character, the English line 『Lost in time. 🫠 Found
 * it nowhere.』, the copy roles (short / long / icon), and the
 * explanation candidates the issue requires to be kept unresolved.
 *
 * The component (`MeltingFace.tsx`) renders this data; the Storybook
 * story (`MeltingFace.stories.tsx`) mounts it; the document
 * (`docs/brand/melting-face.md`) carries the same strings.
 * `scripts/check-melting-face-preview-parity.test.mjs` keeps the
 * document and this module in step on every `pnpm run test`.
 *
 * What this module is NOT
 * ------------------------
 * It is not approved site copy and it is not a route. The preview is a
 * demo surface under `src/personal/` (Issue #709): it composes
 * `editorial` display primitives only and imports no route, no binding
 * and no peer obligation — `personal -> editorial` is the only edge
 * AGENTS.md §3 declares for it.
 *
 * The honesty rules this module encodes
 * -------------------------------------
 *   - The original artwork is UNVERIFIED: the Miro board is not
 *     accessible, so no production asset is adopted. The icon role is
 *     rendered as an explicitly-labelled placeholder.
 *   - The explanation candidates (熱中 / 時間を惜しみなく投資 /
 *     無駄なこと) contradict each other. They are kept side by side as
 *     CANDIDATES; nothing here resolves the tension.
 *   - Every copy string is a candidate. Which wording (if any) is
 *     published is an owner decision that has not been made.
 */

/** Document-level metadata the preview renders above the motif. */
export interface MeltingFaceDocument {
	readonly title: string;
	readonly status: string;
	readonly source: string;
	readonly verification: string;
	readonly preview: string;
}

/** One `##` section of the document that is not the motif itself. */
export interface MeltingFaceSection {
	/** The `##` heading — byte-identical to the document's heading. */
	readonly heading: string;
	/** The bullet lines, byte-identical to the document's `- ` items. */
	readonly bullets: readonly string[];
}

/** One step of the motif chain, in the issue's order. */
export interface MeltingFaceChainStep {
	/** Stable id — not printed. */
	readonly id: string;
	/** The step label exactly as the issue writes it. */
	readonly label: string;
}

/** The copy the motif carries, split by role. */
export interface MeltingFaceCopy {
	/** The short form — the tagline itself. */
	readonly short: string;
	/** The long form — a candidate sentence, not adopted copy. */
	readonly long: string;
	/** The English line, verbatim from the issue. */
	readonly english: string;
}

/** The icon / character role of the motif. */
export interface MeltingFaceIcon {
	/** Stable id — not printed. */
	readonly id: string;
	/** What the icon IS in the chain (the last step's label). */
	readonly label: string;
	/** Accessible name for the mark — what a screen reader announces. */
	readonly alt: string;
	/** What the text fallback renders when no artwork is available. */
	readonly fallbackText: string;
	/** Why the mark is a placeholder and not a production asset. */
	readonly assetNote: string;
}

/** One explanation candidate — kept, never resolved. */
export interface MeltingFaceExplanation {
	/** Stable id — not printed. */
	readonly id: string;
	/** The candidate phrase, verbatim from the issue. */
	readonly label: string;
	/** The stance the phrase takes toward the motif (a reading, not a fact). */
	readonly stance: string;
}

export const MELTING_FACE_DOCUMENT: MeltingFaceDocument = {
	title: '「時間を溶かしています」モチーフ — melting face preview',
	status: 'Preview / Issue #522',
	source:
		'典拠: Issue #522 本文・Miro 根拠（個人 > samuido > 361℃ > 時間を溶かしています / melting face）',
	verification:
		'機械検証: scripts/check-melting-face-preview-parity.test.mjs・scripts/capture-melting-face.mjs',
	preview: 'プレビュー: src/personal/melting-face/MeltingFace.stories.tsx',
} as const;

/** The motif section heading and its lead sentence. */
export const MELTING_FACE_LEGEND = {
	heading: 'モチーフの連鎖',
	lead: '361℃ → 『時間を溶かしています』 → melting face → SNS アイコンのキャラクター。Issue #522 が挙げる連鎖を、そのままの順で示す。',
} as const;

/**
 * The motif chain, in the order the issue writes it.
 *
 * The order is the issue's, not a ranking: the chain is a sequence of
 * readings of one motif, and this module does not collapse it into a
 * single "official" interpretation.
 */
export const MELTING_FACE_CHAIN: readonly MeltingFaceChainStep[] = [
	{ id: 'degrees', label: '361℃' },
	{ id: 'phrase', label: '『時間を溶かしています』' },
	{ id: 'face', label: 'melting face' },
	{ id: 'icon', label: 'SNS アイコンのキャラクター' },
] as const;

/**
 * The copy, split by role.
 *
 * `short` is the tagline; `long` is a candidate long-form sentence
 * assembled only from elements the issue itself states (361℃, the
 * phrase, melting face, the SNS icon character); `english` is the
 * issue's English line verbatim. None of them is adopted copy — the
 * role split is what the issue asks the component to demonstrate.
 */
export const MELTING_FACE_COPY: MeltingFaceCopy = {
	short: '時間を溶かしています',
	long: '361℃——時間を溶かしています。melting face は、溶けていく顔のモチーフで、SNS アイコンのキャラクター案。',
	english: 'Lost in time. 🫠 Found it nowhere.',
} as const;

/**
 * The icon role.
 *
 * The original image is unverified — the Miro board cannot be read —
 * so the mark is an explicitly-labelled placeholder and NO production
 * asset is adopted (the issue's own rule). `alt` is what the mark
 * announces to assistive technology; `fallbackText` is what the text
 * fallback renders; `assetNote` is the honest status line shown next
 * to the mark.
 */
export const MELTING_FACE_ICON: MeltingFaceIcon = {
	id: 'melting-face',
	label: 'melting face',
	alt: '溶けていく顔のモチーフ（melting face）のプレースホルダー。元のアートワークは未確認のため、検証用の単純な図形で代用している。',
	fallbackText: '🫠 melting face（placeholder）',
	assetNote: '元画像は未確認。placeholder であり、本番アセットは採用していない。',
} as const;

/**
 * The explanation candidates.
 *
 * The issue names three framings that CONTRADICT each other — a
 * melting face can be read as 熱中, as an investment of time, or as
 * 無駄なこと. The issue requires the tension to be kept, not resolved,
 * so all three stay side by side and every one is marked as a
 * candidate. `stance` names the direction each phrase leans WITHOUT
 * deciding which reading is correct.
 */
export const MELTING_FACE_EXPLANATIONS: readonly MeltingFaceExplanation[] = [
	{
		id: 'dream',
		label: '熱中',
		stance: '前向きな説明候補 — 溶けた時間を没頭・夢中として読む案',
	},
	{
		id: 'investment',
		label: '時間を惜しみなく投資',
		stance: '投資としての説明候補 — 費やした時間を投資として読む案',
	},
	{
		id: 'waste',
		label: '無駄なこと',
		stance: '否定的な説明候補 — 溶けた時間を無駄として読む案',
	},
] as const;

/**
 * The bullet lines the motif section of the document carries.
 *
 * The document writes the motif as `連鎖 N:` / `コピー（…）:` /
 * `アイコン:` / `アセット状態:` lines. The parity test compares the
 * document's bullets against the strings this function produces, so
 * the motif on screen and the motif in the document cannot drift.
 */
export function meltingFaceMotifBullets(): readonly string[] {
	const bullets = MELTING_FACE_CHAIN.map((step, index) => `連鎖 ${index + 1}: ${step.label}`);
	bullets.push(`コピー（短文）: ${MELTING_FACE_COPY.short}`);
	bullets.push(`コピー（長文・候補・未採用）: ${MELTING_FACE_COPY.long}`);
	bullets.push(`英語コピー: ${MELTING_FACE_COPY.english}`);
	bullets.push(`アイコンの役割: ${MELTING_FACE_ICON.label} — ${MELTING_FACE_ICON.alt}`);
	bullets.push(`アセット状態: ${MELTING_FACE_ICON.assetNote}`);
	return bullets;
}

/** The document sections after the motif, in document order. */
export const MELTING_FACE_SECTIONS: readonly MeltingFaceSection[] = [
	{
		heading: 'コピーとアイコンの役割',
		bullets: [
			'短文コピー『時間を溶かしています』、長文コピー候補、英語コピー『Lost in time. 🫠 Found it nowhere.』、アイコン（melting face）の 4 つの役割を分離して表示する。',
			'アイコンは文章ではない。コピーが説明を担い、アイコンはモチーフの顔だけを担う。',
			'長文コピーは候補であり、採用済みの文案ではない。',
			'この preview は route を持たず、表示位置は未確定。英日以外の locale は必要になってから対応する。',
		],
	},
	{
		heading: '説明の候補（未決着）',
		bullets: [
			'『熱中』『時間を惜しみなく投資』『無駄なこと』の 3 つの説明候補を、矛盾を消さずに併記する。',
			'3 案は同じモチーフについて矛盾し得る読み方であり、どれが正しい説明かは決めていない。',
			'採否・統合・却下のいずれの決定も行っていない。説明の採用は未決であり、owner の判断を待つ。',
		],
	},
	{
		heading: 'アートワークと fallback',
		bullets: [
			'元画像は未確認（Miro board にアクセスできない）。placeholder で表示し、本番アセットは採用しない。',
			'mark は role="img" と alt テキストを持ち、絵文字と文言だけの fallback 表示も別 story で実レンダリングする。',
			`fallback の文字列表記: ${MELTING_FACE_ICON.fallbackText}`,
			'装飾の drip 動画は prefers-reduced-motion: reduce で止まる。止まっても resting markup が同じ情報を運ぶ。',
			'light / dark は prefers-color-scheme に追従する。色は editorial の semantic token のみを使う。',
		],
	},
	{
		heading: '典拠',
		bullets: [
			'Issue #522 本文 — 対象・完了条件・Miro 上の根拠（個人 > samuido > 361℃ > 時間を溶かしています / melting face）。',
			'Miro board の付箋本文にはアクセスできない。見出し語以外の由来・背景は創作しない。',
			'関連 Issue #380（ページから独立した preview 契約）と #381（技術説明の表示基盤）は参照するが、hard dependency ではない。',
			'#274 Codex ペットとは別の概念であり、ペットの sprite / motion とは無関係。',
		],
	},
	{
		heading: '実装と機械検証',
		bullets: [
			'参照文書（正本）: docs/brand/melting-face.md',
			'preview データ: src/personal/melting-face/MeltingFace.preview.ts',
			'preview component: src/personal/melting-face/MeltingFace.tsx',
			'preview story: src/personal/melting-face/MeltingFace.stories.tsx（Storybook の Preview / Melting face）',
			'一致検証: scripts/check-melting-face-preview-parity.test.mjs（pnpm run test が scripts/*.test.mjs を discovery する）',
			'撮影: scripts/capture-melting-face.mjs（node scripts/capture-melting-face.mjs）',
			'検証画像: docs/verification/brand/melting-face-preview.png・docs/verification/brand/melting-face-fallback.png',
			'一致が壊れたら fail する。差分は「保留」として文書に明記してから直す。判定を緩めて green にする運用は行わない。',
		],
	},
	{
		heading: '未確認（owner 確認待ち）',
		bullets: [
			'Miro board の付箋本文由来の情報（アクセス不可）。モチーフの由来・意図の詳細は創作しない。',
			'元画像・元アートワークの有無と内容は未確認。確認できるまで placeholder のままとする。',
			'3 つの説明候補のどれを（あるいはどれも）採用するかは未決。',
			'長文コピー・英語コピーの採用可否は未決。公開案が決まるまで preview の文字列は候補のまま。',
			'このモチーフをどの公開 surface（SNS アイコン、OG、ヘッダー等）に置くかは未決。route への mount は本 Issue の範囲外。',
		],
	},
] as const;
