import { Link, createFileRoute } from '@tanstack/react-router';
import { css } from '../../styled-system/css';
import { Container } from '../editorial/primitives/Container';
import { listPublicTools } from '../tools/registry';

/**
 * TanStack Start route for the Tools index page.
 *
 * Lists every Tool whose `delivery.kind` is `same_origin_static` or
 * `external_exception` — the same surface as the iframe shell route.
 * `host_disabled` / `needs_tool_side_fix` / `not_integrable_yet`
 * Tools are intentionally excluded: the brief forbids showing Tools
 * that are not actually integrated.
 *
 * The list is sourced entirely from `listPublicTools()` — no
 * Tool-specific constants live in this file. Adding a Tool to the
 * registry's `same_origin_static` set is sufficient for it to appear
 * here.
 *
 * Layout — `Container` + editorial whitespace. Each tool is a row
 * separated by a thin `borderTop` (the shared section divider
 * primitive) instead of a per-item border + background card. The
 * per-item borders collapsed the readable column at narrow
 * viewports; the row-divided list keeps the page on the same visual
 * axis as the rest of the public surface.
 */
export const Route = createFileRoute('/tools/')({
	loader: () => listPublicTools(),
	head: () => ({
		meta: [
			{ title: 'Tools — my-web-2026' },
			{
				name: 'description',
				content: 'Standalone Web Tools integrated into my-web-2026 via the Tool Registry contract.',
			},
		],
	}),
	component: ToolsIndexRoute,
});

function ToolsIndexRoute() {
	const tools = Route.useLoaderData();
	return (
		<section data-route="tools" className={css({ paddingBlock: { base: '16', lg: '24' } })}>
			<Container>
				<header
					className={css({
						display: 'flex',
						flexDirection: 'column',
						gap: '4',
						marginBlockEnd: '10',
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
						Tools
					</span>
					<h1
						className={css({
							margin: '0',
							fontFamily: 'heading',
							fontSize: { base: '3xl', lg: '4xl' },
							fontWeight: '700',
							color: 'text.default',
							lineHeight: '1.05',
							letterSpacing: '-0.03em',
							maxWidth: '720px',
						})}
					>
						ツール / Tools
					</h1>
					<p
						className={css({
							margin: '0',
							fontFamily: 'sans',
							fontSize: 'md',
							color: 'text.muted',
							lineHeight: '1.6',
							maxWidth: '640px',
						})}
					>
						my-web-2026 に統合している standalone web tool。固定まわりは独立した repository から{' '}
						<code>/tools/&lt;slug&gt;/app/</code> に collection され、同一 origin
						から配信されます。統合 contract は ADR-0006 を参照。
					</p>
				</header>
				{tools.length === 0 ? (
					<p
						className={css({
							margin: '0',
							fontFamily: 'mono',
							fontSize: 'sm',
							color: 'text.muted',
						})}
					>
						No Tools are currently integrated.
					</p>
				) : (
					<ul
						className={css({
							listStyle: 'none',
							margin: '0',
							padding: '0',
							display: 'flex',
							flexDirection: 'column',
						})}
					>
						{tools.map((tool) => (
							<li
								key={tool.slug}
								data-tool-slug={tool.slug}
								className={css({
									display: 'flex',
									flexDirection: 'column',
									gap: '2',
									paddingBlock: '6',
									borderBlockStartWidth: '1px',
									borderBlockStartStyle: 'solid',
									borderBlockStartColor: 'border.subtle',
								})}
							>
								<h2
									className={css({
										margin: '0',
										fontFamily: 'heading',
										fontSize: 'xl',
										fontWeight: '700',
										color: 'text.default',
										lineHeight: '1.25',
										letterSpacing: '-0.01em',
									})}
								>
									<Link
										to="/tools/$slug"
										params={{ slug: tool.slug }}
										className={css({
											color: 'inherit',
											textDecoration: 'none',
											_focusVisible: {
												outline: '2px solid {colors.border.focus}',
												outlineOffset: '4px',
												borderRadius: '2px',
											},
											_hover: {
												textDecoration: 'underline',
											},
										})}
									>
										{tool.display_name}
									</Link>
								</h2>
								<p
									className={css({
										margin: '0',
										fontFamily: 'sans',
										fontSize: 'md',
										color: 'text.muted',
										lineHeight: '1.6',
									})}
								>
									{tool.description}
								</p>
							</li>
						))}
					</ul>
				)}
			</Container>
		</section>
	);
}
