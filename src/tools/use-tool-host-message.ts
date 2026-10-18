import { useEffect } from 'react';
import { attachToolMessageGuard } from './embed-policy';
import type {
	AcceptedToolMessage,
	ToolHostMessageDeclaration,
	ToolMessageTarget,
} from './embed-policy';

/**
 * Host-side Tool message channel (Issue #465).
 *
 * The hook is the ONLY place in the host that may attach a `message`
 * listener for a Tool frame, and it attaches one only when the Tool
 * declares `delivery.host_message` in `src/tools/manifest.json`.
 * Today no Tool declares it, so no Tool frame has a message channel
 * at all — which is the strongest possible form of "an unexpected
 * message cannot influence the host": there is no handler to reach.
 *
 * When a contract exists, `src/tools/embed-policy.ts` gates every
 * event on three independent facts:
 *
 *   - `event.origin` equals the declared expected origin
 *   - `event.source` is the Tool iframe's own `contentWindow`
 *   - `data.type` is in the manifest's `allowed_types`
 *
 * Any other event is refused without dispatch. The hook therefore has
 * no fallback branch and no "trusted" flag: the manifest is the only
 * input that can open the channel.
 *
 * Two honest limitations, both fail-closed:
 *
 *   - The guard is built with `toolWindow: getToolWindow()` SAMPLED
 *     once, when the effect runs. That sample is taken after the iframe
 *     is mounted, and a same-frame navigation keeps the same
 *     `WindowProxy`, so the identity does not go stale; a frame that
 *     navigates to a foreign origin is refused by the origin check
 *     regardless. The channel is still rebuilt whenever `slug`,
 *     `declaration`, `getToolWindow`, `onMessage` or `target` changes.
 *   - `resolveExpectedToolOrigin`'s optional `frameOrigin` argument is
 *     NOT supplied here, because a sandboxed `contentWindow` does not
 *     expose its origin. The runtime defence is therefore
 *     `event.origin` + `event.source` equality, not a pre-checked frame
 *     origin — see the function's docstring.
 */

export interface ToolHostMessageChannelOptions {
	readonly slug: string;
	/** `undefined` when the Tool declares no contract — the default. */
	readonly declaration: ToolHostMessageDeclaration | undefined;
	/** Live reference to the Tool frame window; `null` before mount. */
	readonly getToolWindow: () => unknown;
	/** Receives messages that passed every check. */
	readonly onMessage: (message: AcceptedToolMessage) => void;
	/** `window`-like target. Defaults to the browser `window`. */
	readonly target?: ToolMessageTarget;
}

/** The browser `window`, or `null` during SSR / workerd test runs. */
function resolveDefaultTarget(): ToolMessageTarget | null {
	return typeof window === 'undefined' ? null : (window as unknown as ToolMessageTarget);
}

export function useToolHostMessage(options: ToolHostMessageChannelOptions): void {
	const { slug, declaration, getToolWindow, onMessage, target } = options;

	useEffect(() => {
		const host = target ?? resolveDefaultTarget();
		if (!host || !declaration) return;

		const detach = attachToolMessageGuard({
			target: host,
			slug,
			declaration,
			hostOrigin: host.location?.origin ?? '',
			toolWindow: getToolWindow(),
			dispatch: onMessage,
		});

		// `null` means "no channel" (no contract / unresolvable origin):
		// nothing was attached, so there is nothing to clean up.
		return detach ?? undefined;
	}, [slug, declaration, getToolWindow, onMessage, target]);
}
