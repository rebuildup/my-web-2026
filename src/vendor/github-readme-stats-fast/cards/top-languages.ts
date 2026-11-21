/**
 * Top languages card renderer for github-readme-stats-fast (Cloudflare Workers adaptation).
 *
 * Adapted from upstream:
 * https://github.com/Pranesh-2005/github-readme-stats-fast/blob/main/src/cards/top-languages.js
 * Commit: 8e2c76e59a9e2407f2c80f4e23704a04e8db21ad
 */

import { Card } from '../common/Card.ts';
import { createProgressNode } from '../common/createProgressNode.ts';
import { I18n } from '../common/I18n.ts';
import {
	chunkArray,
	clampValue,
	flexLayout,
	getCardColors,
	lowercaseTrim,
	measureText,
} from '../common/utils.ts';
import { langCardLocales } from '../translations.ts';

const DEFAULT_CARD_WIDTH = 300;
const MIN_CARD_WIDTH = 280;
const DEFAULT_LANG_COLOR = '#858585';
const CARD_PADDING = 25;
const COMPACT_LAYOUT_BASE_HEIGHT = 90;
const MAXIMUM_LANGS_COUNT = 20;

const NORMAL_LAYOUT_DEFAULT_LANGS_COUNT = 5;
const COMPACT_LAYOUT_DEFAULT_LANGS_COUNT = 6;
const DONUT_LAYOUT_DEFAULT_LANGS_COUNT = 5;
const PIE_LAYOUT_DEFAULT_LANGS_COUNT = 6;
const DONUT_VERTICAL_LAYOUT_DEFAULT_LANGS_COUNT = 6;

export interface Lang {
	name: string;
	size: number;
	color?: string | null;
	count?: number;
}

export interface TopLangData {
	[name: string]: Lang;
}

type Layout = 'compact' | 'normal' | 'donut' | 'donut-vertical' | 'pie';

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

const getLongestLang = (arr: Lang[]): Lang =>
	arr.reduce(
		(savedLang, lang) => (lang.name.length > savedLang.name.length ? lang : savedLang),
		{ name: '', size: 0, color: '' },
	);

const degreesToRadians = (angleInDegrees: number): number =>
	angleInDegrees * (Math.PI / 180.0);

const radiansToDegrees = (angleInRadians: number): number =>
	angleInRadians / (Math.PI / 180.0);

const polarToCartesian = (
	centerX: number,
	centerY: number,
	radius: number,
	angleInDegrees: number,
): { x: number; y: number } => {
	const rads = degreesToRadians(angleInDegrees);
	return {
		x: centerX + radius * Math.cos(rads),
		y: centerY + radius * Math.sin(rads),
	};
};

const cartesianToPolar = (
	centerX: number,
	centerY: number,
	x: number,
	y: number,
): { radius: number; angleInDegrees: number } => {
	const radius = Math.sqrt(Math.pow(x - centerX, 2) + Math.pow(y - centerY, 2));
	let angleInDegrees = radiansToDegrees(Math.atan2(y - centerY, x - centerX));
	if (angleInDegrees < 0) {
		angleInDegrees += 360;
	}
	return { radius, angleInDegrees };
};

const getCircleLength = (radius: number): number => 2 * Math.PI * radius;

const calculateCompactLayoutHeight = (totalLangs: number): number =>
	COMPACT_LAYOUT_BASE_HEIGHT + Math.round(totalLangs / 2) * 25;

const calculateNormalLayoutHeight = (totalLangs: number): number =>
	45 + (totalLangs + 1) * 40;

const calculateDonutLayoutHeight = (totalLangs: number): number =>
	215 + Math.max(totalLangs - 5, 0) * 32;

const calculateDonutVerticalLayoutHeight = (totalLangs: number): number =>
	300 + Math.round(totalLangs / 2) * 25;

const calculatePieLayoutHeight = (totalLangs: number): number =>
	300 + Math.round(totalLangs / 2) * 25;

const donutCenterTranslation = (totalLangs: number): number =>
	-45 + Math.max(totalLangs - 5, 0) * 16;

