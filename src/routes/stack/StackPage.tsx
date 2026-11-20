import { css } from '../../../styled-system/css';
import { Badge } from '../../editorial/primitives/Badge';
import { PageSection } from '../../editorial/primitives/PageSection';
import { SectionHeading } from '../../editorial/primitives/SectionHeading';
import { SkipLink } from '../../editorial/primitives/SkipLink';
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
export function StackPage({ data }: { data: StackPageData }) {
	return (
		<>
			<SkipLink />
			<PageSection rhythm="hero" labelledBy="stack-hero-title">
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					my-web-2026 · /stack
				</span>
				<h1
					id="stack-hero-title"
					lang="ja"
					className={css({
						margin: '0',
						marginBlockStart: '2',
						fontFamily: 'heading',
						fontSize: { base: '3xl', lg: '4xl' },
						fontWeight: '700',
						lineHeight: { base: '1.15', lg: '1.05' },
						color: 'text.default',
						letterSpacing: '-0.03em',
					})}
				>
					開発スタック / Stack
				</h1>
				<p
					lang="ja"
					className={css({
						margin: '0',
						marginBlockStart: '6',
						fontFamily: 'sans',
						fontSize: 'lg',
						lineHeight: '1.6',
						color: 'text.default',
						maxWidth: '640px',
					})}
				>
					このサイトを動かしている技術の一覧です。version は{' '}
					<code className={inlineCodeStyle}>package.json</code> と{' '}
					<code className={inlineCodeStyle}>profile.yaml</code> から読み取り、根拠となる source
					へのリンクを各項目に付けています。開発記事や整備 PR の 参照先として使えます。
				</p>
			</PageSection>
			<main id="main">
				{data.sections.map((section, index) => (
					<StackSectionBlock key={section.id} section={section} index={index + 1} />
				))}
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
			<ul
				data-testid={`stack-items-${section.id}`}
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '0',
					margin: '0',
					marginBlockStart: '10',
					padding: '0',
					listStyle: 'none',
				})}
			>
				{section.items.map((item) => (
					<StackItemRow key={item.id} item={item} />
				))}
			</ul>
		</PageSection>
	);
}

function StackItemRow({ item }: { item: StackItemView }) {
	return (
		<li
			data-testid={`stack-item-${item.id}`}
			className={css({
				display: 'grid',
				gridTemplateColumns: { base: '1fr', lg: 'minmax(0, 4fr) minmax(0, 8fr)' },
				columnGap: { base: '0', lg: '10' },
				rowGap: '3',
				paddingBlock: '6',
				borderBlockStartWidth: '1px',
				borderBlockStartColor: 'border.subtle',
				borderBlockStartStyle: 'solid',
			})}
		>
			<div
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '2',
					alignItems: 'flex-start',
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
			<div
				className={css({
					display: 'flex',
					flexDirection: 'column',
					gap: '3',
				})}
			>
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
				<p
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'sm',
						lineHeight: '1.7',
						color: 'text.muted',
					})}
				>
					<span className={css({ fontWeight: '600', color: 'text.default' })}>採用理由 — </span>
					{item.reason}
				</p>
				{item.settings !== undefined && item.settings.length > 0 ? (
					<div data-testid={`stack-settings-${item.id}`}>
						<DataTable
							caption="biome.json の設定値（リクエスト時にファイルから読み取り）"
							columns={BIOME_SETTINGS_COLUMNS}
							rows={biomeSettingsRows(item.settings)}
							compact
						/>
					</div>
				) : null}
				{item.samples !== undefined && item.samples.length > 0 ? (
					<div
						data-testid={`stack-samples-${item.id}`}
						className={css({ display: 'flex', flexDirection: 'column', gap: '4' })}
					>
						{item.samples.map((sample) => (
							<div
								key={sample.label}
								className={css({ display: 'flex', flexDirection: 'column', gap: '2' })}
							>
								<CodeBlock label={sample.label} code={sample.code} language={sample.language} />
								{sample.note !== undefined ? (
									<p
										className={css({
											margin: '0',
											fontFamily: 'sans',
											fontSize: 'xs',
											lineHeight: '1.6',
											color: 'text.muted',
										})}
									>
										{sample.note}
									</p>
								) : null}
							</div>
						))}
					</div>
				) : null}
				{item.checks !== undefined && item.checks.length > 0 ? (
					<StackChecks checks={item.checks} itemId={item.id} />
				) : null}
				{item.evidence.length > 0 ? (
					<ul
						aria-label="根拠 source"
						className={css({
							display: 'flex',
							flexWrap: 'wrap',
							gap: '2',
							margin: '0',
							padding: '0',
							listStyle: 'none',
						})}
					>
						{item.evidence.map((link) => (
							<li key={link.href}>
								<a
									href={link.href}
									target="_blank"
									rel="noopener noreferrer"
									className={css({
										display: 'inline-flex',
										alignItems: 'center',
										gap: '1',
										fontFamily: 'mono',
										fontSize: 'xs',
										fontWeight: '600',
										color: 'text.accent',
										textDecoration: 'underline',
										textUnderlineOffset: '0.18em',
										textDecorationThickness: '1px',
										_hover: { textDecorationThickness: '2px' },
										_focusVisible: {
											outline: '2px solid {colors.border.focus}',
											outlineOffset: '2px',
										},
									})}
								>
									<span>{link.label}</span>
									<span aria-hidden="true">↗</span>
								</a>
							</li>
						))}
					</ul>
				) : null}
			</div>
		</li>
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
		<ul
			aria-label="検証状況"
			data-testid={`stack-checks-${itemId}`}
			className={css({
				display: 'flex',
				flexDirection: 'column',
				gap: '2',
				margin: '0',
				padding: '0',
				listStyle: 'none',
			})}
		>
			{checks.map((check) => (
				<li
					key={check.id}
					data-testid={`stack-check-${check.id}`}
					data-status={check.status}
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '1',
					})}
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
		</ul>
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

const inlineCodeStyle = css({
	fontFamily: 'mono',
	fontSize: '0.9em',
});
