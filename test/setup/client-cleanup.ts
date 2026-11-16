import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';

// Clean up after each test to prevent element leakage between tests
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});
