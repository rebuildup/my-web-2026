/**
 * Test-only Better Auth fixture.
 *
 * Lives outside src/ so Home tests can bootstrap Better Auth state without
 * creating a production owner dependency from src/home -> src/cloudflare.
 */
export { auth } from '../../src/cloudflare/auth/better-auth';
