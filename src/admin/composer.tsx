import type { ReactNode } from 'react';
import { css } from '../../styled-system/css';
import { Badge } from '../editorial/primitives/Badge';
import { Container } from '../editorial/primitives/Container';
import { SectionHeading } from '../editorial/primitives/SectionHeading';

/**
 * AdminDashboard — `/admin` composition.
 *
 * Shares the editorial visual language with the home surface
 * (`src/editorial/`). 0.3.0 keeps the dashboard as a single screen
 * with three sections:
 *
 *   1. Identity — the logged-in admin's email + role + sign-out form.
 *   2. Capabilities — list of admin surfaces (invitations, keys,
 *      images), each rendered as a disabled placeholder until the
 *      matching ticket lands.
 *   3. System link — pointer to `/api/v1/health`.
 *
 * Capabilities are placeholders for now: only Invitations are
 * implemented in Ticket A. Keys and Images ship in Tickets B and D.
 * The disabled state signals "coming soon" without promising dates.
 */

export interface AdminCapability {
	id: 'invitations' | 'keys' | 'images' | 'emoji-catalog';
	label: string;
	labelJa: string;
	status: 'live' | 'planned';
	href?: string;
}

export interface AdminDashboardProps {
	email: string;
	role: string;
	signOutForm: ReactNode;
	capabilities: readonly AdminCapability[];
}

export function AdminDashboard({ email, role, signOutForm, capabilities }: AdminDashboardProps) {
	return (
		<section
			className={css({
				paddingBlock: { base: '16', lg: '24' },
			})}
		>
			<Container>
				<SectionHeading
					eyebrow="00 — Admin"
					title="管理画面 / Admin"
					description="招待・API キー・リアクション画像を一元管理。Invitation-only。0.3.0 では Invitations のみ。"
					variant="spread"
				>
					<div
						className={css({
							display: 'flex',
							flexDirection: 'column',
							gap: '10',
						})}
					>
						<article
							className={css({
								display: 'flex',
								flexDirection: 'column',
								gap: '4',
								paddingBlock: '6',
								borderBlockEnd: '1px solid {colors.border.subtle}',
							})}
						>
							<span
								className={css({
									fontFamily: 'mono',
									fontSize: 'sm',
									color: 'text.muted',
									letterSpacing: '0.04em',
									textTransform: 'uppercase',
								})}
							>
								Identity
							</span>
							<p
								className={css({
									margin: '0',
									fontFamily: 'sans',
									fontSize: 'lg',
									fontWeight: '700',
									color: 'text.default',
								})}
							>
								{email}
							</p>
							<div
								className={css({
									display: 'flex',
									alignItems: 'center',
									gap: '3',
								})}
							>
								<Badge tone={role === 'admin' ? 'accent' : 'neutral'}>{role}</Badge>
								{signOutForm}
							</div>
						</article>

						<article
							className={css({
								display: 'flex',
								flexDirection: 'column',
								gap: '4',
							})}
						>
							<span
								className={css({
									fontFamily: 'mono',
									fontSize: 'sm',
									color: 'text.muted',
									letterSpacing: '0.04em',
									textTransform: 'uppercase',
								})}
							>
								Capabilities
							</span>
							<ul
								className={css({
									margin: '0',
									padding: '0',
									listStyle: 'none',
									display: 'flex',
									flexDirection: 'column',
									gap: '3',
								})}
							>
								{capabilities.map((cap) => (
									<li
										key={cap.id}
										className={css({
											display: 'flex',
											alignItems: 'baseline',
											gap: '3',
										})}
									>
										{cap.href ? (
											<a
												href={cap.href}
												className={css({
													color: 'text.accent',
													textDecoration: 'none',
													fontFamily: 'sans',
													fontSize: 'md',
													_hover: { textDecoration: 'underline' },
												})}
											>
												{cap.labelJa} · {cap.label}
											</a>
										) : (
											<span
												className={css({
													fontFamily: 'sans',
													fontSize: 'md',
													color: 'text.muted',
												})}
											>
												{cap.labelJa} · {cap.label}
											</span>
										)}
										<Badge tone={cap.status === 'live' ? 'accent' : 'neutral'}>
											{cap.status === 'live' ? 'live' : 'planned'}
										</Badge>
									</li>
								))}
							</ul>
						</article>

						<article
							className={css({
								display: 'flex',
								flexDirection: 'column',
								gap: '2',
							})}
						>
							<span
								className={css({
									fontFamily: 'mono',
									fontSize: 'sm',
									color: 'text.muted',
									letterSpacing: '0.04em',
									textTransform: 'uppercase',
								})}
							>
								System
							</span>
							<a
								href="/api/v1/health"
								rel="noopener noreferrer"
								target="_blank"
								className={css({
									color: 'text.accent',
									fontFamily: 'sans',
									fontSize: 'md',
									textDecoration: 'none',
									_hover: { textDecoration: 'underline' },
								})}
							>
								/api/v1/health
							</a>
						</article>
					</div>
				</SectionHeading>
			</Container>
		</section>
	);
}
