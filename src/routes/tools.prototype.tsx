import { createFileRoute } from '@tanstack/react-router';

/**
 * TanStack Start route for the ProtoType pilot Tool.
 *
 * Mounts the ProtoType Vite SPA collected at
 * `/tools/prototype/index.html` via a same-origin `<iframe>`. The
 * iframe is sandboxed at the strictest level the Tool needs:
 *
 *   sandbox="allow-scripts"
 *
 * Rationale (ADR-0006 §3 / Issue #81):
 *
 *   - `allow-scripts` is required because ProtoType is a React SPA.
 *   - `allow-same-origin` is **deliberately omitted** so the iframe
 *     cannot access the parent's storage / cookies / DOM. With only
 *     `allow-scripts`, the iframe is treated as a unique opaque
 *     origin and isolated from `rebuildup.dev`.
 *   - `referrerpolicy="no-referrer"` strips the Referer header so
 *     the Tool cannot leak the URL of the host page.
 *   - The `title` attribute is set so the page is identifiable in
 *     the browser tab and accessibility tree.
 *
 * The host page itself is a thin shell — no host JS reaches into the
 * iframe, no Tool JS reaches out of the iframe. Communication would
 * use `postMessage` if and when a future Tool needs it; the brief
 * explicitly defers that to a follow-up ticket.
 *
 * Permissions-Policy: this route does NOT enable microphone / camera
 * by default. ProtoType does not require them. The `mic-level` Tool
 * would carry `Permissions-Policy: microphone=(self)` on the host
 * origin (see docs/tools/manifest.json + ADR-0006 §3).
 */
export const Route = createFileRoute('/tools/prototype')({
	head: () => ({
		meta: [
			{ title: 'ProtoType — my-web-2026 Tools' },
			{
				name: 'description',
				content:
					'ProtoType is the pilot Tool integrated via the my-web-2026 Tool Registry contract.',
			},
			// Explicit noindex for the pilot route — Tool content is
			// served at /tools/<slug>/index.html, and the host shell
			// is intentionally not part of the public canonical surface.
			// Operators can flip this once the Tool surface graduates
			// from pilot to production.
			{ name: 'robots', content: 'noindex' },
		],
	}),
	component: ProtoTypeRoute,
});

function ProtoTypeRoute() {
	return (
		<div
			data-route="tools/prototype"
			style={{
				width: '100%',
				height: 'calc(100vh - 64px)',
				border: '0',
				display: 'block',
			}}
		>
			<iframe
				title="ProtoType Tool"
				src="/tools/prototype/index.html"
				sandbox="allow-scripts"
				referrerPolicy="no-referrer"
				loading="lazy"
				style={{
					width: '100%',
					height: '100%',
					border: '0',
					display: 'block',
				}}
			/>
		</div>
	);
}
