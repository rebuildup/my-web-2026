import { css } from '../../styled-system/css';
import { Badge } from '../editorial/primitives/Badge';
import { Container } from '../editorial/primitives/Container';
import { SectionHeading } from '../editorial/primitives/SectionHeading';
import { StateMark } from '../editorial/primitives/StateMark';
import { RichText } from './RichText';
import type {
	FreshnessState,
	IntroductionSection,
	ProjectIntroductionView,
	ProjectSourceProvenance,
} from './types';
import { availabilityLabel, unavailableNotice } from './unavailable-copy';

export interface DotfilesIntroductionPageProps {
	readonly view: ProjectIntroductionView;
}

const SECTION_META: Readonly<
	Record<string, { readonly title: string; readonly description: string }>
> = {
	principles: {
		title: '設計原則',
		description: '上流 README の Principles を、意味を変えずに抜粋しています。',
	},
	layout: {
		title: 'リポジトリ構成',
		description:
			'リポジトリ直下の構成です。各ディレクトリの詳細は README の Layout を参照してください。',
	},
	'agent-launcher': {
		title: 'エージェントランチャー',
		description:
			'公式の Claude Code ログインを保ちながら、provider の切り替えを明示的な opt-in にする薄いランチャーです。',
	},
	'agent-configuration': {
		title: 'エージェント設定の固定',
		description:
			'Claude Code / Codex / OpenCode の共通設定を sibling submodule として固定し、clone ごとの差を作りません。',
	},
	'decisions-and-research': {
		title: '設計判断と調査',
		description: 'なぜこの構成なのかは、上流リポジトリの ADR に記録されています。',
	},
};

const FRESHNESS_LABEL: Readonly<Record<FreshnessState, string>> = {
	current: 'current — 最終確認から 14 日以内',
	stale: 'stale — 最終確認から 14 日以上経過',
	unavailable: 'unavailable — 上流の現在の状態を反映していない',
	unknown: 'unknown — 鮮度を判定できない',
};

const FRESHNESS_MARK: Readonly<Record<FreshnessState, 'ok' | 'degraded' | 'unreachable'>> = {
	current: 'ok',
	stale: 'degraded',
	unavailable: 'unreachable',
	unknown: 'degraded',
};

const linkClassName = css({
	color: 'text.accent',
	textDecoration: 'underline',
	textUnderlineOffset: '2px',
	textDecorationThickness: '1px',
	_focusVisible: {
		outline: '2px solid {colors.border.focus}',
		outlineOffset: '2px',
		borderRadius: '1px',
	},
	_hover: { textDecorationThickness: '2px' },
});

const bodyTextClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'md',
	lineHeight: '1.8',
	color: 'text.default',
	maxWidth: '720px',
});

const sourceNoteClassName = css({
	margin: '0',
	fontFamily: 'sans',
	fontSize: 'sm',
	lineHeight: '1.6',
	color: 'text.muted',
	maxWidth: '720px',
});

function formatDate(iso: string): string {
	const parsed = Date.parse(iso);
	if (!Number.isFinite(parsed)) return '不明';
	return `${new Date(parsed).toISOString().slice(0, 10)} (UTC)`;
}

function commitUrl(source: ProjectSourceProvenance): string {
	return `${source.canonicalUrl}/commit/${source.commitSha}`;
}

/**
 * `/projects/dotfiles` — public introduction to `rebuildup/dotfiles`.
 *
 * The page is a composition of two inputs, and the split is visible in
 * the markup:
 *
 *   - authored Japanese copy explains WHY the repository exists and how
 *     it divides work with `pc-setup`;
 *   - the extracted README excerpt (`RichText` nodes) carries the
 *     upstream principles, layout, launcher summary, agent
 *     configuration summary and ADR list.
 *
 * Nothing here is fetched at request time. The snapshot is committed;
 * the sync runs offline. A missing or stale snapshot is an explicit
 * state, never a silent claim that the text is current.
 */
