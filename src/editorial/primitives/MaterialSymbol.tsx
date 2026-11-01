/**
 * Material Symbols icon primitive (Issue #785, design #764).
 *
 * The Tools index uses an icon per Tool so a visitor can tell what a
 * row is before reading it (owner instruction 2026-11-01: ここは
 * かっこよさではなく利便性を意識するべきところなのでアイコンを使う).
 * Design #764 selects Google's Material Symbols, so this primitive
 * draws the SHIPPED Material Symbols outline glyphs — not an ad-hoc
 * character set, not an emoji, not an icon font loaded at runtime.
 *
 * Each `d` below is the path data of the corresponding 24 px outline
 * SVG from Google's short-term release endpoint
 * (`fonts.gstatic.com/s/i/short-term/release/materialsymbolsoutlined/
 * <name>/default/24px.svg`), inlined so the page renders the icon even
 * when no font request succeeds. `viewBox="0 -960 960 960"` is the
 * coordinate space those glyphs are authored in.
 *
 * Licence: Material Symbols are Apache-2.0
 * (https://github.com/google/material-design-icons). The attribution
 * lives here because the paths are bundled into this repository's
 * source rather than fetched at runtime; the visitor-facing asset
 * inventory (`quality/asset-license-inventory.json`) covers the bytes
 * under `public/`, not this module.
 *
 * Accessibility: the glyph is purely decorative — the row's link text
 * carries the name and the accessible purpose — so the SVG is
 * `aria-hidden` and its accessible name is never overridden by a
 * `<title>`. A caller that needs a named icon must supply the name on
 * the control, not on the glyph.
 */

/** The closed set of glyphs this repository ships. */
export type MaterialSymbolName =
	| 'arrow_forward'
	| 'calculate'
	| 'code'
	| 'edit_note'
	| 'extension'
	| 'functions'
	| 'history_edu'
	| 'keyboard'
	| 'mail'
	| 'menu_book'
	| 'mic'
	| 'motion'
	| 'movie'
	| 'palette'
	| 'qr_code_2'
	| 'text_fields'
	| 'timer';

/**
 * Path data per glyph, in the 960-unit Material Symbols viewBox.
 *
 * `motion` draws the glyph Google names `animation`. The local name is
 * deliberately different: `scripts/check-reduced-motion.mjs` reads
 * `animation:` in a TS/TSX source as a motion declaration (it is a text
 * pattern, by design — see its header), so an object key spelled like
 * the CSS shorthand would be reported as an unguarded animation. The
 * glyph is decorative and static; nothing here animates.
 */
