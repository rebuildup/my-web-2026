import { css, cx } from '../../styled-system/css';
import { Stack, listResetClassName } from '../editorial/primitives/Flow';
import { Grid } from '../editorial/primitives/Grid';
import { PageSection } from '../editorial/primitives/PageSection';
import { Panel } from '../editorial/primitives/Panel';
import { SectionHeading } from '../editorial/primitives/SectionHeading';
import { SkipLink } from '../editorial/primitives/SkipLink';
import { TextLink } from '../editorial/primitives/TextLink';
import {
	COMMISSION_REQUIREMENTS,
	COMMISSION_SERVICE_GROUPS,
	COMMISSION_SOFTWARE,
	COMMISSION_STEPS,
} from './commission';

/**
 * The hairline box the outlined callouts share (requirements note,
 * contact note, process steps): `Panel variant="plain"` owns the
 * surface decision, this owns only the border the plain variant does
 * not draw.
 */
const hairlineBox = css({
	borderWidth: '1px',
	borderStyle: 'solid',
	borderColor: 'border.subtle',
});

/**
 * `/commission` page composition (Issue #390; status contract per
 * the parked spikes #368 / #369).
 *
 * The page is honest about intake state first: the commission mode
 * is `parked` in the approved `/about` narrative, so the status
 * notice renders ABOVE the service descriptions and there is no
 * form, no price list and no "request now" affordance anywhere on
 * the page. Everything below the notice is informational — what
 * the service covers and what a request would need — ported from
 * the predecessor site's commission pages.
 */
export function CommissionPage() {
	return (
		<>
			<SkipLink />
			<PageSection rhythm="hero" labelledBy="commission-hero-title">
				<span
					className={css({
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					my-web-2026 · /commission
				</span>
				<h1
					id="commission-hero-title"
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
					制作依頼 / Commission
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
					Web 開発・アプリケーション開発・映像制作の依頼についての案内です。
				</p>
			</PageSection>
			<main id="main">
				<StatusSection />
				<ServicesSection />
				<ProcessSection />
				<RequirementsSection />
				<SoftwareSection />
				<ContactSection />
			</main>
		</>
	);
}

/**
 * The intake status — rendered first and unmissable. The wording is
 * bound to the parked fact in `src/about/data.ts`; if that fact
 * changes, this notice changes with it (same PR, same review).
 */
function StatusSection() {
	return (
		<PageSection labelledBy="commission-status-heading" separator>
			<SectionHeading
				id="commission-status-heading"
				eyebrow="Status"
				title="受付状況"
				titleEn="Intake status"
			/>
			<Panel
				variant="surface"
				padding="6"
				radius="md"
				data-testid="commission-status"
				className={css({ marginBlockStart: '6' })}
			>
				<p
					lang="ja"
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'lg',
						fontWeight: '600',
						color: 'text.default',
					})}
				>
					現在、制作依頼の受付は休止しています。
				</p>
				<p
					lang="ja"
					className={css({
						margin: '0',
						marginBlockStart: '3',
						fontFamily: 'sans',
						fontSize: 'md',
						lineHeight: '1.6',
						color: 'text.muted',
						maxWidth: '640px',
					})}
				>
					以下は依頼内容の案内です。受付を再開した場合は、このページと
					<TextLink href="/contact">/contact</TextLink>
					の掲載 channel でお知らせします。休止中のため、依頼フォームや料金表は公開していません。
				</p>
			</Panel>
		</PageSection>
	);
}

function ServicesSection() {
	return (
		<PageSection labelledBy="commission-services-heading" separator>
			<SectionHeading
				id="commission-services-heading"
				eyebrow="01 — Services"
				title="依頼できる内容"
				titleEn="What can be requested"
			/>
			<Grid columns={2} gap="10" className={css({ marginBlockStart: '10' })}>
				{COMMISSION_SERVICE_GROUPS.map((group) => (
					<div key={group.id}>
						<h3
							className={css({
								margin: '0',
								fontFamily: 'heading',
								fontSize: 'xl',
								fontWeight: '700',
								color: 'text.default',
							})}
						>
							{group.title}
							<span lang="en" className={css({ color: 'text.muted', fontSize: 'md' })}>
								{' '}
								/ {group.titleEn}
							</span>
						</h3>
						<Stack
							as="ul"
							gap="4"
							className={cx(listResetClassName, css({ marginBlockStart: '4' }))}
						>
							{group.services.map((service) => (
								<li key={service.title}>
									<div
										className={css({
											fontFamily: 'sans',
											fontSize: 'md',
											fontWeight: '600',
											color: 'text.default',
										})}
									>
										{service.title}
									</div>
									{service.description ? (
										<p
											className={css({
												margin: '0',
												marginBlockStart: '1',
												fontFamily: 'sans',
												fontSize: 'sm',
												color: 'text.muted',
											})}
										>
											{service.description}
										</p>
									) : null}
									{service.items ? (
										<Stack
											as="ul"
											gap="1"
											className={cx(listResetClassName, css({ marginBlockStart: '2' }))}
										>
											{service.items.map((item) => (
												<li
													key={item}
													className={css({
														fontFamily: 'sans',
														fontSize: 'sm',
														color: 'text.muted',
													})}
												>
													{item}
												</li>
											))}
										</Stack>
									) : null}
								</li>
							))}
						</Stack>
					</div>
				))}
			</Grid>
		</PageSection>
	);
}