export function DotfilesIntroductionPage({ view }: DotfilesIntroductionPageProps) {
	const { snapshot, freshness } = view;
	return (
		<>
			<a
				href="#main"
				className={css({
					position: 'absolute',
					left: '0',
					top: '0',
					padding: '2',
					backgroundColor: 'bg.canvas',
					color: 'text.default',
					textDecoration: 'none',
					transform: 'translateY(-200%)',
					_focusVisible: {
						transform: 'translateY(0)',
						outline: '2px solid {colors.border.focus}',
						outlineOffset: '2px',
					},
				})}
			>
				本文へスキップ
			</a>
			<main id="main">
				<section
					aria-labelledby="dotfiles-hero-title"
					className={css({ paddingBlock: { base: '16', lg: '32' } })}
				>
					<Container>
						<span
							className={css({
								fontFamily: 'mono',
								fontSize: 'sm',
								color: 'text.muted',
							})}
						>
							projects · dotfiles
						</span>
						<div
							className={css({
								display: 'flex',
								flexDirection: { base: 'column', lg: 'row' },
								alignItems: { base: 'flex-start', lg: 'flex-end' },
								justifyContent: 'space-between',
								gap: '6',
								marginBlockStart: '2',
							})}
						>
							<div>
								<h1
									id="dotfiles-hero-title"
									className={css({
										margin: '0',
										fontFamily: 'heading',
										fontSize: { base: '3xl', lg: '4xl' },
										fontWeight: '700',
										lineHeight: { base: '1.15', lg: '1.05' },
										letterSpacing: '-0.03em',
										color: 'text.default',
									})}
								>
									dotfiles
								</h1>
								<p
									lang="ja"
									className={css({
										margin: '0',
										marginBlockStart: '2',
										fontFamily: 'sans',
										fontSize: 'md',
										color: 'text.muted',
									})}
								>
									ユーザー設定・エージェント配線・実行時 secret 注入
								</p>
							</div>
							<div
								className={css({
									display: 'flex',
									flexWrap: 'wrap',
									gap: '2',
								})}
							>
								<Badge>user-level config</Badge>
								<Badge>agent wiring</Badge>
								<Badge>runtime secrets</Badge>
							</div>
						</div>
						<p
							lang="ja"
							className={css({
								margin: '0',
								marginBlockStart: '6',
								fontFamily: 'sans',
								fontSize: 'lg',
								lineHeight: '1.8',
								color: 'text.default',
								maxWidth: '720px',
							})}
						>
							dotfiles は、開発マシンのユーザーレベル設定をまとめた公開リポジトリです。OS
							とパッケージの導入は pc-setup が担い、dotfiles はその上に、home
							設定のリンク、エージェント共通設定の固定、Infisical を介した実行時 secret
							注入を重ねます。
						</p>
						{snapshot ? (
							<blockquote
								lang="en"
								className={css({
									margin: '0',
									marginBlockStart: '6',
									paddingInlineStart: '4',
									borderInlineStartWidth: '2px',
									borderInlineStartStyle: 'solid',
									borderInlineStartColor: 'border.subtle',
									maxWidth: '720px',
								})}
							>
								<p
									className={css({
										margin: '0',
										fontFamily: 'sans',
										fontSize: 'md',
										lineHeight: '1.7',
										color: 'text.muted',
									})}
								>
									<RichText nodes={snapshot.introduction.lead} />
								</p>
								<cite
									className={css({
										display: 'block',
										marginBlockStart: '2',
										fontFamily: 'mono',
										fontSize: 'xs',
										fontStyle: 'normal',
										color: 'text.muted',
									})}
								>
									— README,{' '}
									<a
										href={snapshot.source.readmeUrl}
										target="_blank"
										rel="noopener noreferrer"
										className={linkClassName}
									>
										{snapshot.source.owner}/{snapshot.source.repo}
									</a>
								</cite>
							</blockquote>
						) : null}
						<div
							className={css({
								display: 'flex',
								flexWrap: 'wrap',
								gap: '4',
								marginBlockStart: '6',
							})}
						>
							<a
								href="https://github.com/rebuildup/dotfiles"
								target="_blank"
								rel="noopener noreferrer"
								className={css({
									display: 'inline-flex',
									alignItems: 'center',
									minHeight: '10',
									paddingInline: '4',
									borderRadius: 'full',
									backgroundColor: 'bg.accent',
									color: 'text.inverse',
									fontFamily: 'sans',
									fontSize: 'sm',
									fontWeight: '600',
									textDecoration: 'none',
									_focusVisible: {
										outline: '2px solid {colors.border.focus}',
										outlineOffset: '2px',
									},
								})}
							>
								GitHub で見る
							</a>
							{snapshot ? (
								<a
									href={snapshot.source.readmeUrl}
									target="_blank"
									rel="noopener noreferrer"
									className={css({
										display: 'inline-flex',
										alignItems: 'center',
										minHeight: '10',
										paddingInline: '4',
										borderRadius: 'full',
										borderWidth: '1px',
										borderStyle: 'solid',
										borderColor: 'border.subtle',
										color: 'text.default',
										fontFamily: 'sans',
										fontSize: 'sm',
										fontWeight: '600',
										textDecoration: 'none',
										_focusVisible: {
											outline: '2px solid {colors.border.focus}',
											outlineOffset: '2px',
										},
									})}
								>
									この snapshot の README
								</a>
							) : null}
						</div>
					</Container>
				</section>

				<FreshnessNotice view={view} />

				{snapshot ? <BoundarySection snapshot={snapshot} /> : <MissingSnapshotSection />}

				{snapshot
					? snapshot.introduction.sections.map((section, index) => (
							<ReadmeSection key={section.id} section={section} index={index} />
						))
					: null}

				{snapshot && snapshot.introduction.relatedRepositories.length > 0 ? (
					<section
						aria-labelledby="dotfiles-related-heading"
						className={css({ paddingBlock: { base: '10', lg: '16' } })}
					>
						<Container>
							<SectionHeading
								id="dotfiles-related-heading"
								eyebrow="03 — Related"
								title="関連リポジトリ"
								description="上流 README が名指ししている、役割の異なるリポジトリです。"
							/>
							<ul
								className={css({
									listStyle: 'none',
									margin: '0',
									padding: '0',
									display: 'grid',
									gap: '4',
								})}
							>
								{snapshot.introduction.relatedRepositories.map((repo) => (
									<li
										key={repo.url}
										className={css({
											paddingBlock: '4',
											borderBlockStartWidth: '1px',
											borderBlockStartStyle: 'solid',
											borderBlockStartColor: 'border.subtle',
										})}
									>
										<a
											href={repo.url}
											target="_blank"
											rel="noopener noreferrer"
											className={css({
												fontFamily: 'mono',
												fontSize: 'md',
												fontWeight: '600',
												color: 'text.accent',
												textDecoration: 'underline',
												textUnderlineOffset: '2px',
												_focusVisible: {
													outline: '2px solid {colors.border.focus}',
													outlineOffset: '2px',
												},
											})}
										>
											{repo.label}
										</a>
										<p className={sourceNoteClassName} style={{ marginBlockStart: '4px' }}>
											{repo.repo === 'pc-setup'
												? 'OS とパッケージの provisioning。dotfiles が前提とするマシン状態を作ります。'
												: '上流 README が参照する関連リポジトリです。'}
										</p>
									</li>
								))}
							</ul>
						</Container>
					</section>
				) : null}

				<ProvenanceSection view={view} />
			</main>
		</>
	);
}

