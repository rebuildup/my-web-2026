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

// Discord brand mark (simple-icons geometry), drawn at 16px so the
// chip reads as "Discord" before the status words do (Issue #1216).
const DISCORD_LOGO =
	'M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z';
const DISCORD_BLURPLE = '#5865F2';

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
		`<g transform="translate(10,9) scale(0.667)"><path d="${DISCORD_LOGO}" fill="${DISCORD_BLURPLE}"/></g>`,
		`<circle cx="33" cy="17" r="4.5" fill="${dot}"/>`,
		`<text x="46" y="22" font-family="${FONT}" font-size="13" fill="${COLORS.text}">${escapeXml(clipped)}</text>`,
		`<text x="${PRESENCE_WIDTH - 12}" y="22" text-anchor="end" font-family="${FONT}" font-size="11" fill="${COLORS.faint}">${escapeXml(stamp)}</text>`,
		'</svg>',
	].join('');
}
