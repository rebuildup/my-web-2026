import type { ReactNode } from 'react';
import { css } from '../../../styled-system/css';
import {
	BLOCKED_LINK_CLASS,
	type MarkdownInline,
	type MarkdownLinkContext,
	classifyHref,
	parseMarkdown,
} from '../markdown.lexer';

/**
 * Portfolio Markdown wrapper — Issue #77.
 *
 * Renders an editor-controlled Markdown body. The Markdown lexer
 * is the minimal in-house implementation in
 * `src/portfolio/markdown.lexer.ts`; this wrapper walks the parsed
 * AST and applies the editorial visual language.
 *
 * Empty-string input renders nothing — the parent decides whether
 * to skip the surrounding `<section>`.
 *
 * `siteOrigin` controls how the renderer decides whether a link is
 * internal or external. Default value matches the canonical
 * production domain (ADR-0014).
 *
 * Refused links (Issue #451): `classifyHref` in `markdown.lexer.ts`
 * is the only href oracle. A blocked target is NOT rendered as a
 * dead `<a href="#">` — it becomes an inert `<span>` that says so,
 * carrying `data-blocked-reason` and `data-blocked-href`, so a
 * refused URL is visible to the author and to a reviewer instead of
 * silently disappearing behind an anchor.
 */
export interface PortfolioMarkdownProps {
	source: string;
	siteOrigin?: string;
}

const DEFAULT_SITE_ORIGIN = 'https://rebuildup.dev';

/**
 * Tooltip for a refused link. The href itself stays in
 * `data-blocked-href` (React escapes it), so the tooltip only names
 * the reason and never repeats an attacker-controlled URL where a
 * browser might render it as a link.
 */
const BLOCKED_LINK_TITLE =
	'This link was refused by the Markdown renderer (see docs/security.md). Its target is shown as inert text, not as a clickable URL.';

/**
 * Refused-link styling. Deliberately NOT anchor-like: no colour that
 * reads as "clickable", an underline that carries a reason rather
 * than an affordance, and `textDecoration: none` on hover so the
 * cursor never promises navigation that does not exist.
 */
const BLOCKED_LINK_STYLE = {
	display: 'inline',
	fontFamily: 'sans',
	color: 'text.muted',
	textDecorationLine: 'none',
	backgroundColor: 'bg.subtle',
	borderRadius: '2px',
	paddingInline: '1',
} as const;

const BLOCKED_LINK_NOTE_STYLE = {
	fontFamily: 'mono',
	fontSize: 'xs',
	letterSpacing: '0.04em',
	color: 'text.muted',
} as const;

export function PortfolioMarkdown({
	source,
	siteOrigin = DEFAULT_SITE_ORIGIN,
}: PortfolioMarkdownProps): ReactNode {
	if (!source || source.trim() === '') return null;
	const blocks = parseMarkdown(source);
	const ctx = { siteOrigin };
	return (
		<div className={css({ display: 'flex', flexDirection: 'column', gap: '6' })}>
			{blocks.map((block, idx) => renderBlock(block, ctx, `md-${idx}`))}
		</div>
	);
}

/**
 * Walk an inline AST and produce a ReactNode tree.
 *
 * This is the only JSX-rendering surface for the Markdown AST.
 * Every other block / inline wrapper eventually calls into this
 * function — keeping the link-classification policy (external vs
 * internal, javascript-stripping) in one place.
 */
export function renderInline(
	nodes: readonly MarkdownInline[],
	ctx: MarkdownLinkContext,
	keyPrefix: string,
): ReactNode {
	return nodes.map((node, idx) => renderInlineNode(node, ctx, `${keyPrefix}-${idx}`));
}

function renderInlineNode(node: MarkdownInline, ctx: MarkdownLinkContext, key: string): ReactNode {
	switch (node.kind) {
		case 'text':
			return <span key={key}>{node.value}</span>;
		case 'code':
			return (
				<code key={key} className="portfolio-md-code-inline">
					{node.value}
				</code>
			);
		case 'strong':
			return <strong key={key}>{renderInline(node.children, ctx, key)}</strong>;
		case 'em':
			return <em key={key}>{renderInline(node.children, ctx, key)}</em>;
		case 'link': {
			const verdict = classifyHref(node.href, ctx.siteOrigin);
			if (verdict.outcome === 'blocked') {
				return (
					<span
						key={key}
						className={`${BLOCKED_LINK_CLASS} ${css(BLOCKED_LINK_STYLE)}`}
						data-blocked-reason={verdict.reason}
						data-blocked-href={verdict.raw}
						title={BLOCKED_LINK_TITLE}
					>
						<span aria-hidden="true">⛔ </span>
						{renderInline(node.children, ctx, key)}
						<span className={css(BLOCKED_LINK_NOTE_STYLE)}>
							{` — blocked link (${verdict.reason})`}
						</span>
					</span>
				);
			}
			return (
				<a key={key} href={verdict.href} target={verdict.target} rel={verdict.rel}>
					{renderInline(node.children, ctx, key)}
				</a>
			);
		}
	}
}

