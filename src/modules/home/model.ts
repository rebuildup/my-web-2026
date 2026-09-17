/**
 * Pure model types for the home feature.
 *
 * No framework imports allowed in this file. Capabilities and
 * system-status shapes are pure data so the UI layer can render
 * them without leaning on server-only types.
 */

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
	/** Lifecycle status. Only one capability is ever live at a time. */
	status: CapabilityStatus;
}

export type SystemServiceId = 'd1' | 'r2' | 'external-boundary';

export interface SystemService {
	id: SystemServiceId;
	label: string;
	/** Stable, human-readable binding name shown next to the label. */
	binding: string;
	/** Description of what the service does on the platform. */
	description: string;
}

export type SystemServiceHealth = 'ok' | 'degraded' | 'unreachable';

export interface SystemServiceStatus {
	id: SystemServiceId;
	health: SystemServiceHealth;
	/** Optional human-readable detail. Never contains binding internals. */
	detail?: string;
}

export interface HomePageData {
	capabilities: readonly Capability[];
	services: readonly SystemService[];
	statuses: readonly SystemServiceStatus[];
	/** ISO-8601 timestamp the data was assembled. */
	observedAt: string;
}
