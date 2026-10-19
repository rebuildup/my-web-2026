/**
 * Public surface for the waiting state (Issue #489).
 *
 * `editorial` owns the visual language every state speaks, so
 * `src/router.tsx` imports `RoutePendingState` from this barrel and never
 * reaches into the component module — the same rule
 * `src/editorial/error-states/index.ts` states for the failure surfaces.
 *
 * ONLY the router binding is re-exported. `WaitingSurface` and its copy
 * are the shell's own surface: the router must not be able to render
 * them without the retry href, and a consumer that wants to reason about
 * the wording imports `./WaitingState` directly (which is what its
 * contract test does). Re-exporting them here would publish a second,
 * router-less way to render the state.
 */
export { RoutePendingState } from './RoutePendingState';
