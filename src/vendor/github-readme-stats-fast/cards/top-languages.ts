/**
 * Top languages card renderer for github-readme-stats-fast (Cloudflare Workers adaptation).
 *
 * Adapted from upstream:
 * https://github.com/Pranesh-2005/github-readme-stats-fast/blob/main/src/cards/top-languages.js
 * Commit: 8e2c76e59a9e2407f2c80f4e23704a04e8db21ad
 */

import { Card } from '../common/Card.ts';
import { I18n } from '../common/I18n.ts';
import { createLanguageNode, flexLayout, iconWithLabel, getCardColors } from '../common/utils.ts';
import { themes } from '../themes/index.ts';
import { langCardLocales } from '../translations.ts';

export interface TopLangData {
	[name: string]: {
		name: string;
		color: string | null;
		size: number;
		count: number;
	};
}

interface TopLangCardOptions {
	hide?: string[];
	hide_title?: boolean;
	hide_border?: boolean;
	card_width?: number;
	title_color?: string;
	text_color?: string;
	bg_color?: string;
	theme?: string;
	layout?: string;
	langs_count?: number;
	custom_title?: string;
	locale?: string | null;
	disable_animations?: boolean;
	border_radius?: number;
	border_color?: string;
	hide_progress?: boolean;
}

const LAYOUTS = ['compact', 'normal', 'donut', 'donut-vertical', 'pie'] as const;
type LayoutType = (typeof LAYOUTS)[number];

/**
 * Renders the top languages card.
 */
