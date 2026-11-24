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
export const CURRENT_HEIGHT = 320;
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

export function renderCurrentSvg(records: readonly CurrentProjectRecord[], asOf: string): string {
	const parts: string[] = [];
	parts.push(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${CURRENT_WIDTH}" height="${CURRENT_HEIGHT}" viewBox="0 0 ${CURRENT_WIDTH} ${CURRENT_HEIGHT}" role="img" aria-label="Projects in progress">`,
		`<rect width="${CURRENT_WIDTH}" height="${CURRENT_HEIGHT}" fill="${COLORS.bg}"/>`,
	);

	parts.push(
		`<text x="${PAD}" y="${HEADER_Y}" font-family="${FONT}" font-size="26" font-weight="800" fill="${COLORS.text}">In progress</text>`,
		`<text x="${CURRENT_WIDTH - PAD}" y="${HEADER_Y - 4}" text-anchor="end" font-family="${FONT}" font-size="13" fill="${COLORS.faint}">declared + measured · rebuildup.dev</text>`,
	);

	const shown = records.slice(0, CURRENT_MAX_ROWS);
	if (shown.length === 0) {
		parts.push(
			`<text x="${PAD}" y="${LIST_TOP + 20}" font-family="${FONT}" font-size="15" fill="${COLORS.muted}">No projects published right now.</text>`,
		);
	} else {
		shown.forEach((record, i) => {
			const y = LIST_TOP + i * ROW_H;
			const weight = weightOf(record);
			const nameMax = weight ? 560 : 700;
			const name = truncate(record.name, nameMax, 15);
			const status = truncate(record.statusJa, CURRENT_WIDTH - PAD * 2 - 8, 13);
			parts.push(
				`<circle cx="${PAD + 4}" cy="${y - 4}" r="4" fill="${COLORS.accent}"/>`,
				`<text x="${PAD + 18}" y="${y}" font-family="${FONT}" font-size="15" font-weight="700" fill="${COLORS.text}">${escapeXml(name)}</text>`,
			);
			if (weight) {
				parts.push(
					`<text x="${CURRENT_WIDTH - PAD}" y="${y}" text-anchor="end" font-family="${FONT}" font-size="11" font-weight="700" letter-spacing="1.5" fill="${weight.color}">${escapeXml(weight.label)}</text>`,
				);
			}
			parts.push(
				`<text x="${PAD + 18}" y="${y + 20}" font-family="${FONT}" font-size="13" fill="${COLORS.muted}">${escapeXml(status)}</text>`,
			);
		});
		if (records.length > shown.length) {
			const y = LIST_TOP + shown.length * ROW_H;
			parts.push(
				`<text x="${PAD + 18}" y="${y}" font-family="${FONT}" font-size="12" fill="${COLORS.faint}">+${records.length - shown.length} more on rebuildup.dev</text>`,
			);
		}
	}

	parts.push(
		`<text x="${PAD}" y="${FOOTER_Y}" font-family="${FONT}" font-size="12" fill="${COLORS.faint}">as of ${escapeXml(asOf)} · names and status lines are the owner's declarations</text>`,
		'</svg>',
	);
	return parts.join('');
}
