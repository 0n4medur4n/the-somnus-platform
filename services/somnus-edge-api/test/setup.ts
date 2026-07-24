import "reflect-metadata";

// Test-only edge config defaults (real values come from env in
// deployed environments). COOKIE_SECURE stays false: the test client
// talks plain HTTP, where a Secure cookie would never come back.
process.env["FIREBASE_PROJECT_ID"] ??= "somnus-dev-test";
process.env["COOKIE_SECRET"] ??= "test-only-cookie-secret-0123456789";
process.env["COOKIE_SECURE"] ??= "false";
process.env["COOKIE_SAMESITE"] ??= "lax";
