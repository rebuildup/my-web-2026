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
	/**
	 * Internal route for the live surface. Only set when status is
	 * `live`; the home capabilities grid uses this as the CTA
	 * target. `planned` capabilities do not expose this field —
	 * they have no surface yet.
	 */
	href?: string;
}