function ProcessSection() {
	return (
		<PageSection labelledBy="commission-process-heading" separator>
			<SectionHeading
				id="commission-process-heading"
				eyebrow="02 — Process"
				title="依頼の流れ"
				titleEn="How a request flows"
			/>
			<Stack
				as="ol"
				gap="4"
				className={cx(listResetClassName, css({ marginBlockStart: '8', maxWidth: '720px' }))}
			>
				{COMMISSION_STEPS.map((step) => (
					<Panel
						as="li"
						key={step.step}
						variant="plain"
						padding="4"
						radius="md"
						className={cx(hairlineBox, css({ display: 'flex', gap: '4' }))}
					>
						<span
							aria-hidden="true"
							className={css({
								flexShrink: '0',
								width: '8',
								height: '8',
								display: 'inline-flex',
								alignItems: 'center',
								justifyContent: 'center',
								fontFamily: 'mono',
								fontSize: 'sm',
								fontWeight: '700',
								color: 'text.default',
								borderWidth: '1px',
								borderStyle: 'solid',
								borderColor: 'border.subtle',
								borderRadius: 'full',
							})}
						>
							{step.step}
						</span>
						<div>
							<div
								className={css({
									fontFamily: 'sans',
									fontSize: 'md',
									fontWeight: '600',
									color: 'text.default',
								})}
							>
								{step.title}
							</div>
							<p
								className={css({
									margin: '0',
									marginBlockStart: '1',
									fontFamily: 'sans',
									fontSize: 'sm',
									color: 'text.muted',
								})}
							>
								{step.description}
							</p>
						</div>
					</Panel>
				))}
			</Stack>
		</PageSection>
	);
}

function RequirementsSection() {
	return (
		<PageSection labelledBy="commission-requirements-heading" separator>
			<SectionHeading
				id="commission-requirements-heading"
				eyebrow="03 — Requirements"
				title="見積もりに必要な情報"
				titleEn="What an estimate needs"
			/>
			<Panel
				variant="plain"
				padding="6"
				radius="md"
				className={cx(hairlineBox, css({ marginBlockStart: '6', maxWidth: '720px' }))}
			>
				<p
					lang="ja"
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'md',
						color: 'text.default',
					})}
				>
					受付再開後、依頼時に以下を伺います:
				</p>
				<Stack as="ul" gap="2" className={cx(listResetClassName, css({ marginBlockStart: '4' }))}>
					{COMMISSION_REQUIREMENTS.map((item) => (
						<li
							key={item}
							className={css({
								fontFamily: 'sans',
								fontSize: 'md',
								color: 'text.default',
							})}
						>
							{item}
						</li>
					))}
				</Stack>
				<p
					lang="ja"
					className={css({
						margin: '0',
						marginBlockStart: '4',
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					場合によっては、追加で音源やイラスト、曲名などを伺うことがあります。
				</p>
			</Panel>
		</PageSection>
	);
}

function SoftwareSection() {
	return (
		<PageSection labelledBy="commission-software-heading" separator>
			<SectionHeading
				id="commission-software-heading"
				eyebrow="04 — Software"
				title="使用ソフトウェア"
				titleEn="Software used"
			/>
			<Grid columns={4} gap="6" className={css({ marginBlockStart: '8' })}>
				{COMMISSION_SOFTWARE.map((group) => (
					<div key={group.title}>
						<h3
							className={css({
								margin: '0',
								fontFamily: 'heading',
								fontSize: 'md',
								fontWeight: '700',
								color: 'text.default',
							})}
						>
							{group.title}
							<span lang="en" className={css({ color: 'text.muted', fontSize: 'sm' })}>
								{' '}
								/ {group.titleEn}
							</span>
						</h3>
						<Stack
							as="ul"
							gap="1"
							className={cx(listResetClassName, css({ marginBlockStart: '2' }))}
						>
							{group.tools.map((tool) => (
								<li
									key={tool}
									className={css({
										fontFamily: 'sans',
										fontSize: 'sm',
										color: 'text.muted',
									})}
								>
									{tool}
								</li>
							))}
						</Stack>
					</div>
				))}
			</Grid>
		</PageSection>
	);
}

function ContactSection() {
	return (
		<PageSection labelledBy="commission-contact-heading" separator>
			<SectionHeading
				id="commission-contact-heading"
				eyebrow="05 — Contact"
				title="連絡方法"
				titleEn="How to reach"
			/>
			<Panel
				variant="plain"
				padding="6"
				radius="md"
				className={cx(hairlineBox, css({ marginBlockStart: '6', maxWidth: '720px' }))}
			>
				<p
					lang="ja"
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'md',
						color: 'text.default',
					})}
				>
					連絡は
					<TextLink href="/contact">/contact</TextLink>
					に掲載している verified channel
					経由で行います。このページにはメールアドレスを直接掲載していません。
				</p>
				<p
					lang="ja"
					className={css({
						margin: '0',
						marginBlockStart: '3',
						fontFamily: 'sans',
						fontSize: 'sm',
						color: 'text.muted',
					})}
				>
					通話などでのミーティングの対応は行っていません。料金は公開していません。受付再開後、依頼内容に応じて個別にお見積もりします。
				</p>
			</Panel>
		</PageSection>
	);
}
