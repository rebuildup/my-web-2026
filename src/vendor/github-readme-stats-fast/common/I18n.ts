/**
 * I18n class for github-readme-stats-fast (Cloudflare Workers adaptation).
 *
 * Adapted from upstream:
 * https://github.com/Pranesh-2005/github-readme-stats-fast/blob/main/src/common/I18n.js
 * Commit: 8e2c76e59a9e2407f2c80f4e23704a04e8db21ad
 */

export interface Translations {
	[key: string]: {
		[key: string]: string;
	};
}

export class I18n {
	private locale: string;
	private translations: Translations;

	constructor({
		locale,
		translations,
	}: {
		locale: string | null | undefined;
		translations: Translations;
	}) {
		this.locale = (locale || 'en').toLowerCase();
		this.translations = translations;
	}

	t(key: string): string {
		// First try direct key lookup (flat structure with dot-separated keys)
		if (key in this.translations) {
			const localeResult = this.translations[key] as Record<string, string>;
			return localeResult[this.locale] || localeResult.en || key;
		}

		// Fall back to nested structure lookup (split by '.')
		const keys = key.split('.');
		let result: unknown = this.translations;

		for (const k of keys) {
			if (result && typeof result === 'object' && k in result) {
				result = (result as Record<string, unknown>)[k];
			} else {
				return key;
			}
		}

		if (typeof result === 'object' && result !== null) {
			const localeResult = result as Record<string, string>;
			return localeResult[this.locale] || localeResult.en || key;
		}

		return String(result);
	}
}
