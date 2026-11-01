import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedBrowserOrigin, validateProductionEnvironment } from "./runtime-config.js";

test("development does not require production-only configuration", () => {
  assert.deepEqual(validateProductionEnvironment({ NODE_ENV: "development" }), []);
});

test("production rejects missing database, TLS, and public origin configuration", () => {
  const errors = validateProductionEnvironment({ NODE_ENV: "production" });
  assert.equal(errors.length, 3);
  assert.ok(errors.some((error) => error.includes("DATABASE_URL")));
  assert.ok(errors.some((error) => error.includes("DATABASE_SSL")));
  assert.ok(errors.some((error) => error.includes("PUBLIC_APP_ORIGIN")));
});

test("production accepts a PostgreSQL URL, verified TLS, and an HTTPS origin", () => {
  assert.deepEqual(validateProductionEnvironment({
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://cloudroute:secret@db.example.com:5432/cloudroute",
    DATABASE_SSL: "true",
    PUBLIC_APP_ORIGIN: "https://cloudroute.example.com",
  }), []);
});

test("production rejects insecure or malformed origins and non-PostgreSQL URLs", () => {
  const errors = validateProductionEnvironment({
    NODE_ENV: "production",
    DATABASE_URL: "https://db.example.com",
    DATABASE_SSL: "false",
    PUBLIC_APP_ORIGIN: "http://cloudroute.example.com/app",
  });
  assert.ok(errors.some((error) => error.includes("postgres")));
  assert.ok(errors.some((error) => error.includes("DATABASE_SSL")));
  assert.ok(errors.some((error) => error.includes("HTTPS origin")));
});

test("production browser mutations require the exact configured origin", () => {
  assert.equal(isAllowedBrowserOrigin("https://cloudroute.example.com", "https://cloudroute.example.com", true), true);
  assert.equal(isAllowedBrowserOrigin("https://attacker.example", "https://cloudroute.example.com", true), false);
  assert.equal(isAllowedBrowserOrigin(undefined, "https://cloudroute.example.com", true), false);
});

test("development permits non-browser requests without an Origin header", () => {
  assert.equal(isAllowedBrowserOrigin(undefined, "http://localhost:3000", false), true);
});
