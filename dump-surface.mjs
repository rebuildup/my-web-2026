import { readCurrentSurface } from './scripts/check-publication-diff.mjs';
import { serializeSurfaceCore } from './scripts/publication-surface.mjs';
const s = readCurrentSurface();
process.stdout.write(JSON.stringify(JSON.parse(serializeSurfaceCore(s)), null, 1));
