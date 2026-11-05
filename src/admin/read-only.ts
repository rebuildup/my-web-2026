/**
 * Admin write guard for the production-readonly development mode
 * (Issue #377).
 *
 * While the dev server's bindings point at the PRODUCTION D1 / R2
 * (`pnpm dev:production-data`), an admin action would change
 * production data. The admin surface must therefore REFUSE the write
 * with a reason the operator can read, instead of performing it.
 *
 * The rule itself is owned by the `cloudflare` obligation
 * (`src/cloudflare/data-source.ts`) — the admin surface only asks
 * whether THIS operation may run. Reads are unaffected.
 *
 * The refusal is thrown as an `Error` whose message is the stable
 * code, matching the admin surface's existing convention (the upload
 * path raises `image_policy:<code>`, the delete path raises
 * `DELETE_REFERENCED_FAILURE`): the UI maps a known code to a fixed
 * sentence and never renders a raw server message.
 *
 * WHY THE IMPORT IS DYNAMIC
 * -------------------------
 * The Storybook ownership gate refuses a preview that reaches a
 * foreign boundary, and `src/cloudflare/**` is one (it owns the
 * bindings). The admin emoji-catalogue story reaches this module, so a
 * static import would put the Cloudflare obligation into the preview
 * graph. The dynamic import sits inside the guard function, and every
 * admin write handler reaches THIS module with a dynamic import inside
 * its `.handler(…)` body — the position the gate treats as Worker-only
 * (see `src/home/reactions/load.ts`).
 */
export async function assertAdminWriteAllowed(env: Env, operation: string): Promise<void> {
	const { PRODUCTION_READONLY_REFUSAL_CODE, productionWriteRefusal } = await import(
		'../cloudflare/data-source'
	);
	const refusal = productionWriteRefusal(env, operation);
	if (!refusal) return;
	throw new Error(PRODUCTION_READONLY_REFUSAL_CODE);
}