function renderBlock(
	block: ReturnType<typeof parseMarkdown>[number],
	ctx: { siteOrigin: string },
	key: string,
): ReactNode {
	switch (block.kind) {
		case 'heading': {
			const klass = headingClass(block.level);
			const children = renderInline(block.children, ctx, key);
			if (block.level === 1)
				return (
					<h3 className={klass} key={key}>
						{children}
					</h3>
				);
			if (block.level === 2)
				return (
					<h4 className={klass} key={key}>
						{children}
					</h4>
				);
			return (
				<h5 className={klass} key={key}>
					{children}
				</h5>
			);
		}
		case 'paragraph':
			return (
				<p
					key={key}
					className={css({
						margin: '0',
						fontFamily: 'sans',
						fontSize: 'md',
						color: 'text.default',
						lineHeight: '1.7',
						maxWidth: '640px',
					})}
				>
					{renderInline(block.children, ctx, key)}
				</p>
			);
		case 'list': {
			const Tag = block.ordered ? 'ol' : 'ul';
			return (
				<Tag
					key={key}
					className={css({
						margin: '0',
						paddingInlineStart: '6',
						fontFamily: 'sans',
						fontSize: 'md',
						color: 'text.default',
						lineHeight: '1.7',
						display: 'flex',
						flexDirection: 'column',
						gap: '2',
						maxWidth: '640px',
					})}
				>
					{block.items.map((item, idx) => {
						const itemKey = `${key}-${inlineTextHash(item)}`;
						return <li key={itemKey}>{renderInline(item, ctx, itemKey)}</li>;
					})}
				</Tag>
			);
		}
		case 'code':
			return (
				<pre
					key={key}
					className={css({
						margin: '0',
						padding: '4',
						backgroundColor: 'bg.subtle',
						borderRadius: '6px',
						overflowX: 'auto',
						fontFamily: 'mono',
						fontSize: 'sm',
						color: 'text.default',
						maxWidth: '640px',
					})}
				>
					<code>{block.value}</code>
				</pre>
			);
		case 'blockquote':
			return (
				<blockquote
					key={key}
					className={css({
						margin: '0',
						paddingInlineStart: '4',
						borderInlineStart: '2px solid {colors.border.subtle}',
						color: 'text.muted',
						maxWidth: '640px',
					})}
				>
					{renderInline(block.children, ctx, key)}
				</blockquote>
			);
		case 'hr':
			return (
				<hr
					key={key}
					className={css({
						border: 'none',
						borderTop: '1px solid {colors.border.subtle}',
						maxWidth: '640px',
					})}
				/>
			);
	}
}

/**
 * Stable hash for a list of inline nodes. Used as the React key
 * for `<li>` items in lists — items are static text fragments
 * within a single Markdown source, so a content-derived key is
 * sufficient and avoids the `noArrayIndexKey` lint.
 */
function inlineTextHash(nodes: readonly MarkdownInline[]): string {
	const parts: string[] = [];
	for (const node of nodes) collectText(node, parts);
	return parts.join('|').slice(0, 64);
}

function collectText(node: MarkdownInline, parts: string[]): void {
	switch (node.kind) {
		case 'text':
		case 'code':
			parts.push(node.value);
			return;
		case 'strong':
		case 'em':
		case 'link':
			for (const c of node.children) collectText(c, parts);
			return;
	}
}

function headingClass(level: 1 | 2 | 3): string {
	if (level === 1) {
		return css({
			margin: '0',
			fontFamily: 'heading',
			fontSize: '2xl',
			fontWeight: '700',
			color: 'text.default',
			lineHeight: '1.2',
			letterSpacing: '-0.02em',
		});
	}
	if (level === 2) {
		return css({
			margin: '0',
			fontFamily: 'heading',
			fontSize: 'xl',
			fontWeight: '700',
			color: 'text.default',
			lineHeight: '1.3',
			letterSpacing: '-0.01em',
		});
	}
	return css({
		margin: '0',
		fontFamily: 'heading',
		fontSize: 'lg',
		fontWeight: '600',
		color: 'text.default',
		lineHeight: '1.3',
	});
}
