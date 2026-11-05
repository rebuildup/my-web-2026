// `PetSprite` is deliberately NOT re-exported: it is reached only through
// the dynamic import in `PetCompanion`, which is what keeps it out of the
// initial JS closure. Re-exporting it from the barrel would restore a
// static edge for any importer and let the decorator back into first paint.
export { PetCompanion } from './PetCompanion';
// The page-level corridor that keeps the fixed overlay clear of the
// reading column (Issue #767). Static on purpose: it is a layout
// reservation that must exist in the server document, before the
// lazily loaded sprite arrives.
export { petSafeAreaStyle } from './safe-area';
