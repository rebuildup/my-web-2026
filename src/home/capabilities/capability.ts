export type CapabilityStatus = 'live' | 'planned';

export interface Capability {
	/** Stable identifier used in routes and analytics. */
	id: 'portfolio' | 'content' | 'activity';
	/** English short label. */
	label: string;
	/** Japanese short label. */
	labelJa: string;
	/** One-line English summary. */
	summary: string;
	/** One-line Japanese summary. */
	summaryJa: string;
	/** Lifecycle status visible on the home page. */
	status: CapabilityStatus;
}
