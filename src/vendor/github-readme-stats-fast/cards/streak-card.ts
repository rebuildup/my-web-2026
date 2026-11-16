/**
 * Streak card renderer for github-readme-stats-fast (Cloudflare Workers adaptation).
 *
 * Adapted from upstream:
 * https://github.com/Pranesh-2005/github-readme-stats-fast/blob/main/src/cards/streak-card.js
 * Commit: 8e2c76e59a9e2407f2c80f4e23704a04e8db21ad
 */

import { Card } from '../common/Card.ts';
import { I18n } from '../common/I18n.ts';
import { flexLayout, getCardColors } from '../common/utils.ts';

export interface StreakData {
	currentStreak: number;
	longestStreak: number;
	totalContributions: number;
	firstContribution: string;
	currentStreakStart: string;
	currentStreakEnd: string;
	longestStreakStart: string;
	longestStreakEnd: string;
}

interface StreakCardOptions {
	theme?: string;
	hide_border?: boolean;
	title_color?: string;
	text_color?: string;
	bg_color?: string;
	border_color?: string;
}

const streakCardLocales = {
	'streakcard.title': {
		ar: 'سلسلة المساهمات في جيت هاب',
		az: 'GitHub töhfələrinin silsiləsi',
		cn: 'GitHub 贡献连续记录',
		'zh-tw': 'GitHub 貢獻連續記錄',
		cs: 'Řada příspěvků na GitHubu',
		de: 'GitHub-Beitragsstreak',
		en: 'GitHub Contribution Streak',
		bn: 'GitHub অবদানের স্ট্রিক',
		es: 'Racha de contribuciones de GitHub',
		fr: 'Série de contributions GitHub',
		hu: 'GitHub hozzájárulási sorozatok',
		it: 'Serie di contributi GitHub',
		ja: 'GitHub 貢献ストリーク',
		kr: '깃허브 기여 연속 기록',
		nl: 'GitHub-bijdragestreek',
		'pt-pt': 'Sequência de contribuições do GitHub',
		'pt-br': 'Sequência de contribuições do GitHub',
		np: 'गिटहब योगदान श्रृंखला',
		el: 'Σειρά συνεισφορών GitHub',
		ru: 'Серия вкладов GitHub',
		'uk-ua': 'Серія внесків GitHub',
		id: 'Streak Kontribusi GitHub',
		ml: 'GitHub സംഭാവന സ്ട്രീക്ക്',
		my: 'GitHub �円形ഭാഗ 스트릭',
		sk: 'Rad príspevkov na GitHube',
		tr: 'GitHub Katkı Serisi',
		pl: 'Serii wkładów GitHub',
		uz: 'GitHub hissa qo\'shish ketma-ketligi',
		vi: 'Chuỗi đóng góp GitHub',
		se: 'GitHub-bidragsstreak',
	},
	'streakcard.current_streak': {
		ar: 'السلة الحالية',
		az: 'Cari silsilə',
		cn: '当前连续',
		'zh-tw': '目前連續',
		cs: 'Aktuální řada',
		de: 'Aktuelle Serie',
		en: 'Current Streak',
		bn: 'বর্তমান স্ট্রিক',
		es: 'Racha actual',
		fr: 'Série actuelle',
		hu: 'Jelenlegi sor',
		it: 'Serie attuale',
		ja: '現在のストリーク',
		kr: '현재 스트릭',
		nl: 'Huidige reeks',
		'pt-pt': 'Sequência atual',
		'pt-br': 'Sequência atual',
		np: 'वर्तमान श्रृंखला',
		el: 'Τρέχουσα σειρά',
		ru: 'Текущая серия',
		'uk-ua': 'Поточна серія',
		id: 'Streak Saat Ini',
		ml: 'നിലവിലെ സ്ട്രീക്ക്',
		my: 'เหตุการณ์ปัจจุบัน',
		sk: 'Aktuálna rada',
		tr: 'Mevcut Seri',
		pl: 'Obecna seria',
		uz: 'Joriy ketma-ketlik',
		vi: 'Streak Hiện Tại',
		se: 'Nuvarande streak',
	},
	'streakcard.longest_streak': {
		ar: 'أطول سلة',
		az: 'Ən uzun silsilə',
		cn: '最长连续',
		'zh-tw': '最長連續',
		cs: 'Nejdelší řada',
		de: 'Längste Serie',
		en: 'Longest Streak',
		bn: 'সর্বাধিক লম্বা স্ট্রিক',
		es: 'Racha más larga',
		fr: 'Plus longue série',
		hu: 'Leghosszabb sor',
		it: 'Serie più lunga',
		ja: '最長ストリーク',
		kr: '최장 스트릭',
		nl: 'Langste reeks',
		'pt-pt': 'Sequência mais longa',
		'pt-br': 'Sequência mais longa',
		np: 'सबैभन्दा लामो श्रृंखला',
		el: 'Μεγαλύτερη σειρά',
		ru: 'Самая длинная серия',
		'uk-ua': 'Найдовша серія',
		id: 'Streak Terpanjang',
		ml: 'ഏറ്റവും നീണ്ട സ്ട്രീക്ക്',
		my: 'အမြင့်ဆုံး',
		sk: 'Najdlhšia rada',
		tr: 'En Uzun Seri',
		pl: 'Najdłuższa seria',
		uz: 'Eng uzog ketma-ketlik',
		vi: 'Streak Dài Nhất',
		se: 'Längsta streak',
	},
	'streakcard.total_contributions': {
		ar: 'إجمالي المساهمات',
		az: 'Ümumi töhfə',
		cn: '总贡献数',
		'zh-tw': '總貢獻數',
		cs: 'Celkem příspěvků',
		de: 'Gesamtbeiträge',
		en: 'Total Contributions',
		bn: 'মোট অবদান',
		es: 'Contribuciones totales',
		fr: 'Contributions totales',
		hu: 'Összes hozzájárulás',
		it: 'Contributi totali',
		ja: '総貢献数',
		kr: '총 기여 수',
		nl: 'Totaal bijdragen',
		'pt-pt': 'Contribuições totais',
		'pt-br': 'Contribuições totais',
		np: 'कुल योगदान',
		el: 'Σύνολο συνεισφορών',
		ru: 'Всего вкладов',
		'uk-ua': 'Разом внесків',
		id: 'Total Kontribusi',
		ml: 'ആകെ സംഭാവന',
		my: 'စုစုပေါင်းစws',
		sk: 'Celkový počet príspevkov',
		tr: 'Toplam Katkı',
		pl: 'Całkowite wkłady',
		uz: 'Jami hissa qo\'shish',
		vi: 'Tổng Đóng Góp',
		se: 'Totala bidrag',
	},
	'streakcard.first_contribution': {
		ar: 'أول مساهمة',
		az: 'İlk töhfə',
		cn: '首次贡献',
		'zh-tw': '首次貢獻',
		cs: 'První příspěvek',
		de: 'Erster Beitrag',
		en: 'First Contribution',
		bn: 'প্রথম অবদান',
		es: 'Primera contribución',
		fr: 'Première contribution',
		hu: 'Első hozzájárulás',
		it: 'Primo contributo',
		ja: '最初の貢献',
		kr: '첫 기여',
		nl: 'Eerste bijdrage',
		'pt-pt': 'Primeira contribuição',
		'pt-br': 'Primeira contribuição',
		np: 'पहिलो योगदान',
		el: 'Πρώτη συνεισφορά',
		ru: 'Первый вклад',
		'uk-ua': 'Перший внесок',
		id: 'Kontribusi Pertama',
		ml: 'ആദ്യ സംഭാവന',
		my: 'ပထမ円形ഭാഗ',
		sk: 'Prvý príspevok',
		tr: 'İlk Katkı',
		pl: 'Pierwszy wkład',
		uz: 'Birinchi hissa qo\'shish',
		vi: 'Đóng Góp Đầu Tiên',
		se: 'Första bidraget',
	},
};