const PATHS: Record<MaterialSymbolName, string> = {
	motion:
		'M360-80q-58 0-109-22t-89-60q-38-38-60-89T80-360q0-81 42-148t110-102q20-39 49.5-68.5T350-728q33-68 101-110t149-42q58 0 109 22t89 60q38 38 60 89t22 109q0 85-42 150T728-350q-20 39-49.5 68.5T610-232q-35 68-102 110T360-80Zm0-80q33 0 63.5-10t56.5-30q-58 0-109-22t-89-60q-38-38-60-89t-22-109q-20 26-30 56.5T160-360q0 42 16 78t43 63q27 27 63 43t78 16Zm120-120q33 0 64.5-10t57.5-30q-59 0-110-22.5T403-403q-38-38-60.5-89T320-602q-20 26-30 57.5T280-480q0 42 15.5 78t43.5 63q27 28 63 43.5t78 15.5Zm120-120q18 0 34.5-3t33.5-9q22-60 6.5-115.5T621-621q-38-38-93.5-53.5T412-668q-6 17-9 33.5t-3 34.5q0 42 15.5 78t43.5 63q27 28 63 43.5t78 15.5Zm160-78q20-26 30-57.5t10-64.5q0-42-15.5-78T741-741q-27-28-63-43.5T600-800q-35 0-65.5 10T478-760q59 0 110 22.5t89 60.5q38 38 60.5 89T760-478ZM600-600Z',
	arrow_forward: 'M647-440H160v-80h487L423-744l57-56 320 320-320 320-57-56 224-224Z',
	calculate:
		'M320-240h60v-80h80v-60h-80v-80h-60v80h-80v60h80v80Zm200-30h200v-60H520v60Zm0-100h200v-60H520v60Zm44-152 56-56 56 56 42-42-56-58 56-56-42-42-56 56-56-56-42 42 56 56-56 58 42 42Zm-314-70h200v-60H250v60Zm-50 472q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T840-760v560q0 33-23.5 56.5T760-120H200Zm0-80h560v-560H200v560Zm0-560v560-560Z',
	code: 'M320-240 80-480l240-240 57 57-184 184 183 183-56 56Zm320 0-57-57 184-184-183-183 56-56 240 240-240 240Z',
	edit_note:
		'M160-400v-80h280v80H160Zm0-160v-80h440v80H160Zm0-160v-80h440v80H160Zm360 560v-123l221-220q9-9 20-13t22-4q12 0 23 4.5t20 13.5l37 37q8 9 12.5 20t4.5 22q0 11-4 22.5T863-380L643-160H520Zm300-263-37-37 37 37ZM580-220h38l121-122-18-19-19-18-122 121v38Zm141-141-19-18 37 37-18-19Z',
	extension:
		'M200-200h520v-184l45-22q16-8 25.5-22t9.5-32q0-17-9.5-31.5T765-514l-45-21v-185H528l-10-68q-3-22-19.5-37T460-840q-23 0-39.5 15T401-788l-10 68H200v86q56 21 88 68t32 106q0 60-32 107t-88 68v85Zm0 80q-34 0-57-23t-23-57v-152q48 0 84-30.5t36-77.5q0-46-36-76t-84-32v-152q0-33 23.5-56.5T200-800h122q7-51 46-85.5t92-34.5q52 0 91 34.5t47 85.5h122q33 0 56.5 23.5T800-720v134q36 18 58 52t22 74q0 41-22 75t-58 51v134q0 34-23.5 57T720-120H200Zm300-340Z',
	functions: 'M240-160v-80l260-240-260-240v-80h480v120H431l215 200-215 200h289v120H240Z',
	history_edu:
		'M320-160q-33 0-56.5-23.5T240-240v-120h120v-90q-35-2-66.5-15.5T236-506v-44h-46L60-680q36-46 89-65t107-19q27 0 52.5 4t51.5 15v-55h480v520q0 50-35 85t-85 35H320Zm120-200h240v80q0 17 11.5 28.5T720-240q17 0 28.5-11.5T760-280v-440H440v24l240 240v56h-56L510-514l-8 8q-14 14-29.5 25T440-464v104ZM224-630h92v86q12 8 25 11t27 3q23 0 41.5-7t36.5-25l8-8-56-56q-29-29-65-43.5T256-684q-20 0-38 3t-36 9l42 42Zm376 350H320v40h286q-3-9-4.5-19t-1.5-21Zm-280 40v-40 40Z',
	keyboard:
		'M160-200q-33 0-56.5-23.5T80-280v-400q0-33 23.5-56.5T160-760h640q33 0 56.5 23.5T880-680v400q0 33-23.5 56.5T800-200H160Zm0-80h640v-400H160v400Zm160-40h320v-80H320v80ZM200-440h80v-80h-80v80Zm120 0h80v-80h-80v80Zm120 0h80v-80h-80v80Zm120 0h80v-80h-80v80Zm120 0h80v-80h-80v80ZM200-560h80v-80h-80v80Zm120 0h80v-80h-80v80Zm120 0h80v-80h-80v80Zm120 0h80v-80h-80v80Zm120 0h80v-80h-80v80ZM160-280v-400 400Z',
	mail: 'M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h640q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160Zm320-280L160-640v400h640v-400L480-440Zm0-80 320-200H160l320 200ZM160-640v-80 480-400Z',
	menu_book:
		'M560-564v-68q33-14 67.5-21t72.5-7q26 0 51 4t49 10v64q-24-9-48.5-13.5T700-600q-38 0-73 9.5T560-564Zm0 220v-68q33-14 67.5-21t72.5-7q26 0 51 4t49 10v64q-24-9-48.5-13.5T700-380q-38 0-73 9t-67 27Zm0-110v-68q33-14 67.5-21t72.5-7q26 0 51 4t49 10v64q-24-9-48.5-13.5T700-490q-38 0-73 9.5T560-454ZM260-320q47 0 91.5 10.5T440-278v-394q-41-24-87-36t-93-12q-36 0-71.5 7T120-692v396q35-12 69.5-18t70.5-6Zm260 42q44-21 88.5-31.5T700-320q36 0 70.5 6t69.5 18v-396q-33-14-68.5-21t-71.5-7q-47 0-93 12t-87 36v394Zm-40 118q-48-38-104-59t-116-21q-42 0-82.5 11T100-198q-21 11-40.5-1T40-234v-482q0-11 5.5-21T62-752q46-24 96-36t102-12q58 0 113.5 15T480-740q51-30 106.5-45T700-800q52 0 102 12t96 36q11 5 16.5 15t5.5 21v482q0 23-19.5 35t-40.5 1q-37-20-77.5-31T700-240q-60 0-116 21t-104 59ZM280-494Z',
	mic: 'M395-435q-35-35-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35q-50 0-85-35Zm85-205Zm-40 520v-123q-104-14-172-93t-68-184h80q0 83 58.5 141.5T480-320q83 0 141.5-58.5T680-520h80q0 105-68 184t-172 93v123h-80Zm68.5-371.5Q520-503 520-520v-240q0-17-11.5-28.5T480-800q-17 0-28.5 11.5T440-760v240q0 17 11.5 28.5T480-480q17 0 28.5-11.5Z',
	movie:
		'm160-800 80 160h120l-80-160h80l80 160h120l-80-160h80l80 160h120l-80-160h120q33 0 56.5 23.5T880-720v480q0 33-23.5 56.5T800-160H160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800Zm0 240v320h640v-320H160Zm0 0v320-320Z',
	palette:
		'M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 32.5-156t88-127Q256-817 330-848.5T488-880q80 0 151 27.5t124.5 76q53.5 48.5 85 115T880-518q0 115-70 176.5T640-280h-74q-9 0-12.5 5t-3.5 11q0 12 15 34.5t15 51.5q0 50-27.5 74T480-80Zm0-400Zm-177 23q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17Zm120-160q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17Zm200 0q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17Zm120 160q17-17 17-43t-17-43q-17-17-43-17t-43 17q-17 17-17 43t17 43q17 17 43 17t43-17ZM480-160q9 0 14.5-5t5.5-13q0-14-15-33t-15-57q0-42 29-67t71-25h70q66 0 113-38.5T800-518q0-121-92.5-201.5T488-800q-136 0-232 93t-96 227q0 133 93.5 226.5T480-160Z',
	qr_code_2:
		'M520-120v-80h80v80h-80Zm-80-80v-200h80v200h-80Zm320-120v-160h80v160h-80Zm-80-160v-80h80v80h-80Zm-480 80v-80h80v80h-80Zm-80-80v-80h80v80h-80Zm360-280v-80h80v80h-80ZM180-660h120v-120H180v120Zm-60 60v-240h240v240H120Zm60 420h120v-120H180v120Zm-60 60v-240h240v240H120Zm540-540h120v-120H660v120Zm-60 60v-240h240v240H600Zm80 480v-120h-80v-80h160v120h80v80H680ZM520-400v-80h160v80H520Zm-160 0v-80h-80v-80h240v80h-80v80h-80Zm40-200v-160h80v80h80v80H400Zm-190-90v-60h60v60h-60Zm0 480v-60h60v60h-60Zm480-480v-60h60v60h-60Z',
	text_fields:
		'M280-160v-520H80v-120h520v120H400v520H280Zm360 0v-320H520v-120h360v120H760v320H640Z',
	timer:
		'M360-840v-80h240v80H360Zm80 440h80v-240h-80v240Zm-99.5 291.5Q275-137 226-186t-77.5-114.5Q120-366 120-440t28.5-139.5Q177-645 226-694t114.5-77.5Q406-800 480-800q62 0 119 20t107 58l56-56 56 56-56 56q38 50 58 107t20 119q0 74-28.5 139.5T734-186q-49 49-114.5 77.5T480-80q-74 0-139.5-28.5ZM678-242q82-82 82-198t-82-198q-82-82-198-82t-198 82q-82 82-82 198t82 198q82 82 198 82t198-82ZM480-440Z',
};

export interface MaterialSymbolProps {
	readonly name: MaterialSymbolName;
	/** Rendered edge length in CSS px. Defaults to 24 (the authored size). */
	readonly size?: number;
	readonly className?: string;
}

/**
 * Draw one Material Symbols glyph as an inline SVG.
 *
 * `fill="currentColor"` is inherited from the parent's `color`, so the
 * icon follows the row's text color through hover / focus without a
 * second palette.
 */
export function MaterialSymbol({ name, size = 24, className }: MaterialSymbolProps) {
	return (
		<svg
			aria-hidden="true"
			className={className}
			focusable="false"
			height={size}
			viewBox="0 -960 960 960"
			width={size}
			xmlns="http://www.w3.org/2000/svg"
		>
			<path d={PATHS[name]} fill="currentColor" />
		</svg>
	);
}
