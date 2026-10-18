import type { ReactElement } from 'react';
import { buildCreativeWorkNode, buildPersonNode } from './nodes';
import type { CreativeWorkFacts, PersonFacts } from './types';

/**
 * JSON-LD script components (Issue #422).
 *
 * Two components, matching the page-owns-its-own-chrome convention
 * (Issue #199): routes import and render them explicitly next to
 * `<BreadcrumbJsonLd />`, rather than a root-level provider.
 *
 * Like the breadcrumb JSON-LD, a `<script>` has no visual rendering,
 * so the style-agnostic rule does not apply here.
 *
 * Both components render `null` when the facts they were handed
 * cannot produce a meaningful node — the fail-closed contract of
 * `src/about/data.ts`. The route coverage suite
 * (`test/integration/structured-data.test.ts`) asserts that a node
 * IS present on `/about` and `/portfolio/<slug>`, so "silently
 * missing" is a failing test, not a passing one.
 */

/** `<script type="application/ld+json">` carrying the `Person` node. */
export function PersonJsonLd({ facts }: { facts: PersonFacts }): ReactElement | null {
	const node = buildPersonNode(facts);
	if (!node) return null;
	return <JsonLdScript node={node} />;
}

/** `<script type="application/ld+json">` carrying the `CreativeWork` node. */
export function CreativeWorkJsonLd({
	facts,
	author,
}: {
	facts: CreativeWorkFacts;
	author: PersonFacts;
}): ReactElement | null {
	const node = buildCreativeWorkNode(facts, author);
	if (!node) return null;
	return <JsonLdScript node={node} />;
}

function JsonLdScript({ node }: { node: object }): ReactElement {
	return (
		<script
			type="application/ld+json"
			// biome-ignore lint/security/noDangerouslySetInnerHtml: `JSON.stringify` of a controlled projection of approved repo facts — no visitor input is interpolated, so this never produces a `</script>` injection vector. React's normal text escape would HTML-escape the JSON braces and break the script payload.
			dangerouslySetInnerHTML={{ __html: JSON.stringify(node) }}
		/>
	);
}
