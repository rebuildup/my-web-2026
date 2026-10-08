/**
 * SiteMark — the platform identity motif on the home page.
 *
 * Issue #287 — the hero h1 is now this mark instead of a personal
 * name. The mark is an identity asset (a logo), not a section
 * accent or an illustration, so the editorial single-accent rule
 * does not recolor it; the original palette is kept verbatim.
 *
 * Provenance — ported from my-web-2025:
 * `src/components/icons/SamuidoIcon.tsx`
 * @ `27a2d028046a6eab00e255ac3bc59a3add34a65c` (2026-05-10).
 * Path geometry and palette are verbatim; only the component name,
 * a fixed default palette (the source took a `color` prop), and the
 * viewBox framing differ — the source's `0 0 1024 1024` frame has
 * ~50% empty space around the artwork, so the viewBox is cropped to
 * the artwork bbox (`108 230 808 538`) with a 16-unit padding to
 * make responsive sizing predictable.
 *
 * The svg is decorative (`aria-hidden`): the accessible name lives
 * on the surrounding `<h1>` via visually-hidden text.
 */
export function SiteMark({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			focusable="false"
			viewBox="92 214 840 570"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				fill="#ffd627"
				d="M138,618c-16.57,0-30,13.43-30,30s13.43,30,30,30h222c10.49,0,19,8.51,19,19,0,2.19-.37,4.29-1.05,6.25-2.58,7.42-9.64,12.75-17.95,12.75h-80c-14.36,0-26,11.64-26,26s11.64,26,26,26h448c11.36,0,21.03-7.29,24.56-17.45.93-2.68,1.44-5.55,1.44-8.55,0-14.36-11.64-26-26-26h-19.07.07c-10.49,0-19-8.51-19-19s8.51-19,19-19h.05s176.73,0,176.73,0h.22c13.11,0,24.26-8.41,28.34-20.14,1.07-3.09,1.66-6.41,1.66-9.86,0-16.57-13.43-30-30-30h-29c-49.15,0-89-39.85-89-89v.18-42.18c0-141.94-115.06-257-257-257s-257,115.06-257,257v42.73-.73c0,49.15-39.85,89-89,89h-27Z"
			/>
			<path
				fill="#fff"
				d="M697,417.46c0-43.89-33.81-79.46-77.7-79.46h0c-60.79,0-108.3,50.32-108.3,111.11h0c0,55.73-43.2,102.61-97.88,106.74h0c-17.12,0-31.12,14.03-31.12,31.15s13.88,31,31,31h-.15,119.68l-.06-.08c-5.3-6.53-8.48-14.86-8.48-23.92,0-20.99,17.01-38,38-38h75.5c32.86,0,59.5-26.64,59.5-59.5v-79.04Z"
			/>
			<path
				fill="#000"
				d="M639.79,461.15c-5.44,15.63-20.3,26.85-37.79,26.85-22.09,0-40-17.91-40-40s17.91-40,40-40,40,17.91,40,40c0,4.61-.78,9.03-2.21,13.15"
			/>
			<circle cx="422" cy="448" r="40" fill="#000" />
		</svg>
	);
}
