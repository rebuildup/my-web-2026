import { css, cx } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { Button } from '../../editorial/primitives/Button';
import { Disclosure } from '../../editorial/primitives/Disclosure';
import { EditorialIndex } from '../../editorial/primitives/EditorialIndex';
import { Cluster, Stack, listResetClassName } from '../../editorial/primitives/Flow';
import { Split } from '../../editorial/primitives/Grid';
import { MaterialSymbol } from '../../editorial/primitives/MaterialSymbol';
import { PageHero } from '../../editorial/primitives/PageHero';
import { PageSection } from '../../editorial/primitives/PageSection';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { SkipLink } from '../../editorial/primitives/SkipLink';
import { TextLink } from '../../editorial/primitives/TextLink';
import { ARROW_FORWARD_PATH } from '../../editorial/primitives/material-symbol-paths';
import {
	emphasisDefault,
	noteSansSmLoose,
	noteSansXsBody,
	vStackGap1,
} from '../../editorial/primitives/shared-styles';
import { CodeBlock, DataTable, type TableRow } from '../../editorial/table-code';
import { BIOME_SETTINGS_COLUMNS } from './biome-settings-table';
import type { StackItemView, StackPageData, StackSectionView } from './resolve';
import type { StackCheckStatus, StackFactRow } from './stack';

/**
 * `/stack` page composition (Issue #381).
 *
 * Presentation only — the article data lives in `stack.ts` and the
 * resolved versions arrive through the route loader (`load.ts`), so
 * this component renders exactly what the server resolved and never
 * re-derives a fact.
 *
 * Layout mirrors `/links`: skip link → hero → one section per
 * `STACK_SECTIONS` entry → item rows. Sections are mapped from the
 * data array, so a later Issue appending a section needs no change
 * here.
 *
 * Undetermined contract: an item whose version could not be resolved
 * renders the 「未確定」 badge instead of a guessed value — the same
 * fail-closed posture the data module documents.
 */
/**
 * The stack's own section index with item counts.
 *
 * Issue #1163 — the entry's right column. Each row links to the
 * section it names, so the index is a way into the list rather than
 * a caption of it.
 */
function StackIndex({ sections }: { readonly sections: readonly StackSectionView[] }) {
	return (
		<EditorialIndex
			ariaLabel="Sections"
			items={sections.map((section, index) => ({
				href: `#stack-section-${section.id}`,
				number: String(index + 1).padStart(2, '0'),
				label: section.title,
				meta: `${section.items.length} 件`,
			}))}
		/>
	);
}

export function StackPage({ data }: { data: StackPageData }) {
	return (
		<>
			<SkipLink />
			{/* Issue #1163 — the right column carries the stack's own
			    sections with their item counts, so the entry tells the
			    reader how the list is organised before they read it. */}
			<PageHero
				labelledBy="stack-hero-title"
				eyebrow="my-web-2026 · /stack"
				title="開発スタック / Stack"
				description="このサイトの技術選定を、採用理由と根拠ファイルへのリンク付きで記録した一覧です。version は package.json と profile.yaml から読み取り、判断の背景は各項目の「採用理由」が語ります。検討して見送った案は末尾の Exploration 節に分けています。"
				asideLabel="Sections"
				aside={<StackIndex sections={data.sections} />}
			/>
			<main id="main">
				{data.sections.map((section, index) => (
					<StackSectionBlock key={section.id} section={section} index={index + 1} />
				))}
				{/* Issue #1297 — the closing band: the reference list ends
				    with a next step (contact / the repository itself)
				    instead of dead-ending at the last item. */}
				<PageSection
					labelledBy="stack-closing-heading"
					rhythm="closing"
					tone="inverse"
					separator
					name="contact"
				>
					<SectionHeading
						id="stack-closing-heading"
						eyebrow="Next"
						title="スタックの判断について話す"
						titleEn="Keep in touch"
						description="この一覧は公開リポジトリの設定ファイルと検証記録から生成しています。技術選定の背景・記事執筆の相談・掲載の訂正は contact の verified channel から、実装の一次情報は GitHub repository からどうぞ。"
						variant="spread"
					>
						<Cluster gap="3">
							<Button as="a" href="/contact" variant="primary">
								<span lang="ja">Contact を見る</span>
								<MaterialSymbol d={ARROW_FORWARD_PATH} size={18} />
							</Button>
							<Button
								as="a"
								href="https://github.com/rebuildup/my-web-2026"
								target="_blank"
								rel="noopener noreferrer"
								variant="secondary"
							>
								<span>GitHub repository</span>
								<MaterialSymbol d={ARROW_FORWARD_PATH} size={18} />
							</Button>
						</Cluster>
					</SectionHeading>
				</PageSection>
			</main>
		</>
	);
}