const trimTopLanguages = (
	topLangs: TopLangData,
	langs_count: number,
	hide: string[] = [],
): { langs: Lang[]; totalLanguageSize: number } => {
	let langs = Object.values(topLangs);
	const langsToHide: Record<string, boolean> = {};
	const langsCount = clampValue(langs_count, 1, MAXIMUM_LANGS_COUNT);

	if (hide) {
		hide.forEach((langName) => {
			langsToHide[lowercaseTrim(langName)] = true;
		});
	}

	langs = langs
		.sort((a, b) => b.size - a.size)
		.filter((lang) => !langsToHide[lowercaseTrim(lang.name)])
		.slice(0, langsCount);

	const totalLanguageSize = langs.reduce((acc, curr) => acc + curr.size, 0);

	return { langs, totalLanguageSize };
};

const createProgressTextNode = ({
	width,
	color,
	name,
	progress,
	index,
}: {
	width: number;
	color: string;
	name: string;
	progress: number;
	index: number;
}): string => {
	const staggerDelay = (index + 3) * 150;
	const paddingRight = 95;
	const progressTextX = width - paddingRight + 10;
	const progressWidth = width - paddingRight;

	return `
    <g class="stagger" style="animation-delay: ${staggerDelay}ms">
      <text data-testid="lang-name" x="2" y="15" class="lang-name">${name}</text>
      <text x="${progressTextX}" y="34" class="lang-name">${progress}%</text>
      ${createProgressNode({
			x: 0,
			y: 25,
			color,
			width: progressWidth,
			progress,
			progressBarBackgroundColor: '#ddd',
			delay: staggerDelay + 300,
		})}
    </g>
  `;
};

const createCompactLangNode = ({
	lang,
	totalSize,
	hideProgress,
	index,
}: {
	lang: Lang;
	totalSize: number;
	hideProgress?: boolean;
	index: number;
}): string => {
	const percentage = ((lang.size / totalSize) * 100).toFixed(2);
	const staggerDelay = (index + 3) * 150;
	const color = lang.color || DEFAULT_LANG_COLOR;

	return `
    <g class="stagger" style="animation-delay: ${staggerDelay}ms">
      <circle cx="5" cy="6" r="5" fill="${color}" />
      <text data-testid="lang-name" x="15" y="10" class='lang-name'>
        ${lang.name} ${hideProgress ? '' : `${percentage}%`}
      </text>
    </g>
  `;
};

const createLanguageTextNode = ({
	langs,
	totalSize,
	hideProgress,
}: {
	langs: Lang[];
	totalSize: number;
	hideProgress?: boolean;
}): string => {
	const longestLang = getLongestLang(langs);
	const chunked = chunkArray(langs, langs.length / 2);
	const layouts = chunked.map((array) => {
		const items = array.map((lang, index) =>
			createCompactLangNode({ lang, totalSize, hideProgress, index }),
		);
		return flexLayout({ items, gap: 25, direction: 'column' }).join('');
	});

	const percent = ((longestLang.size / totalSize) * 100).toFixed(2);
	const minGap = 150;
	const maxGap = 20 + measureText(`${longestLang.name} ${percent}%`, 11);
	return flexLayout({
		items: layouts,
		gap: maxGap < minGap ? minGap : maxGap,
	}).join('');
};

const createDonutLanguagesNode = ({
	langs,
	totalSize,
}: {
	langs: Lang[];
	totalSize: number;
}): string => {
	return flexLayout({
		items: langs.map((lang, index) =>
			createCompactLangNode({
				lang,
				totalSize,
				hideProgress: false,
				index,
			}),
		),
		gap: 32,
		direction: 'column',
	}).join('');
};

const renderNormalLayout = (
	langs: Lang[],
	width: number,
	totalLanguageSize: number,
): string => {
	return flexLayout({
		items: langs.map((lang, index) =>
			createProgressTextNode({
				width,
				name: lang.name,
				color: lang.color || DEFAULT_LANG_COLOR,
				progress: parseFloat(
					((lang.size / totalLanguageSize) * 100).toFixed(2),
				),
				index,
			}),
		),
		gap: 40,
		direction: 'column',
	}).join('');
};

