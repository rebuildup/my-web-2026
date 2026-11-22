/**
 * Repo card renderer for github-readme-stats-fast (Cloudflare Workers adaptation).
 *
 * Adapted from upstream:
 * https://github.com/Pranesh-2005/github-readme-stats-fast/blob/main/src/cards/repo.js
 * Commit: 8e2c76e59a9e2407f2c80f4e23704a04e8db21ad
 */

import { Card } from '../common/Card.ts';
import { icons } from '../common/icons.ts';
import { I18n } from '../common/I18n.ts';
import {
	clampValue,
	createLanguageNode,
	encodeHTML,
	flexLayout,
	getCardColors,
	iconWithLabel,
	kFormatter,
	measureText,
	parseEmojis,
	wrapTextMultiline,
} from '../common/utils.ts';
import { repoCardLocales } from '../translations.ts';

const ICON_SIZE = 16;
const DESCRIPTION_LINE_WIDTH = 59;
const DESCRIPTION_MAX_LINES = 3;

export interface RepositoryData {
	name: string;
	nameWithOwner: string;
	isPrivate: boolean;
	isArchived: boolean;
	isTemplate: boolean;
	stargazerCount: number;
	description: string | null;
	primaryLanguage: {
		color: string | null;
		id: string;
		name: string;
	} | null;
	forkCount: number;
	starCount: number;
}

interface RepoCardOptions {
	hide_border?: boolean;
	title_color?: string;
	icon_color?: string;
	text_color?: string;
	bg_color?: string;
	theme?: string;
	border_radius?: number;
	border_color?: string;
	show_owner?: boolean;
	locale?: string | null;
	description_lines_count?: number;
}

/**
 * Retrieves the repository description and wraps it to fit the card width.
 */
const getBadgeSVG = (label: string, textColor: string): string => `
  <g data-testid="badge" class="badge" transform="translate(320, -18)">
    <rect stroke="${textColor}" stroke-width="1" width="70" height="20" x="-12" y="-14" ry="10" rx="10"></rect>
    <text
      x="23" y="-5"
      alignment-baseline="central"
      dominant-baseline="central"
      text-anchor="middle"
      fill="${textColor}"
    >
      ${label}
    </text>
  </g>
`;

/**
 * Renders repository card details.
 */
export function renderRepoCard(
	repo: RepositoryData,
	options: Partial<RepoCardOptions> = {},
): string {
	const {
		name,
		nameWithOwner,
		description,
		primaryLanguage,
		isArchived,
		isTemplate,
		starCount,
		forkCount,
	} = repo;
	const {
		hide_border = false,
		title_color,
		icon_color,
		text_color,
		bg_color,
		show_owner = false,
		theme = 'default_repocard',
		border_radius,
		border_color,
		locale,
		description_lines_count,
	} = options;

	const lineHeight = 10;
	const header = show_owner ? nameWithOwner : name;
	const langName = (primaryLanguage && primaryLanguage.name) || 'Unspecified';
	const langColor = (primaryLanguage && primaryLanguage.color) || '#333';
	const descriptionMaxLines = description_lines_count
		? clampValue(description_lines_count, 1, DESCRIPTION_MAX_LINES)
		: DESCRIPTION_MAX_LINES;

	const desc = parseEmojis(description || 'No description provided');
	const multiLineDescription = wrapTextMultiline(
		desc,
		DESCRIPTION_LINE_WIDTH,
		descriptionMaxLines,
	);
	const descriptionLinesCount = description_lines_count
		? clampValue(description_lines_count, 1, DESCRIPTION_MAX_LINES)
		: multiLineDescription.length;

	const descriptionSvg = multiLineDescription
		.map((line) => `<tspan dy="1.2em" x="25">${encodeHTML(line)}</tspan>`)
		.join('');

	const height =
		(descriptionLinesCount > 1 ? 120 : 110) + descriptionLinesCount * lineHeight;

	const i18n = new I18n({
		locale,
		translations: repoCardLocales,
	});

	// returns theme based colors with proper overrides and defaults
	const colors = getCardColors({
		title_color,
		icon_color,
		text_color,
		bg_color,
		border_color,
		theme,
	});

	const svgLanguage = primaryLanguage
		? createLanguageNode(langName, langColor)
		: '';

	const totalStars = kFormatter(starCount);
	const totalForks = kFormatter(forkCount);
	const svgStars = iconWithLabel(icons.star, totalStars, 'stargazers', ICON_SIZE);
	const svgForks = iconWithLabel(icons.fork, totalForks, 'forkcount', ICON_SIZE);

	const starAndForkCount = flexLayout({
		items: [svgLanguage, svgStars, svgForks],
		sizes: [
			measureText(langName, 12),
			ICON_SIZE + measureText(`${totalStars}`, 12),
			ICON_SIZE + measureText(`${totalForks}`, 12),
		],
		gap: 25,
	}).join('');

	const card = new Card({
		defaultTitle: header.length > 35 ? `${header.slice(0, 35)}...` : header,
		titlePrefixIcon: icons.contribs,
		width: 400,
		height,
		border_radius,
		colors,
	});

	card.disableAnimations();
	card.setHideBorder(hide_border);
	card.setHideTitle(false);
	card.setCSS(`
    .description { font: 400 13px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${colors.textColor} }
    .gray { font: 400 12px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${colors.textColor} }
    .icon { fill: ${colors.iconColor} }
    .badge { font: 600 11px 'Segoe UI', Ubuntu, Sans-Serif; }
    .badge rect { opacity: 0.2 }
  `);

	return card.render(`
    ${
		isTemplate
			? getBadgeSVG(i18n.t('repocard.template'), colors.textColor)
			: isArchived
				? getBadgeSVG(i18n.t('repocard.archived'), colors.textColor)
				: ''
	}

    <text class="description" x="25" y="-5">
      ${descriptionSvg}
    </text>

    <g transform="translate(30, ${height - 75})">
      ${starAndForkCount}
    </g>
  `);
}
