import type { ReactNode } from 'react';
import { css } from '../../../styled-system/css';
import {
	isExternalHref,
	parseMarkdown,
	safeHref,
	type MarkdownInline,
	type MarkdownLinkContext,
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
 */
export interface PortfolioMarkdownProps {
	source: string;
	siteOrigin?: string;
}

const DEFAULT_SITE_ORIGIN = 'https://rebuildup.dev';

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
			const href = safeHref(node.href, ctx.siteOrigin);
			const external = isExternalHref(node.href, ctx.siteOrigin);
			const rel = external ? 'noopener noreferrer' : '';
			const target = external ? '_blank' : '_self';
			return (
				<a key={key} href={href} target={target} rel={rel}>
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