const renderCompactLayout = (
	langs: Lang[],
	width: number,
	totalLanguageSize: number,
	hideProgress?: boolean,
): string => {
	const paddingRight = 50;
	const offsetWidth = width - paddingRight;
	let progressOffset = 0;
	const compactProgressBar = langs
		.map((lang) => {
			const percentage = parseFloat(
				((lang.size / totalLanguageSize) * offsetWidth).toFixed(2),
			);

			const progress = percentage < 10 ? percentage + 10 : percentage;

			const output = `
        <rect
          mask="url(#rect-mask)"
          data-testid="lang-progress"
          x="${progressOffset}"
          y="0"
          width="${progress}"
          height="8"
          fill="${lang.color || DEFAULT_LANG_COLOR}"
        />
      `;
			progressOffset += percentage;
			return output;
		})
		.join('');

	return `
  ${
		hideProgress
			? ''
			: `
      <mask id="rect-mask">
          <rect x="0" y="0" width="${offsetWidth}" height="8" fill="white" rx="5"/>
        </mask>
        ${compactProgressBar}
      `
  }
    <g transform="translate(0, ${hideProgress ? '0' : '25'})">
      ${createLanguageTextNode({ langs, totalSize: totalLanguageSize, hideProgress })}
    </g>
  `;
};

const renderDonutVerticalLayout = (
	langs: Lang[],
	totalLanguageSize: number,
): string => {
	const radius = 80;
	const totalCircleLength = getCircleLength(radius);

	const circles: string[] = [];
	let indent = 0;
	let startDelayCoefficient = 1;

	for (const lang of langs) {
		const percentage = (lang.size / totalLanguageSize) * 100;
		const circleLength = totalCircleLength * (percentage / 100);
		const delay = startDelayCoefficient * 100;

		circles.push(`
      <g class="stagger" style="animation-delay: ${delay}ms">
        <circle 
          cx="150"
          cy="100"
          r="${radius}"
          fill="transparent"
          stroke="${lang.color}"
          stroke-width="25"
          stroke-dasharray="${totalCircleLength}"
          stroke-dashoffset="${indent}"
          size="${percentage}"
          data-testid="lang-donut"
        />
      </g>
    `);

		indent += circleLength;
		startDelayCoefficient += 1;
	}

	return `
    <svg data-testid="lang-items">
      <g transform="translate(0, 0)">
        <svg data-testid="donut">
          ${circles.join('')}
        </svg>
      </g>
      <g transform="translate(0, 220)">
        <svg data-testid="lang-names" x="${CARD_PADDING}">
          ${createLanguageTextNode({ langs, totalSize: totalLanguageSize, hideProgress: false })}
        </svg>
      </g>
    </svg>
  `;
};

const renderPieLayout = (langs: Lang[], totalLanguageSize: number): string => {
	const radius = 90;
	const centerX = 150;
	const centerY = 100;

	let startAngle = 0;
	let startDelayCoefficient = 1;

	const paths: string[] = [];

	for (const lang of langs) {
		if (langs.length === 1) {
			paths.push(`
        <circle
          cx="${centerX}"
          cy="${centerY}"
          r="${radius}"
          stroke="none"
          fill="${lang.color}"
          data-testid="lang-pie"
          size="100"
        />
      `);
			break;
		}

		const langSizePart = lang.size / totalLanguageSize;
		const percentage = langSizePart * 100;
		const angle = langSizePart * 360;
		const endAngle = startAngle + angle;

		const startPoint = polarToCartesian(centerX, centerY, radius, startAngle);
		const endPoint = polarToCartesian(centerX, centerY, radius, endAngle);

		const largeArcFlag = angle > 180 ? 1 : 0;
		const delay = startDelayCoefficient * 100;

		paths.push(`
      <g class="stagger" style="animation-delay: ${delay}ms">
        <path
          data-testid="lang-pie"
          size="${percentage}"
          d="M ${centerX} ${centerY} L ${startPoint.x} ${startPoint.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endPoint.x} ${endPoint.y} Z"
          fill="${lang.color}"
        />
      </g>
    `);

		startAngle = endAngle;
		startDelayCoefficient += 1;
	}

	return `
    <svg data-testid="lang-items">
      <g transform="translate(0, 0)">
        <svg data-testid="pie">
          ${paths.join('')}
        </svg>
      </g>
      <g transform="translate(0, 220)">
        <svg data-testid="lang-names" x="${CARD_PADDING}">
          ${createLanguageTextNode({ langs, totalSize: totalLanguageSize, hideProgress: false })}
        </svg>
      </g>
    </svg>
  `;
};