function BoundarySection({
	snapshot,
}: {
	readonly snapshot: NonNullable<ProjectIntroductionView['snapshot']>;
}) {
	return (
		<section
			aria-labelledby="dotfiles-boundary-heading"
			className={css({ paddingBlock: { base: '10', lg: '16' } })}
		>
			<Container>
				<SectionHeading
					id="dotfiles-boundary-heading"
					eyebrow="01 — Boundary"
					title="dotfiles と pc-setup の境界"
					description="マシンを用意する層と、マシンが用意された後のユーザー設定を分けています。"
				/>
				<div
					className={css({
						display: 'grid',
						gridTemplateColumns: { base: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
						gap: '4',
					})}
				>
					<article
						className={css({
							padding: '6',
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: 'border.subtle',
							borderRadius: 'lg',
						})}
					>
						<Badge tone="accent">dotfiles</Badge>
						<h3
							className={css({
								margin: '0',
								marginBlockStart: '2',
								fontFamily: 'heading',
								fontSize: 'lg',
								fontWeight: '700',
								color: 'text.default',
							})}
						>
							ユーザー設定
						</h3>
						<p className={bodyTextClassName} style={{ marginBlockStart: '8px' }}>
							home/ を $HOME にリンクし、Claude Code / Codex / OpenCode の共通設定を submodule の
							commit で固定します。secret はリポジトリに置かず、プロセス単位で注入します。
						</p>
						<p className={sourceNoteClassName} style={{ marginBlockStart: '8px' }}>
							上流 README の Principles と Layout が、この層の契約です。
						</p>
					</article>
					<article
						className={css({
							padding: '6',
							borderWidth: '1px',
							borderStyle: 'solid',
							borderColor: 'border.subtle',
							borderRadius: 'lg',
						})}
					>
						<Badge>pc-setup</Badge>
						<h3
							className={css({
								margin: '0',
								marginBlockStart: '2',
								fontFamily: 'heading',
								fontSize: 'lg',
								fontWeight: '700',
								color: 'text.default',
							})}
						>
							マシンとパッケージ
						</h3>
						<p className={bodyTextClassName} style={{ marginBlockStart: '8px' }}>
							OS の初期化、パッケージの導入、dotfiles を clone する前の bootstrap
							を担います。ユーザー設定そのものは持ちません。
						</p>
						<p className={sourceNoteClassName} style={{ marginBlockStart: '8px' }}>
							境界は上流 README の Principles と ADR-0002 に記録されています。
						</p>
						<a
							href="https://github.com/rebuildup/pc-setup"
							target="_blank"
							rel="noopener noreferrer"
							className={linkClassName}
						>
							rebuildup/pc-setup
						</a>
					</article>
				</div>
				<p className={sourceNoteClassName} style={{ marginBlockStart: '16px' }}>
					このページの抜粋元:{' '}
					<a
						href={snapshot.source.readmeUrl}
						target="_blank"
						rel="noopener noreferrer"
						className={linkClassName}
					>
						README.md @ {snapshot.source.commitSha.slice(0, 7)}
					</a>
				</p>
			</Container>
		</section>
	);
}

function ReadmeSection({
	section,
	index,
}: {
	readonly section: IntroductionSection;
	readonly index: number;
}) {
	const meta = SECTION_META[section.id] ?? {
		title: section.heading,
		description: '上流 README から抜粋したセクションです。',
	};
	return (
		<section
			aria-labelledby={`dotfiles-section-${section.id}`}
			className={css({
				paddingBlock: { base: '10', lg: '16' },
				borderBlockStartWidth: '1px',
				borderBlockStartStyle: 'solid',
				borderBlockStartColor: 'border.subtle',
			})}
		>
			<Container>
				<SectionHeading
					id={`dotfiles-section-${section.id}`}
					eyebrow={`02.${index + 1} — README`}
					title={meta.title}
					description={meta.description}
				/>
				{section.summary ? (
					<p
						lang="en"
						className={css({
							margin: '0',
							marginBlockEnd: '4',
							fontFamily: 'sans',
							fontSize: 'md',
							lineHeight: '1.8',
							color: 'text.default',
							maxWidth: '720px',
						})}
					>
						<RichText nodes={section.summary} />
					</p>
				) : null}
				{section.structure.length > 0 ? (
					<>
						<h3
							className={css({
								margin: '0',
								marginBlockEnd: '2',
								fontFamily: 'sans',
								fontSize: 'sm',
								fontWeight: '600',
								letterSpacing: '0.04em',
								textTransform: 'uppercase',
								color: 'text.muted',
							})}
						>
							リポジトリ直下
						</h3>
						<ul
							className={css({
								display: 'flex',
								flexWrap: 'wrap',
								gap: '2',
								listStyle: 'none',
								margin: '0',
								padding: '0',
							})}
						>
							{section.structure.map((entry) => (
								<li key={entry}>
									<code
										className={css({
											display: 'inline-block',
											paddingBlock: '1',
											paddingInline: '2',
											borderWidth: '1px',
											borderStyle: 'solid',
											borderColor: 'border.subtle',
											borderRadius: 'md',
											backgroundColor: 'bg.subtle',
											fontFamily: 'mono',
											fontSize: 'sm',
											color: 'text.default',
										})}
									>
										{entry}
									</code>
								</li>
							))}
						</ul>
					</>
				) : null}
				{section.points.length > 0 ? (
					<ul
						lang="en"
						className={css({
							margin: '0',
							marginBlockStart: section.structure.length > 0 ? '6' : '0',
							paddingInlineStart: '4',
							display: 'flex',
							flexDirection: 'column',
							gap: '4',
							maxWidth: '720px',
							fontFamily: 'sans',
							fontSize: 'md',
							lineHeight: '1.8',
							color: 'text.default',
						})}
					>
						{section.points.map((point, pointIndex) => (
							<li key={`${section.id}-${pointIndex}`}>
								<RichText nodes={point} />
							</li>
						))}
					</ul>
				) : null}
				<p className={css({ margin: '0', marginBlockStart: '4' })}>
					<a
						href={section.sourceUrl}
						target="_blank"
						rel="noopener noreferrer"
						className={linkClassName}
					>
						README の「{section.heading}」を読む
					</a>
				</p>
			</Container>
		</section>
	);
}

function FreshnessNotice({ view }: { readonly view: ProjectIntroductionView }) {
	const { snapshot, freshness } = view;
	const isCurrent = freshness === 'current';
	return (
		<section
			aria-labelledby="dotfiles-freshness-heading"
			className={css({ paddingBlock: { base: '2', lg: '4' } })}
		>
			<Container>
				<div
					role="note"
					aria-labelledby="dotfiles-freshness-heading"
					className={css({
						display: 'flex',
						flexWrap: 'wrap',
						alignItems: 'center',
						gap: '4',
						paddingBlock: '2',
						paddingInline: '4',
						borderWidth: '1px',
						borderStyle: 'solid',
						borderColor: 'border.subtle',
						borderRadius: 'md',
						backgroundColor: isCurrent ? 'bg.canvas' : 'bg.subtle',
					})}
				>
					<StateMark kind={FRESHNESS_MARK[freshness]} size="sm" />
					<h2
						id="dotfiles-freshness-heading"
						className={css({
							margin: '0',
							fontFamily: 'mono',
							fontSize: 'xs',
							fontWeight: '600',
							color: 'text.muted',
						})}
					>
						{FRESHNESS_LABEL[freshness]}
					</h2>
					{snapshot ? (
						<p
							className={css({
								margin: '0',
								fontFamily: 'sans',
								fontSize: 'sm',
								color: 'text.muted',
							})}
						>
							最終確認 {formatDate(snapshot.verifiedAt)} · snapshot applied{' '}
							{formatDate(snapshot.appliedAt)}
						</p>
					) : null}
					{snapshot && freshness !== 'current' ? (
						<p
							className={css({
								flexBasis: '100%',
								margin: '0',
								fontFamily: 'sans',
								fontSize: 'sm',
								lineHeight: '1.6',
								color: 'text.default',
							})}
						>
							{freshness === 'unavailable'
								? unavailableNotice(view.reason)
								: '最終確認から時間が経過しています。表示している内容は最新ではない可能性があります。'}
						</p>
					) : null}
				</div>
			</Container>
		</section>
	);
}

function MissingSnapshotSection() {
	return (
		<section
			aria-labelledby="dotfiles-missing-heading"
			className={css({ paddingBlock: { base: '10', lg: '16' } })}
		>
			<Container>
				<h2
					id="dotfiles-missing-heading"
					className={css({
						margin: '0',
						fontFamily: 'heading',
						fontSize: '2xl',
						fontWeight: '700',
						color: 'text.default',
					})}
				>
					紹介データを表示できません
				</h2>
				<p className={bodyTextClassName} style={{ marginBlockStart: '8px' }}>
					このページが参照する snapshot
					を読み込めませんでした。再同期が完了するまで、内容は表示しません。最新の情報は上流リポジトリで確認できます。
				</p>
				<p className={css({ margin: '0', marginBlockStart: '4' })}>
					<a
						href="https://github.com/rebuildup/dotfiles"
						target="_blank"
						rel="noopener noreferrer"
						className={linkClassName}
					>
						rebuildup/dotfiles
					</a>
				</p>
			</Container>
		</section>
	);
}

function ProvenanceSection({ view }: { readonly view: ProjectIntroductionView }) {
	const { snapshot } = view;
	return (
		<section
			aria-labelledby="dotfiles-provenance-heading"
			className={css({
				paddingBlock: { base: '10', lg: '16' },
				borderBlockStartWidth: '1px',
				borderBlockStartStyle: 'solid',
				borderBlockStartColor: 'border.subtle',
			})}
		>
			<Container>
				<SectionHeading
					id="dotfiles-provenance-heading"
					eyebrow="04 — Provenance"
					title="このページについて"
					description="内容は公開 README から生成した snapshot です。表示のたびに上流へ問い合わせることはありません。"
				/>
				{snapshot ? (
					<dl
						className={css({
							display: 'grid',
							gridTemplateColumns: { base: '1fr', lg: 'minmax(0, 3fr) minmax(0, 9fr)' },
							rowGap: '4',
							columnGap: '6',
							margin: '0',
							fontFamily: 'sans',
							fontSize: 'sm',
						})}
					>
						<dt className={css({ color: 'text.muted' })}>README commit</dt>
						<dd className={css({ margin: '0', color: 'text.default' })}>
							<a
								href={commitUrl(snapshot.source)}
								target="_blank"
								rel="noopener noreferrer"
								className={css({
									fontFamily: 'mono',
									color: 'text.accent',
									textDecoration: 'underline',
									textUnderlineOffset: '2px',
								})}
							>
								{snapshot.source.commitSha}
							</a>
						</dd>
						<dt className={css({ color: 'text.muted' })}>README</dt>
						<dd className={css({ margin: '0' })}>
							<a
								href={snapshot.source.readmeUrl}
								target="_blank"
								rel="noopener noreferrer"
								className={linkClassName}
							>
								{snapshot.source.readmePath} @ {snapshot.source.commitSha.slice(0, 7)}
							</a>
						</dd>
						<dt className={css({ color: 'text.muted' })}>README blob</dt>
						<dd
							className={css({
								margin: '0',
								fontFamily: 'mono',
								overflowWrap: 'anywhere',
							})}
						>
							{snapshot.source.readmeBlobSha}
						</dd>
						<dt className={css({ color: 'text.muted' })}>commit date</dt>
						<dd className={css({ margin: '0' })}>{formatDate(snapshot.source.committedAt)}</dd>
						<dt className={css({ color: 'text.muted' })}>last verified</dt>
						<dd className={css({ margin: '0' })}>{formatDate(snapshot.verifiedAt)}</dd>
						<dt className={css({ color: 'text.muted' })}>snapshot applied</dt>
						<dd className={css({ margin: '0' })}>{formatDate(snapshot.appliedAt)}</dd>
						<dt className={css({ color: 'text.muted' })}>availability</dt>
						<dd className={css({ margin: '0' })}>
							{snapshot.availability === 'public' ? 'public' : availabilityLabel(view.reason)}
						</dd>
					</dl>
				) : (
					<p className={bodyTextClassName}>
						snapshot の来歴を表示できません。上流リポジトリの README を直接確認してください。
					</p>
				)}
				<p className={sourceNoteClassName} style={{ marginBlockStart: '24px' }}>
					同期は公開 README・リポジトリ metadata・既定ブランチの commit の 3
					読み取りだけを行い、内容が変わったとき、または週次の再確認が必要なときだけ snapshot
					を更新します。
				</p>
			</Container>
		</section>
	);
}