function StackSectionBlock({
	section,
	index,
}: {
	section: StackSectionView;
	index: number;
}) {
	return (
		<PageSection
			labelledBy={`stack-section-${section.id}`}
			separator
			testId={`stack-section-${section.id}`}
		>
			<SectionHeading
				id={`stack-section-${section.id}`}
				eyebrow={`${String(index).padStart(2, '0')} — ${section.titleEn}`}
				title={section.title}
				description={section.description}
				variant="default"
			/>
			<Stack
				as="ul"
				gap="0"
				data-testid={`stack-items-${section.id}`}
				className={cx(listResetClassName, css({ marginBlockStart: '10' }))}
			>
				{section.items.map((item) => (
					<StackItemRow key={item.id} item={item} />
				))}
			</Stack>
		</PageSection>
	);
}

function StackItemRow({ item }: { item: StackItemView }) {
	return (
		<Split as="li" rowGap="4" separated data-testid={`stack-item-${item.id}`}>
			<div
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '2',
					alignItems: 'flex-start',
					minWidth: '0',
				})}
			>
				<h3
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'lg',
						fontWeight: '700',
						color: 'text.default',
					})}
				>
					{item.name}
				</h3>
				<VersionBadge version={item.version} />
			</div>
			<Stack gap="3" className={css({ minWidth: '0' })}>
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'md',
						lineHeight: '1.7',
						color: 'text.default',
					})}
				>
					{item.responsibility}
				</p>
				<p className={css(noteSansSmLoose)}>
					<span className={css(emphasisDefault)}>採用理由 — </span>
					{item.reason}
				</p>
				{item.settings !== undefined && item.settings.length > 0 ? (
					// Issue #1297 — the biome.json dump is reference data,
					// not narrative: it collapses behind a Disclosure so
					// the decision (採用理由 / before-after) reads first.
					<div data-testid={`stack-settings-${item.id}`}>
						<Disclosure summary="biome.json の設定値（リクエスト時にファイルから読み取り）">
							<DataTable
								caption="biome.json の設定値"
								columns={BIOME_SETTINGS_COLUMNS}
								rows={biomeSettingsRows(item.settings)}
								compact
							/>
						</Disclosure>
					</div>
				) : null}
				{item.samples !== undefined && item.samples.length > 0 ? (
					<Stack
						data-testid={`stack-samples-${item.id}`}
						gap="4"
						className={css({ minWidth: '0' })}
					>
						{item.samples.map((sample) => (
							<Stack key={sample.label} gap="2" className={css({ minWidth: '0' })}>
								<CodeBlock label={sample.label} code={sample.code} language={sample.language} />
								{sample.note !== undefined ? (
									<p className={css(noteSansXsBody)}>{sample.note}</p>
								) : null}
							</Stack>
						))}
					</Stack>
				) : null}
				{item.checks !== undefined && item.checks.length > 0 ? (
					<StackChecks checks={item.checks} itemId={item.id} />
				) : null}
				{item.caseStudy !== undefined ? (
					// Issue #1297 — a stack item that a published project
					// documents links INTO that case study, so the
					// reference list connects to the narrative surface.
					<p className={css({ margin: '0' })}>
						<TextLink href={item.caseStudy.href}>
							<span>{item.caseStudy.label}</span>
							<span aria-hidden="true"> →</span>
						</TextLink>
					</p>
				) : null}
				{item.evidence.length > 0 ? (
					<Cluster as="ul" aria-label="根拠 source" className={listResetClassName}>
						{item.evidence.map((link) => (
							<li key={link.href}>
								<TextLink
									href={link.href}
									target="_blank"
									rel="noopener noreferrer"
									className={css({
										fontFamily: 'mono',
										fontSize: 'xs',
										fontWeight: '600',
										display: 'inline-flex',
										alignItems: 'center',
										minHeight: '6',
									})}
								>
									<span>{link.label}</span>
									<span aria-hidden="true">↗</span>
								</TextLink>
							</li>
						))}
					</Cluster>
				) : null}
			</Stack>
		</Split>
	);
}

