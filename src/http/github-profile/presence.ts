import { formatJst } from './activity';
import { COLORS, FONT, escapeXml, truncate } from './card';
import type { ProfileCardModel } from './model';

/**
 * Discord presence chip — `GET /api/v1/github-profile/presence`
 * (GitHub profile redesign, rebuildup/rebuildup#8).
 *
 * A small self-contained SVG (one line + status dot) the README can
 * embed next to other badges. Unlike `/status` and `/now` it does not
 * depend on the GitHub activity snapshot at all — presence freshness
 * and activity freshness update independently (the redesign's core
 * data-separation requirement).
 *
 * Honest states: fresh presence shows status + detail + JST-free
 * observation stamp; stale shows "last seen"; unavailable renders a
 * neutral "presence unavailable" chip — never a guess.
 */

export const PRESENCE_WIDTH = 460;
export const PRESENCE_HEIGHT = 34;

const STATUS_COLORS: Record<string, string> = {
	Online: COLORS.ok,
	Idle: '#d29922',
	'Do Not Disturb': COLORS.offline,
	Offline: COLORS.offline,
	Unknown: COLORS.stale,
};

export function renderPresenceSvg(model: ProfileCardModel): string {
	const discord = model.discord;
	let dot: string = COLORS.offline;
	let text = 'presence unavailable';
	let stamp = '';
	if (discord.state === 'ok') {
		dot = STATUS_COLORS[discord.statusLabel ?? ''] ?? COLORS.stale;
		const detail = discord.detail ? ` — ${discord.detail}` : '';
		text = `${discord.statusLabel ?? 'Unknown'}${detail}`;
		stamp = discord.observedAt ? `observed ${formatJst(discord.observedAt)}` : '';
	} else if (discord.state === 'stale') {
		dot = COLORS.stale;
		text = 'presence stale';
		stamp = discord.observedAt ? `last seen ${formatJst(discord.observedAt)}` : '';
	}
	const clipped = truncate(text, 240, 13);
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${PRESENCE_WIDTH}" height="${PRESENCE_HEIGHT}" viewBox="0 0 ${PRESENCE_WIDTH} ${PRESENCE_HEIGHT}" role="img" aria-label="Discord presence">`,
		`<rect width="${PRESENCE_WIDTH}" height="${PRESENCE_HEIGHT}" rx="17" fill="${COLORS.panel}" stroke="${COLORS.panelStroke}" stroke-width="1"/>`,
		`<circle cx="20" cy="17" r="5" fill="${dot}"/>`,
		`<text x="34" y="22" font-family="${FONT}" font-size="13" fill="${COLORS.text}">${escapeXml(clipped)}</text>`,
		`<text x="${PRESENCE_WIDTH - 12}" y="22" text-anchor="end" font-family="${FONT}" font-size="11" fill="${COLORS.faint}">${escapeXml(stamp)}</text>`,
		'</svg>',
	].join('');
}
