import type { CurrentProjectRecord } from '../../home/current/types';
import { COLORS, FONT, escapeXml, truncate } from './card';

/**
 * In-progress projects card — `GET /api/v1/github-profile/current`
 * (GitHub profile redesign gap fix, Issue #1216, ADR-0026).
 *
 * The redesigned README dropped `/now`, which took the DECLARED
 * FOCUS roster with it — "what is rebuildup working on right now"
 * disappeared from the profile entirely. This card restores it as
 * a compact sibling of `/activity`: same canvas width, same panel
 * language, same honest-state contract.
 *
 * Data: `currentProjectsLoader` — the SAME composition the site
 * renders (roster + handwritten facts + git snapshot + committed
 * GitHub activity projection). Nothing is fetched at request time
 * and nothing is invented: a project with no measured facts shows
 * its name and one-liner only, exactly like the site section.
 * Weight levels appear only when the owner has written one.
 */

export const CURRENT_WIDTH = 840;
export const CURRENT_HEIGHT = 340;
export const CURRENT_MAX_ROWS = 5;

const PAD = 28;
const HEADER_Y = 52;
const LIST_TOP = 78;
const ROW_H = 44;
const FOOTER_Y = CURRENT_HEIGHT - 14;

const WEIGHT_LABEL: Record<string, { label: string; color: string }> = {
	primary: { label: 'PRIMARY', color: COLORS.accent },
	active: { label: 'ACTIVE', color: COLORS.ok },
	side: { label: 'SIDE', color: COLORS.muted },
	paused: { label: 'PAUSED', color: COLORS.faint },
};

function weightOf(record: CurrentProjectRecord): { label: string; color: string } | null {
	const level = record.weight?.level?.value;
	return level ? (WEIGHT_LABEL[level] ?? null) : null;
}

/**
 * Right-hand row metric. A published weight level wins; otherwise the
 * measured GitHub activity window (commits / PRs over N days) fills the
 * space with real numbers instead of leaving it blank; last updated day
 * is the fallback. All three are facts the loader already validated —
 * nothing is invented here.
 */
function metricOf(
	record: CurrentProjectRecord,
): { text: string; color: string; strong: boolean } | null {
	const weight = weightOf(record);
	if (weight) return { text: weight.label, color: weight.color, strong: true };
	const activity = record.weight?.activity?.value;
	if (activity) {
		const prs =
			activity.pullRequests !== undefined
				? ` · ${activity.pullRequests.toLocaleString('en-US')} PRs`
				: '';
		return {
			text: `${activity.commits.toLocaleString('en-US')} commits${prs} · ${activity.windowDays}d`,
			color: COLORS.muted,
			strong: false,
		};
	}
	const updated = record.updatedOn?.value;
	if (updated) return { text: `updated ${updated}`, color: COLORS.faint, strong: false };
	return null;
}

export function renderCurrentSvg(records: readonly CurrentProjectRecord[], asOf: string): string {
	const parts: string[] = [];
	parts.push(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${CURRENT_WIDTH}" height="${CURRENT_HEIGHT}" viewBox="0 0 ${CURRENT_WIDTH} ${CURRENT_HEIGHT}" role="img" aria-label="Projects in progress">`,
		`<rect width="${CURRENT_WIDTH}" height="${CURRENT_HEIGHT}" rx="16" fill="${COLORS.bg}" stroke="${COLORS.panelStroke}" stroke-width="1"/>`,
	);

	parts.push(
		`<text x="${PAD}" y="${HEADER_Y}" font-family="${FONT}" font-size="26" font-weight="800" fill="${COLORS.text}">In progress</text>`,
		`<text x="${CURRENT_WIDTH - PAD}" y="${HEADER_Y - 4}" text-anchor="end" font-family="${FONT}" font-size="13" fill="${COLORS.muted}">declared + measured · rebuildup.dev</text>`,
	);

	const shown = records.slice(0, CURRENT_MAX_ROWS);
	if (shown.length === 0) {
		parts.push(
			`<text x="${PAD}" y="${LIST_TOP + 20}" font-family="${FONT}" font-size="15" fill="${COLORS.muted}">No projects published right now.</text>`,
		);
	} else {
		shown.forEach((record, i) => {
			const y = LIST_TOP + i * ROW_H;
			const metric = metricOf(record);
			const weight = weightOf(record);
			const nameMax = metric ? 540 : 700;
			const name = truncate(record.name, nameMax, 15);
			const status = truncate(record.statusJa, CURRENT_WIDTH - PAD * 2 - 8, 13);
			parts.push(
				`<circle cx="${PAD + 4}" cy="${y - 4}" r="4" fill="${weight?.color ?? COLORS.accent}"/>`,
				`<text x="${PAD + 18}" y="${y}" font-family="${FONT}" font-size="15" font-weight="700" fill="${COLORS.text}">${escapeXml(name)}</text>`,
			);
			if (metric) {
				parts.push(
					`<text x="${CURRENT_WIDTH - PAD}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="11" ${metric.strong ? 'font-weight="700" letter-spacing="1.5"' : ''} fill="${metric.color}">${escapeXml(metric.text)}</text>`,
				);
			}
			parts.push(
				`<text x="${PAD + 18}" y="${y + 20}" font-family="${FONT}" font-size="13" fill="${COLORS.muted}">${escapeXml(status)}</text>`,
			);
		});
		if (records.length > shown.length) {
			const y = LIST_TOP + shown.length * ROW_H;
			parts.push(
				`<text x="${PAD + 18}" y="${y}" font-family="${FONT}" font-size="12" fill="${COLORS.muted}">+${records.length - shown.length} more on rebuildup.dev</text>`,
			);
		}
	}

	parts.push(
		`<text x="${PAD}" y="${FOOTER_Y}" font-family="${FONT}" font-size="12" fill="${COLORS.muted}">as of ${escapeXml(asOf)} · owner declarations + GitHub-measured activity</text>`,
		'</svg>',
	);
	return parts.join('');
}