/**
 * Verification verdicts for the component-integration example
 * (Issue #510). Each check renders its status as a literal token —
 * `pass` / `fail` / `not run` / `not applicable` — so the four states
 * stay distinguishable without relying on colour (the editorial
 * semantic layer carries no status hue, Issue #887). `pass` uses the
 * accent badge tone; every other state stays neutral, because a
 * `not-applicable` verdict is a boundary statement, not a warning.
 */
const CHECK_STATUS_LABEL: Readonly<Record<StackCheckStatus, string>> = {
	pass: 'pass',
	fail: 'fail',
	'not-run': 'not run',
	'not-applicable': 'not applicable',
};

function StackChecks({
	checks,
	itemId,
}: {
	checks: NonNullable<StackItemView['checks']>;
	itemId: string;
}) {
	return (
		<Stack
			as="ul"
			gap="2"
			aria-label="検証状況"
			data-testid={`stack-checks-${itemId}`}
			className={listResetClassName}
		>
			{checks.map((check) => (
				<li
					key={check.id}
					data-testid={`stack-check-${check.id}`}
					data-status={check.status}
					className={css(vStackGap1)}
				>
					<span
						className={css({
							display: 'inline-flex',
							alignItems: 'center',
							gap: '2',
							flexWrap: 'wrap',
						})}
					>
						<Badge tone={check.status === 'pass' ? 'accent' : 'neutral'}>
							<span className={css({ fontFamily: 'mono' })}>
								{CHECK_STATUS_LABEL[check.status]}
							</span>
						</Badge>
						<span
							className={css({
								fontFamily: 'sans',
								fontSize: 'sm',
								fontWeight: '600',
								color: 'text.default',
							})}
						>
							{check.label}
						</span>
					</span>
					{check.note !== undefined ? (
						<span
							className={css({
								fontFamily: 'sans',
								fontSize: 'xs',
								lineHeight: '1.7',
								color: 'text.muted',
							})}
						>
							{check.note}
						</span>
					) : null}
				</li>
			))}
		</Stack>
	);
}

/**
 * Version badge. `resolved` shows the label the loader read from the
 * live source; `undetermined` shows 「未確定」 — never a guess;
 * `none` renders nothing (the item has no meaningful version).
 */
function VersionBadge({ version }: { version: StackItemView['version'] }) {
	if (version.state === 'none') return null;
	if (version.state === 'undetermined') {
		return (
			<Badge tone="neutral">
				<span lang="ja">未確定</span>
			</Badge>
		);
	}
	return (
		<Badge tone="accent">
			<span className={css({ fontFamily: 'mono' })}>{version.label}</span>
		</Badge>
	);
}

function biomeSettingsRows(settings: readonly StackFactRow[]): TableRow[] {
	return settings.map((row) => ({
		key: row.label,
		label: row.label,
		cells: { value: row.value },
	}));
}
