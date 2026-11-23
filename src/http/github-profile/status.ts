/**
 * GitHub profile status strip — SVG composer (Issue #1196, ADR-0025).
 *
 * The dynamic half of the redesigned profile: GitHub activity and
 * Discord presence as ONE lightweight image the README's "Now"
 * section embeds. Unlike `/card` it carries NO raster work media —
 * the model's `works` field is ignored — so the response stays a few
 * KB and Camo re-fetches stay cheap.
 *
 * Rendering reuses the card's panel chrome and honest-state rules
 * (`card.ts`): fixed dark surface readable on GitHub light/dark, every
 * claim carries its observation time inside the image, and
 * unavailable / stale inputs render their labelled variants — never a
 * guessed value, never a 5xx.
 */

import { COLORS, FONT, formatObserved, renderDiscordPanel, renderGitHubPanel } from './card';
import type { ProfileCardModel } from './model';

export const STATUS_WIDTH = 1200;
export const STATUS_HEIGHT = 172;

const STATUS_PAD_X = 24;
const STATUS_PAD_Y = 12;
const STATUS_PANEL_GAP = 24;

/**
 * Render the status strip. Deterministic for a given model: no clock,
 * no randomness, no external fetch.
 */
export function renderProfileStatusSvg(model: ProfileCardModel): string {
	const panelWidth = Math.floor((STATUS_WIDTH - STATUS_PAD_X * 2 - STATUS_PANEL_GAP) / 2);
	const githubPanel = renderGitHubPanel(model, STATUS_PAD_X, STATUS_PAD_Y, panelWidth);
	const discordPanel = renderDiscordPanel(
		model,
		STATUS_PAD_X + panelWidth + STATUS_PANEL_GAP,
		STATUS_PAD_Y,
		panelWidth,
	);
	const generated = `status generated ${formatObserved(model.generatedAt)}`;

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${STATUS_WIDTH}" height="${STATUS_HEIGHT}" viewBox="0 0 ${STATUS_WIDTH} ${STATUS_HEIGHT}" role="img" aria-label="rebuildup — GitHub and Discord activity status">
<title>rebuildup — GitHub and Discord activity status</title>
<desc>Current GitHub activity and Discord presence for @rebuildup, with observation times.</desc>
<rect width="${STATUS_WIDTH}" height="${STATUS_HEIGHT}" fill="${COLORS.bg}"/>
${githubPanel}
${discordPanel}
<text x="${STATUS_WIDTH - STATUS_PAD_X}" y="${STATUS_HEIGHT - 8}" text-anchor="end" font-family="${FONT}" font-size="14" fill="${COLORS.faint}">${generated}</text>
</svg>`;
}