const createDonutPaths = (
	cx: number,
	cy: number,
	radius: number,
	percentages: number[],
): { d: string; percent: number }[] => {
	const paths: { d: string; percent: number }[] = [];
	let startAngle = 0;
	let endAngle = 0;

	const totalPercent = percentages.reduce((acc, curr) => acc + curr, 0);
	for (let i = 0; i < percentages.length; i++) {
		let percent = parseFloat(
			((percentages[i] / totalPercent) * 100).toFixed(2),
		);

		endAngle = 3.6 * percent + startAngle;
		const startPoint = polarToCartesian(cx, cy, radius, endAngle - 90);
		const endPoint = polarToCartesian(cx, cy, radius, startAngle - 90);
		const largeArc = endAngle - startAngle <= 180 ? 0 : 1;

		paths.push({
			percent,
			d: `M ${startPoint.x} ${startPoint.y} A ${radius} ${radius} 0 ${largeArc} 0 ${endPoint.x} ${endPoint.y}`,
		});
		startAngle = endAngle;
	}

	return paths;
};

const renderDonutLayout = (
	langs: Lang[],
	width: number,
	totalLanguageSize: number,
): string => {
	const centerX = width / 3;
	const centerY = width / 3;
	const radius = centerX - 60;
	const strokeWidth = 12;

	const colors = langs.map((lang) => lang.color);
	const langsPercents = langs.map((lang) =>
		parseFloat(((lang.size / totalLanguageSize) * 100).toFixed(2)),
	);

	const langPaths = createDonutPaths(centerX, centerY, radius, langsPercents);

	const donutPaths =
		langs.length === 1
			? `<circle cx="${centerX}" cy="${centerY}" r="${radius}" stroke="${colors[0]}" fill="none" stroke-width="${strokeWidth}" data-testid="lang-donut" size="100"/>`
			: langPaths
					.map((section, index) => {
						const staggerDelay = (index + 3) * 100;
						const delay = staggerDelay + 300;

						return `
       <g class="stagger" style="animation-delay: ${delay}ms">
        <path
          data-testid="lang-donut"
          size="${section.percent}"
          d="${section.d}"
          stroke="${colors[index]}"
          fill="none"
          stroke-width="${strokeWidth}">
        </path>
      </g>
      `;
					})
					.join('');

	const donut = `<svg width="${width}" height="${width}">${donutPaths}</svg>`;

	return `
    <g transform="translate(0, 0)">
      <g transform="translate(0, 0)">
        ${createDonutLanguagesNode({ langs, totalSize: totalLanguageSize })}
      </g>

      <g transform="translate(125, ${donutCenterTranslation(langs.length)})">
        ${donut}
      </g>
    </g>
  `;
};

const noLanguagesDataNode = ({
	color,
	text,
	layout,
}: {
	color: string;
	text: string;
	layout?: string;
}): string => {
	return `
    <text x="${
		layout === 'pie' || layout === 'donut-vertical' ? CARD_PADDING : 0
	}" y="11" class="stat bold" fill="${color}">${text}</text>
  `;
};

export const getDefaultLanguagesCountByLayout = ({
	layout,
	hide_progress,
}: {
	layout?: string;
	hide_progress?: boolean;
}): number => {
	if (layout === 'compact' || hide_progress === true) {
		return COMPACT_LAYOUT_DEFAULT_LANGS_COUNT;
	} else if (layout === 'donut') {
		return DONUT_LAYOUT_DEFAULT_LANGS_COUNT;
	} else if (layout === 'donut-vertical') {
		return DONUT_VERTICAL_LAYOUT_DEFAULT_LANGS_COUNT;
	} else if (layout === 'pie') {
		return PIE_LAYOUT_DEFAULT_LANGS_COUNT;
	} else {
		return NORMAL_LAYOUT_DEFAULT_LANGS_COUNT;
	}
};