/**
 * Renders the streak card.
 */
export function renderStreakCard(
	username: string,
	streak: StreakData,
	options: Partial<StreakCardOptions> = {},
): string {
	const {
		theme = 'default',
		hide_border = false,
		title_color,
		text_color,
		bg_color,
		border_color,
	} = options;

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
		locale: null,
		translations: streakCardLocales,
	});

	const card = new Card({
		customTitle: undefined,
		defaultTitle: i18n.t('streakcard.title'),
		width: 400,
		height: 180,
		border_radius: undefined,
		colors: {
			titleColor,
			textColor,
			iconColor: titleColor,
			bgColor,
			borderColor,
		},
	});

	card.setHideBorder(hide_border);
	card.setCSS(`
    .stat { font: 600 14px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${textColor}; }
    .stat.bold { font-weight: 700; }
    .gray { fill: #858585 }
    .stagger { opacity: 0; animation: fadeInAnimation 0.3s ease-in-out forwards; }
  `);

	const items = [
		{
			label: i18n.t('streakcard.current_streak'),
			value: streak.currentStreak.toString(),
			id: 'current-streak',
		},
		{
			label: i18n.t('streakcard.longest_streak'),
			value: streak.longestStreak.toString(),
			id: 'longest-streak',
		},
		{
			label: i18n.t('streakcard.total_contributions'),
			value: streak.totalContributions.toString(),
			id: 'total-contributions',
		},
	];

	const statItems = items.map((item, index) => `
    <g class="stagger" style="animation-delay: ${(index + 3) * 150}ms" transform="translate(25, 0)">
      <text class="stat bold" y="12.5">${item.label}:</text>
      <text class="stat bold" x="140" y="12.5" data-testid="${item.id}">${item.value}</text>
    </g>
  `)

	const dateItems = [
		{
			label: i18n.t('streakcard.first_contribution'),
			value: streak.firstContribution,
			id: 'first-contribution',
		},
	].map((item, index) => `
    <g class="stagger" style="animation-delay: ${(index + 6) * 150}ms" transform="translate(25, 0)">
      <text class="stat" y="12.5">${item.label}:</text>
      <text class="stat" x="140" y="12.5" data-testid="${item.id}">${item.value}</text>
    </g>
  `)

	const lheight = 25;
	const body = `
    <svg x="0" y="0">
      ${flexLayout({ items: statItems, gap: lheight, direction: 'column' }).join('')}
      ${flexLayout({ items: dateItems, gap: lheight, direction: 'column' }).join('')}
    </svg>
  `;

	return card.render(body);
}