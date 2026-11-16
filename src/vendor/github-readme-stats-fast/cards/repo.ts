/**
 * Repo card renderer for github-readme-stats-fast (Cloudflare Workers adaptation).
 *
 * Adapted from upstream:
 * https://github.com/Pranesh-2005/github-readme-stats-fast/blob/main/src/cards/repo.js
 * Commit: 8e2c76e59a9e2407f2c80f4e23704a04e8db21ad
 */

import { Card } from '../common/Card.ts';
import { I18n } from '../common/I18n.ts';
import { createLanguageNode, flexLayout, iconWithLabel, getCardColors, wrapTextMultiline } from '../common/utils.ts';
import { repoCardLocales } from '../translations.ts';

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
 * Renders the repo card.
 */
export function renderRepoCard(
	repo: RepositoryData,
	options: Partial<RepoCardOptions> = {},
): string {
	const {
		hide_border = false,
		title_color,
		icon_color,
		text_color,
		bg_color,
		theme = 'default',
		border_radius,
		border_color,
		show_owner = false,
		locale,
		description_lines_count,
	} = options;

	const { titleColor, iconColor, textColor, bgColor, borderColor } = getCardColors({
		title_color,
		text_color,
		icon_color,
		bg_color,
		border_color,
		ring_color: '',
		theme,
		fallbackTheme: 'default_repocard',
	});

	const i18n = new I18n({
		locale,
		translations: repoCardLocales,
	});

	const name = show_owner ? repo.nameWithOwner : repo.name;
	const description = repo.description || '';

	const card = new Card({
		customTitle: undefined,
		defaultTitle: name,
		width: 400,
		height: 195,
		border_radius,
		colors: {
			titleColor,
			textColor,
			iconColor,
			bgColor,
			borderColor,
		},
	});

	card.setHideBorder(hide_border);
	card.setCSS(`
    .stat { font: 600 14px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${textColor}; }
    .gray { fill: #858585 }
    .stagger { opacity: 0; animation: fadeInAnimation 0.3s ease-in-out forwards; }
  `);

	// Description lines
	const descLines = wrapTextMultiline(description, 50, description_lines_count || 3);
	const descItems = descLines.map((line, index) => `
    <g class="stagger" style="animation-delay: ${(index + 3) * 150}ms" transform="translate(25, 0)">
      <text class="gray" y="${12.5 + index * 15}">${line}</text>
    </g>
  `).join('');

	// Language node
	let langNode = '';
	if (repo.primaryLanguage) {
		langNode = createLanguageNode(
			repo.primaryLanguage.name,
			repo.primaryLanguage.color || '#858585',
		);
	}

	// Stats row
	const starsIcon = `<path fill-rule="evenodd" d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25zm0 2.445L6.615 5.5a.75.75 0 01-.564.41l-3.097.45 2.24 2.184a.75.75 0 01.216.664l-.528 3.084 2.769-1.456a.75.75 0 01.698 0l2.77 1.456-.53-3.084a.75.75 0 01.216-.664l2.24-2.183-3.096-.45a.75.75 0 01-.564-.41L8 2.694v.001z"/>`;
	const forkIcon = `<path fill-rule="evenodd" d="M5 3.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm0 2.122a2.25 2.25 0 10-1.5 0v.878A2.25 2.25 0 005.75 8.5h1.5v2.128a2.251 2.251 0 101.5 0V8.5h1.5a2.25 2.25 0 002.25-2.25v-.878a2.25 2.25 0 10-1.5 0v.878a.75.75 0 01-.75.75h-4.5A.75.75 0 015 6.25v-.878zm3.75 7.378a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm3-8.75a.75.75 0 100-1.5.75.75 0 000 1.5z"></path>`;

	const starsText = iconWithLabel(starsIcon, repo.starCount, 'stars', 16);
	const forksText = iconWithLabel(forkIcon, repo.forkCount, 'forks', 16);

	const statItems = [
		`<g class="stagger" style="animation-delay: 600ms" transform="translate(25, 0)">${starsText}</g>`,
		`<g class="stagger" style="animation-delay: 750ms" transform="translate(25, 0)">${forksText}</g>`,
	].join('');

	const lheight = 25;
	const body = `
    <svg x="0" y="0">
      ${descItems}
      <g transform="translate(0, ${descLines.length * 15 + 20})">
        ${langNode}
        <svg x="120" y="-12" class="stat" viewBox="0 0 100 20">${statItems}</svg>
      </g>
    </svg>
  `;

	return card.render(body);
}