export type SystemServiceId = 'd1' | 'r2' | 'external-boundary';

export interface SystemService {
	id: SystemServiceId;
	label: string;
	binding: string;
	description: string;
}

export type SystemServiceHealth = 'ok' | 'degraded' | 'unreachable';

export interface SystemServiceStatus {
	id: SystemServiceId;
	health: SystemServiceHealth;
	detail?: string;
}

export const HEALTH_LABEL: Record<SystemServiceHealth, string> = {
	ok: 'reachable',
	degraded: 'degraded',
	unreachable: 'unreachable',
};