/**
 * Renders card that display user's most frequently used programming languages.
 */
export function renderTopLanguages(
	topLangs: TopLangData,
	options: Partial<TopLangCardOptions> = {},
): string {
	const {
		hide_title = false,
		hide_border = false,
		card_width,
		title_color,
		text_color,
		bg_color,
		hide = [],
		hide_progress,
		theme,
		layout,
		custom_title,
		locale,
		langs_count = getDefaultLanguagesCountByLayout({ layout, hide_progress }),
		border_radius,
		border_color,
		disable_animations,
	} = options;

	const i18n = new I18n({
		locale,
		translations: langCardLocales,
	});

	const { langs, totalLanguageSize } = trimTopLanguages(
		topLangs,
		langs_count,
		hide,
	);

	let width = card_width
		? isNaN(card_width)
			? DEFAULT_CARD_WIDTH
			: card_width < MIN_CARD_WIDTH
				? MIN_CARD_WIDTH
				: card_width
		: DEFAULT_CARD_WIDTH;
	let height = calculateNormalLayoutHeight(langs.length);

	const colors = getCardColors({
		title_color,
		text_color,
		bg_color,
		border_color,
		theme,
	});

	let finalLayout = '';
	if (langs.length === 0) {
		height = COMPACT_LAYOUT_BASE_HEIGHT;
		finalLayout = noLanguagesDataNode({
			color: colors.textColor,
			text: i18n.t('langcard.nodata'),
			layout,
		});
	} else if (layout === 'pie') {
		height = calculatePieLayoutHeight(langs.length);
		finalLayout = renderPieLayout(langs, totalLanguageSize);
	} else if (layout === 'donut-vertical') {
		height = calculateDonutVerticalLayoutHeight(langs.length);
		finalLayout = renderDonutVerticalLayout(langs, totalLanguageSize);
	} else if (layout === 'compact' || hide_progress === true) {
		height =
			calculateCompactLayoutHeight(langs.length) + (hide_progress ? -25 : 0);

		finalLayout = renderCompactLayout(
			langs,
			width,
			totalLanguageSize,
			hide_progress,
		);
	} else if (layout === 'donut') {
		height = calculateDonutLayoutHeight(langs.length);
		width = width + 50;
		finalLayout = renderDonutLayout(langs, width, totalLanguageSize);
	} else {
		finalLayout = renderNormalLayout(langs, width, totalLanguageSize);
	}

	const card = new Card({
		customTitle: custom_title,
		defaultTitle: i18n.t('langcard.title'),
		width,
		height,
		border_radius,
		colors,
	});

	if (disable_animations) {
		card.disableAnimations();
	}

	card.setHideBorder(hide_border);
	card.setHideTitle(hide_title);
	card.setCSS(`
    @keyframes slideInAnimation {
      from {
        width: 0;
      }
      to {
        width: calc(100%-100px);
      }
    }
    @keyframes growWidthAnimation {
      from {
        width: 0;
      }
      to {
        width: 100%;
      }
    }
    .stat {
      font: 600 14px 'Segoe UI', Ubuntu, "Helvetica Neue", Sans-Serif; fill: ${colors.textColor};
    }
    @supports(-moz-appearance: auto) {
      /* Selector detects Firefox */
      .stat { font-size:12px; }
    }
    .bold { font-weight: 700 }
    .lang-name {
      font: 400 11px "Segoe UI", Ubuntu, Sans-Serif;
      fill: ${colors.textColor};
    }
    .stagger {
      opacity: 0;
      animation: fadeInAnimation 0.3s ease-in-out forwards;
    }
    #rect-mask rect{
      animation: slideInAnimation 1s ease-in-out forwards;
    }
    .lang-progress{
      animation: growWidthAnimation 0.6s ease-in-out forwards;
    }
    `);

	if (layout === 'pie' || layout === 'donut-vertical') {
		return card.render(finalLayout);
	}

	return card.render(`
    <svg data-testid="lang-items" x="${CARD_PADDING}">
      ${finalLayout}
    </svg>
  `);
}
