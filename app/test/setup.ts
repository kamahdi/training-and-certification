import '@testing-library/jest-dom/vitest';

// Many sign-ins from one address in tests; the limiter has its own test with it switched on.
process.env.RATE_LIMIT ??= 'off';
