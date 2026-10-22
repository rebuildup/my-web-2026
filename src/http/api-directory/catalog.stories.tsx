import type { Meta, StoryObj } from '@storybook/react';
import { css, cx } from '../../styled-system/css';
import { publicApiCatalog } from './catalog';

/**
 * Public API Directory — Issue #530.
 *
 * A read-only inventory of the published `/api/v1/*` endpoints,
 * derived from the Hono boundary (`src/http/hono.ts`). The catalog
 * excludes management, secret, unimplemented and mock-only routes.
 */
const meta = {
	title: 'http/api-directory/PublicApiDirectory',
	parameters: { layout: 'fullscreen' },
	tags: ['autodocs'],
} satisfies Meta<{ title: string; parameters: Record<string, unknown>; tags: string[]; component?: unknown }>;

export default meta;
type Story = StoryObj<typeof meta>;

function EndpointRow({ entry }: { entry: (typeof publicApiCatalog)[number] }) {
	return (
		<tr
			className={css({
				borderBottom: '1px solid',
				borderColor: 'border.subtle',
			})}
		>
			<td
				className={cx(
					css({
						paddingBlock: '3',
						paddingInline: '4',
						fontFamily: 'mono',
						fontSize: 'xs',
						whiteSpace: 'nowrap',
					}),
					entry.authentication === 'anonymous'
						? css({ color: 'text.success' })
						: css({ color: 'text.warning' }),
				)}
			>
				{entry.method} {entry.path}
			</td>
			<td
				className={css({
					paddingBlock: '3',
					paddingInline: '4',
					fontFamily: 'sans',
					fontSize: 'xs',
				})}
			>
				{entry.authentication === 'anonymous' ? '匿名' : '認証'}
				{entry.authForm && ` (${entry.authForm})`}
			</td>
			<td
				className={css({
					paddingBlock: '3',
					paddingInline: '4',
					fontFamily: 'sans',
					fontSize: 'xs',
					color: 'text.muted',
				})}
			>
				{entry.rateLimitBinding ?? '—'}
			</td>
			<td
				className={css({
					paddingBlock: '3',
					paddingInline: '4',
					fontFamily: 'sans',
					fontSize: 'xs',
				})}
			>
				{entry.purpose}
			</td>
		</tr>
	);
}

export const Catalog: Story = {
	render: () => (
		<div
			className={css({
				maxWidth: '1200px',
				marginInline: 'auto',
				paddingInline: '6',
				paddingBlock: '8',
			})}
		>
			<header className={css({ marginBlockEnd: '6' })}>
				<h1
					className={css({
						fontFamily: 'sans',
						fontSize: '3xl',
						fontWeight: '700',
						lineHeight: 'tight',
					})}
				>
					公開 API ディレクトリ
				</h1>
				<p
					className={css({
						marginBlockStart: '2',
						fontFamily: 'sans',
						fontSize: 'md',
						color: 'text.muted',
					})}
				>
					`/api/v1/*` の公開契約（認証・rate
					limit・エラー形式・利用例・責務）をコードから導出。管理用・秘密値・未公開のものは含まない。
				</p>
			</header>

			<section>
				<table
					className={css({
						width: '100%',
						borderCollapse: 'collapse',
						fontFamily: 'sans',
					})}
				>
					<thead>
						<tr
							className={css({
								borderBottom: '2px solid',
								borderColor: 'border.default',
							})}
						>
							<th
								className={css({
									paddingBlock: '2',
									paddingInline: '4',
									textAlign: 'left',
									fontSize: 'xs',
									fontWeight: '600',
									textTransform: 'uppercase',
									letterSpacing: 'wide',
									color: 'text.muted',
								})}
							>
								Endpoint
							</th>
							<th
								className={css({
									paddingBlock: '2',
									paddingInline: '4',
									textAlign: 'left',
									fontSize: 'xs',
									fontWeight: '600',
									textTransform: 'uppercase',
									letterSpacing: 'wide',
									color: 'text.muted',
								})}
							>
								認証
							</th>
							<th
								className={css({
									paddingBlock: '2',
									paddingInline: '4',
									textAlign: 'left',
									fontSize: 'xs',
									fontWeight: '600',
									textTransform: 'uppercase',
									letterSpacing: 'wide',
									color: 'text.muted',
								})}
							>
								Rate limit
							</th>
							<th
								className={css({
									paddingBlock: '2',
									paddingInline: '4',
									textAlign: 'left',
									fontSize: 'xs',
									fontWeight: '600',
									textTransform: 'uppercase',
									letterSpacing: 'wide',
									color: 'text.muted',
								})}
							>
								責務 / 利用例
							</th>
						</tr>
					</thead>
					<tbody>
						{publicApiCatalog.map((entry) => (
							<EndpointRow key={`${entry.method} ${entry.path}`} entry={entry} />
						))}
					</tbody>
				</table>
			</section>

			<section
				className={css({
					marginBlockStart: '6',
					paddingBlock: '4',
					paddingInline: '4',
					borderRadius: 'md',
					border: '1px solid',
					borderColor: 'border.subtle',
				})}
			>
				<h2
					className={css({
						fontFamily: 'sans',
						fontSize: 'lg',
						fontWeight: '700',
						marginBlockEnd: '2',
					})}
				>
					公開契約の要点
				</h2>
				<ul
					className={css({
						fontFamily: 'sans',
						fontSize: 'sm',
						lineHeight: 'relaxed',
						color: 'text.muted',
						paddingInlineStart: '4',
						listStyle: 'disc',
					})}
				>
					<li>
						認証 API（`/api/v1/auth/*`）と認証が必要なデータ API（`/access/*`,
						`/reactions`）は別の層である。
					</li>
					<li>
						匿名読み取り（`/api/v1/health`, `/api/v1/reaction-images/:id`）と認証書き込み（`PUT`,
						`DELETE`, `POST /hit`）を明確に分ける。
					</li>
					<li>
						管理用エンドポイント（`/db/ping`,
						`/media/ping`）、未実装境界（`/webhooks/*`、`/oauth/*`、`/integrations/*`）、秘密値はこのカタログに含めない。
					</li>
					<li>
						廃止方針の明文化は現在存在しない（`docs/security/api-cors.md` は CORS
						契約を記載するが、API 版数の廃止スケジュールは未定義）。
					</li>
				</ul>
			</section>
		</div>
	),
};

export const EmptyState: Story = {
	render: () => (
		<div
			className={css({
				maxWidth: '1200px',
				marginInline: 'auto',
				paddingInline: '6',
				paddingBlock: '8',
			})}
		>
			<h1
				className={css({
					fontFamily: 'sans',
					fontSize: '2xl',
					fontWeight: '700',
				})}
			>
				公開 API ディレクトリ（空状態）
			</h1>
			<p
				className={css({
					marginBlockStart: '2',
					fontFamily: 'sans',
					fontSize: 'md',
					color: 'text.muted',
				})}
			>
				現在、公開 API
				契約としてカタログに登録されているエンドポイントはありません。将来の公開契約が追加された際に、この表示から自動的に反映されます。
			</p>
		</div>
	),
};
