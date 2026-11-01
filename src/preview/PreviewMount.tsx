/**
 * Issue #764 — comparison-preview client mount (WORKTREE ONLY).
 *
 * The palette and the structural CSS are server-rendered into `<head>` by
 * `__root.tsx`, so they apply before first paint. This component does the
 * two things CSS cannot:
 *
 *   1. moves the shipped consent panel above the page content (the band
 *      belongs under the navigation, not after the footer);
 *   2. swaps the text-drawn symbols (→ ↗ ← ☰ ✕ ×)
 *      for the self-hosted Material Symbols glyph, which is what
 *      `editorial/primitives/Icon.tsx` would render.
 *
 * The icon pass never detaches a React-owned node: it rewrites the text it
 * already owns and appends a sibling span, so a re-render can only produce a
 * stale icon, which the next pass removes.
 */
import { useEffect } from 'react';

const GLYPHS: Record<string, string> = {
	'→': 'arrow_forward',
	'↗': 'north_east',
	'←': 'arrow_back',
	'☰': 'menu',
	'✕': 'close',
	'×': 'error',
};
const GLYPH_RE = new RegExp(`([${Object.keys(GLYPHS).join('')}])\\s*$`);
const LEAD_RE = new RegExp(`^\\s*([${Object.keys(GLYPHS).join('')}])\\s*`);

function makeIcon(name: string, lead: boolean): HTMLSpanElement {
	const span = document.createElement('span');
	span.className = 'msr';
	span.dataset.msrAdded = '1';
	span.setAttribute('aria-hidden', 'true');
	span.textContent = name;
	span.style.marginInlineStart = lead ? '' : '0.4em';
	span.style.marginInlineEnd = lead ? '0.4em' : '';
	return span;
}

function swapIcons(root: ParentNode): void {
	// Stale icons from a previous pass (React re-rendered the text).
	for (const stale of root.querySelectorAll('span[data-msr-added]')) stale.remove();

	const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
	const targets: Text[] = [];
	while (walker.nextNode()) {
		const node = walker.currentNode as Text;
		const parent = node.parentElement;
		if (!parent || parent.closest('script, style, .msr')) continue;
		const text = node.data;
		if (GLYPH_RE.test(text) || LEAD_RE.test(text)) targets.push(node);
	}

	for (const node of targets) {
		const original = node.data;
		const lead = LEAD_RE.exec(original);
		if (lead) {
			node.data = original.replace(LEAD_RE, '');
			node.parentElement?.insertBefore(makeIcon(GLYPHS[lead[1]], true), node);
			continue;
		}
		const trail = GLYPH_RE.exec(original);
		if (!trail) continue;
		node.data = original.replace(GLYPH_RE, '');
		// The Worker DOM typings shadow lib.dom's ParentNode, so the sibling
		// insertion is done through a narrow structural cast.
		(node as unknown as { after: (n: Node) => void }).after(makeIcon(GLYPHS[trail[1]], false));
		if (!node.data.trim()) node.data = node.data.replace(/\s+$/, '');
	}
}

export function PreviewMount({ on }: { on: boolean }) {
	useEffect(() => {
		if (!on) return;
		let cancelled = false;

		const place = () => {
			if (cancelled) return;
			const band = [...document.querySelectorAll('section[class*="pos_fixed"]')].find((el) =>
				/アクセス解析/.test(el.textContent ?? ''),
			);
			if (band) {
				const root = document.getElementById('app-root');
				const anchor = root?.querySelector('nav');
				const after = (el: unknown, n: Node) => (el as { after: (x: Node) => void }).after(n);
				const prepend = (el: unknown, n: Node) => (el as { prepend: (x: Node) => void }).prepend(n);
				if (anchor && anchor.nextElementSibling !== band) after(anchor, band);
				else if (!anchor && root && root.firstElementChild !== band) prepend(root, band);
			}
			swapIcons(document.body as unknown as ParentNode);
		};

		// React 19 hydrates the document incrementally: a DOM edit made from an
		// effect while hydration is still running is read back by React as a
		// server/client text mismatch ("server rendered text didn't match the
		// client") and the whole tree is regenerated. So the first pass waits
		// until the document has loaded AND the main thread is idle, which is
		// after the hydration commit; only then does the observer take over.
		let observer: MutationObserver | null = null;
		const start = () => {
			if (cancelled) return;
			place();
			observer = new MutationObserver(() => {
				// Coalesce: a render produces many mutations, one pass is enough.
				requestAnimationFrame(() => {
					if (!cancelled) swapIcons(document.body as unknown as ParentNode);
				});
			});
			observer.observe(document.body, { childList: true, subtree: true, characterData: true });
		};
		// `load` already means hydration had a full pass; the timeout only keeps the
		// DOM work out of the same frame as the first paint. A plain timer is enough
		// here: an idle-scheduling API is not Baseline in Safari and would need a
		// guarded-feature declaration for a throwaway harness.
		const schedule = () => {
			setTimeout(start, 400);
		};
		if (document.readyState === 'complete') schedule();
		else window.addEventListener('load', schedule, { once: true });

		return () => {
			cancelled = true;
			observer?.disconnect();
		};
	}, [on]);
	return null;
}