export function renderTopLanguages(
	topLangs: TopLangData,
	options: Partial<TopLangCardOptions> = {},
): string {
	const {
		hide = [],
		hide_title = false,
		hide_border = false,
		card_width,
		title_color,
		text_color,
		bg_color,
		theme = 'default',
		layout = 'normal',
		langs_count,
		custom_title,
		locale,
		disable_animations = false,
		border_radius,
		border_color,
		hide_progress = false,
	} = options;

	// returns theme based colors with proper overrides and defaults
	const { titleColor, textColor, bgColor, borderColor } = getCardColors({
		title_color,
		text_color,
		icon_color: '',
		bg_color,
		border_color,
		ring_color: '',
		theme,
	});

	const i18n = new I18n({
		locale,
		translations: langCardLocales,
	});

	// Filter out hidden languages
	const filteredLangs = Object.keys(topLangs)
		.filter((key) => !hide.includes(key))
		.reduce((acc, key) => {
			acc[key] = topLangs[key];
			return acc;
		}, {} as TopLangData);

	// Limit languages count
	const langKeys = Object.keys(filteredLangs);
	const limitedLangs = langs_count
		? langKeys.slice(0, parseInt(String(langs_count), 10))
		: langKeys;

	if (limitedLangs.length === 0) {
		// No languages data
		const card = new Card({
			customTitle: custom_title,
			defaultTitle: i18n.t('langcard.title'),
			width: 300,
			height: 100,
			border_radius,
			colors: {
				titleColor,
				textColor,
				iconColor: titleColor,
				bgColor,
				borderColor,
			},
		});
		card.setHideBorder(hide_border);
		card.setHideTitle(hide_title);
		if (disable_animations) card.disableAnimations();
		card.setCSS(`
      .text { font: 600 14px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${textColor}; }
      .gray { fill: #858585 }
    `);
		return card.render(`
      <text x="0" y="20" class="text" text-anchor="middle" data-testid="no-data">
        ${i18n.t('langcard.nodata')}
      </text>
    `);
	}

	// Calculate total size for percentage
	const totalSize = limitedLangs.reduce(
		(sum, key) => sum + filteredLangs[key].size,
		0,
	);

	// Render based on layout
	let body = '';
	let height = 45;
	let width = 300;

	if (layout === 'compact') {
		// Compact layout - horizontal bars
		const items: string[] = [];
		limitedLangs.forEach((key, index) => {
			const lang = filteredLangs[key];
			const percent = ((lang.size / totalSize) * 100).toFixed(1);
			const langNode = createLanguageNode(lang.name, lang.color || '#858585');
			const percentText = `<text class="stat" x="120" y="12.5" data-testid="lang-percent">${percent}%</text>`;
			const barWidth = Math.max((lang.size / totalSize) * 200, 10);
			const bar = `
        <rect x="140" y="2" width="${barWidth}" height="10" rx="2" fill="${lang.color || '#858585'}" />
        <rect x="140" y="2" width="200" height="10" rx="2" fill="none" stroke="${lang.color || '#858585'}" stroke-width="0.5" />
      `;
			items.push(
				`<g transform="translate(0, ${index * 25})">${langNode}${bar}${percentText}</g>`,
			);
		});
		height = 45 + limitedLangs.length * 25;
		width = 400;
		body = flexLayout({ items, gap: 0, direction: 'column' }).join('');
	} else if (layout === 'donut' || layout === 'donut-vertical') {
		// Donut chart layout - simplified as list
		const items: string[] = [];
		limitedLangs.forEach((key, index) => {
			const lang = filteredLangs[key];
			const percent = ((lang.size / totalSize) * 100).toFixed(1);
			const langNode = createLanguageNode(lang.name, lang.color || '#858585');
			const percentText = `<text class="stat" x="120" y="12.5" data-testid="lang-percent">${percent}%</text>`;
			items.push(
				`<g transform="translate(0, ${index * 25})">${langNode}${percentText}</g>`,
			);
		});
		height = 45 + limitedLangs.length * 25;
		width = 350;
		body = flexLayout({ items, gap: 0, direction: 'column' }).join('');
	} else if (layout === 'pie') {
		// Pie chart layout - simplified as list
		const items: string[] = [];
		limitedLangs.forEach((key, index) => {
			const lang = filteredLangs[key];
			const percent = ((lang.size / totalSize) * 100).toFixed(1);
			const langNode = createLanguageNode(lang.name, lang.color || '#858585');
			const percentText = `<text class="stat" x="120" y="12.5" data-testid="lang-percent">${percent}%</text>`;
			items.push(
				`<g transform="translate(0, ${index * 25})">${langNode}${percentText}</g>`,
			);
		});
		height = 45 + limitedLangs.length * 25;
		width = 350;
		body = flexLayout({ items, gap: 0, direction: 'column' }).join('');
	} else {
		// Normal layout - vertical list with progress bars
		const items: string[] = [];
		limitedLangs.forEach((key, index) => {
			const lang = filteredLangs[key];
			const percent = ((lang.size / totalSize) * 100).toFixed(1);
			const langNode = createLanguageNode(lang.name, lang.color || '#858585');
			const countText = iconWithLabel(
				`<path fill-rule="evenodd" d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8zM5 12.25v3.25a.25.25 0 00.4.2l1.45-1.087a.25.25 0 01.3 0L8.6 15.7a.25.25 0 00.4-.2v-3.25a.25.25 0 00-.25-.25h-3.5a.25.25 0 00-.25.25z"/>`,
				lang.count,
				'lang-count',
				12,
			);
			const percentText = `<text class="stat" x="200" y="12.5" data-testid="lang-percent">${percent}%</text>`;
			
			let progressBar = '';
			if (!hide_progress) {
				const barWidth = Math.max((lang.size / totalSize) * 200, 10);
				progressBar = `
          <rect x="140" y="2" width="${barWidth}" height="10" rx="2" fill="${lang.color || '#858585'}" />
          <rect x="140" y="2" width="200" height="10" rx="2" fill="none" stroke="${lang.color || '#858585'}" stroke-width="0.5" />
        `;
			}
			
			items.push(
				`<g transform="translate(0, ${index * 25})">${langNode}${progressBar}${countText}${percentText}</g>`,
			);
		});
		height = 45 + limitedLangs.length * 25;
		width = 400;
		body = flexLayout({ items, gap: 0, direction: 'column' }).join('');
	}

	const card = new Card({
		customTitle: custom_title,
		defaultTitle: i18n.t('langcard.title'),
		width: card_width || width,
		height: hide_title ? height - 30 : height,
		border_radius,
		colors: {
			titleColor,
			textColor,
			iconColor: titleColor,
			bgColor,
			borderColor,
		},
	});

	card.setHideBorder(hide_border);
	card.setHideTitle(hide_title);
	if (disable_animations) card.disableAnimations();

	card.setCSS(`
    .stat { font: 600 14px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${textColor}; }
    .gray { fill: #858585 }
    .stagger { opacity: 0; animation: fadeInAnimation 0.3s ease-in-out forwards; }
  `);

	return card.render(body);
}