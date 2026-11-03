import { css, cx } from '../../styled-system/css';
import {
	DOCUMENT_LANGUAGE,
	LANGUAGE_WCAG_MAPPING,
	type LanguageDocument,
	resolveLanguageRuns,
} from '../i18n/language-of-parts';
import { SectionHeading } from './primitives/SectionHeading';

/**
 * The shipped language-of-parts surface (Issue #409).
 *
 * What this owns
 * --------------
 * The *rendering* of the WCAG 2.2 SC 3.1.2 contract: given a body
 * whose foreign-language runs the policy already classified, write a
 * `lang` attribute on exactly those runs and nothing else. The visual
 * language is `editorial`'s; the decision (which run may be tagged, and
 * with what tag) is `src/i18n/language-of-parts.ts`, which this module
 * reads and never re-decides.
 *
 * Why the attribute is written here rather than in the caller
 * -----------------------------------------------------------
 * A `lang` that a caller may attach to any element is a `lang` nobody
 * audits. Routing every run through
 * {@link resolveLanguageRuns} means the rendered document cannot carry a
 * tag the gate has not classified, and a refusal (a code identifier, a
 * loanword, a malformed tag) is visible in the DOM as
 * `data-lang-verdict` rather than being silently dropped.
 *
 * It is a fixture, not a page
 * --------------------------
 * Every sentence comes from `src/i18n/language-of-parts.ts` and is
 * verification copy: no route mounts this component, because page
 * composition for a mixed-language article is not this Issue's to
 * decide (the Issue explicitly says not to depend on an undetermined
 * page placement). The Storybook gallery
 * (`language-of-parts.stories.tsx`) and
 * `scripts/capture-language-of-parts.mjs` both render THIS module, so
 * the picture a reviewer reads and the picture the capture measures are
 * the same DOM.
 *
 * Contract with the harness
 * -------------------------
 * `scripts/capture-language-of-parts.mjs` reads, in the live DOM:
 *   - `document.documentElement.lang` — SC 3.1.1, which must equal
 *     {@link DOCUMENT_LANGUAGE};
 *   - `[data-language-document]` — one per body, valued by the fixture
 *     document id;
 *   - `[data-lang-part]` — one per authored part, carrying
 *     `data-lang-verdict` and, when the policy tagged it, `lang`.
 * Keep the attribute names stable: the measurement is meaningless
 * against a document the harness cannot find.
 */

export interface LanguageOfPartsProps {
	document: LanguageDocument;
	/**
	 * The 縮小表示 state: the same body in a narrow column, so reflow
	 * is what is being looked at rather than the tagging. The capture
	 * does NOT claim reflow conformance from this — see the
	 * `checked: 'human'` row of {@link LANGUAGE_WCAG_MAPPING}.
	 */
	compact?: boolean;
	/** Render the per-run verdict table under the body (the 失敗 state). */
	showVerdicts?: boolean;
}

const bodyClassName = css({
	margin: 0,
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.9',
	color: 'text.default',
	textWrap: 'pretty',
});

const verdictListClassName = css({
	display: 'flex',
	flexDirection: 'column',
	gap: '2',
	margin: 0,
	marginBlockStart: '5',
	padding: 0,
	listStyle: 'none',
	borderBlockStart: '1px solid {colors.border.subtle}',
	paddingBlockStart: '4',
});

function Run({ run }: { run: ReturnType<typeof resolveLanguageRuns>[number] }) {
	if (run.part === null) {
		return <>{run.text}</>;
	}
	const shared = {
		'data-lang-part': run.part.id,
		'data-lang-verdict': run.verdict,
	} as const;
	// A code identifier keeps `<code>` whether or not it is tagged: that
	// is the distinction a screen reader announces, and it is why the
	// policy refuses a `lang` on it in the first place.
	if (run.part.kind === 'code') {
		return <code {...shared}>{run.text}</code>;
	}
	if (run.lang !== null) {
		return (
			<span {...shared} lang={run.lang}>
				{run.text}
			</span>
		);
	}
	return <span {...shared}>{run.text}</span>;
}

/**
 * `LanguageOfParts` — one body, with the parts its policy classified.
 *
 * The document element's `lang` is NOT written here: SC 3.1.1 belongs
 * to the document (the Worker renders `<html lang="ja">`), and a nested
 * `lang` equal to the document language would be exactly the redundant
 * attribute the policy refuses.
 */
