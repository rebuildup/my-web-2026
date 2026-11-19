import type { Purpose } from './schema';

/**
 * Visitor-facing purpose labels (split from `schema.ts` for Issue
 * #1009): the page needs only these maps, and importing them from the
 * schema module would bundle the whole Zod contract — internal field
 * names included — into the client JavaScript. `Purpose` stays a
 * type-only edge, so `schema.ts` never enters the client graph.
 */
export const PURPOSE_LABEL_JA: Record<Purpose, string> = {
	recruitment: '採用のお問い合わせ',
	technical: '技術的な議論',
	distribution: '配布・公開について',
	'commission-intake': '制作依頼の受け付け',
	other: 'その他',
};

export const PURPOSE_LABEL_EN: Record<Purpose, string> = {
	recruitment: 'Hiring inquiries',
	technical: 'Technical discussion',
	distribution: 'Distribution & publication',
	'commission-intake': 'Commission intake',
	other: 'Other',
};
