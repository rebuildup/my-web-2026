/**
 * PASS fixture — an expanded pseudo-locale word.
 *
 * WCAG 2.2 SC 1.4.10 (AA): a translation can be much longer than the
 * source string and can introduce a run with no space. The specimen
 * mirrors `src/i18n/pseudo-locale.ts` (a 1.5x expanded, decorated word)
 * and declares a break boundary. This file must produce NO violation.
 */
const PSEUDO_LOCALE_WORD = 'próódóóct···náávygáátióón···sééttííngs···cóónfíígúúráátióón···páágéé';

export const PassPseudoLocale = () => (
	<div
		data-reflow-specimen="pseudo-locale"
		data-reflow-kind="pseudo-locale"
		style={{ overflowWrap: 'anywhere', maxWidth: '100%' }}
	>
		{PSEUDO_LOCALE_WORD}
	</div>
);