export function LanguageOfParts({
	document,
	compact = false,
	showVerdicts = false,
}: LanguageOfPartsProps) {
	const runs = resolveLanguageRuns(document);
	// The gallery renders the `normal` document twice (full width and
	// 320 px), so the heading id has to stay unique per instance or the
	// second panel's `aria-labelledby` would resolve to the first one.
	const headingId = `language-heading-${document.id}${compact ? '-compact' : ''}`;
	const columnClassName = compact
		? css({
				maxWidth: '320px',
				borderInlineStart: '2px solid {colors.border.subtle}',
				paddingInlineStart: '4',
			})
		: css({ maxWidth: '68ch' });

	return (
		<section
			data-language-document={document.id}
			data-language-case={document.case}
			data-language-compact={compact ? 'true' : 'false'}
			aria-labelledby={headingId}
		>
			<SectionHeading
				id={headingId}
				eyebrow={`WCAG 2.2 3.1.2 (A) — document lang: ${DOCUMENT_LANGUAGE}`}
				title={document.title}
				description={document.note}
			/>
			<p className={cx(bodyClassName, columnClassName)} data-language-body={document.id}>
				{runs.map((run, index) => (
					// Runs are positional, not unique: the same prose can appear
					// twice in one body, so the identity is the part id plus
					// the position it was authored at.
					<Run key={`${run.part?.id ?? 'text'}-${index}`} run={run} />
				))}
			</p>
			{showVerdicts ? (
				<ul className={verdictListClassName} data-language-verdicts={document.id}>
					{runs
						.filter((run) => run.part !== null)
						.map((run) => (
							<li
								key={run.part?.id}
								className={css({
									display: 'flex',
									flexWrap: 'wrap',
									gap: '3',
									fontFamily: 'mono',
									fontSize: 'xs',
									lineHeight: '1.7',
									color: 'text.muted',
								})}
							>
								<span data-lang-part-id={run.part?.id}>{run.part?.id}</span>
								<span data-lang-verdict-of={run.part?.id}>{run.verdict}</span>
								<span data-lang-tag-of={run.part?.id}>lang={run.lang ?? '(none)'}</span>
								<span>{run.part?.note}</span>
							</li>
						))}
				</ul>
			) : null}
		</section>
	);
}

/**
 * The WCAG mapping the fixture stands behind, machine rows first.
 *
 * Rendered by the Storybook gallery so the verification artefact shows
 * which claims a gate decides and which ones are still a person's job.
 */
export function LanguageOfPartsCriteria() {
	return (
		<table className={css({ borderCollapse: 'collapse', fontSize: 'sm', width: '100%' })}>
			<caption
				className={css({
					marginBlockEnd: '3',
					fontFamily: 'mono',
					fontSize: 'xs',
					letterSpacing: '0.06em',
					textTransform: 'uppercase',
					color: 'text.muted',
					textAlign: 'start',
				})}
			>
				機械検査と人間の評価の区別
			</caption>
			<thead>
				<tr>
					{['SC (WCAG 2.2)', '主張', '検査', '方法'].map((heading) => (
						<th
							key={heading}
							scope="col"
							className={css({
								borderBlockEnd: '1px solid {colors.border.subtle}',
								padding: '2',
								fontFamily: 'mono',
								fontSize: 'xs',
								textAlign: 'start',
								color: 'text.default',
							})}
						>
							{heading}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{LANGUAGE_WCAG_MAPPING.map((row) => (
					<tr key={row.criterion} data-wcag-checked={row.checked}>
						<th
							scope="row"
							className={css({
								borderBlockEnd: '1px solid {colors.border.subtle}',
								padding: '2',
								textAlign: 'start',
								fontWeight: '600',
								color: 'text.default',
							})}
						>
							{row.criterion} ({row.level})
						</th>
						<td
							className={css({
								borderBlockEnd: '1px solid {colors.border.subtle}',
								padding: '2',
								color: 'text.default',
							})}
						>
							{row.claim}
						</td>
						<td
							className={css({
								borderBlockEnd: '1px solid {colors.border.subtle}',
								padding: '2',
								fontFamily: 'mono',
								color: row.checked === 'machine' ? 'text.default' : 'text.muted',
							})}
						>
							{row.checked}
						</td>
						<td
							className={css({
								borderBlockEnd: '1px solid {colors.border.subtle}',
								padding: '2',
								color: 'text.muted',
							})}
						>
							{row.how}
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
