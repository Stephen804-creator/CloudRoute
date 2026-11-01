export interface RuntimeEnvironment {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  DATABASE_SSL?: string;
  PUBLIC_APP_ORIGIN?: string;
}

export function validateProductionEnvironment(env: RuntimeEnvironment): string[] {
  if (env.NODE_ENV !== "production") return [];

  const errors: string[] = [];
  if (!env.DATABASE_URL) {
    errors.push("DATABASE_URL is required");
  } else {
    try {
      const databaseUrl = new URL(env.DATABASE_URL);
      if (databaseUrl.protocol !== "postgres:" && databaseUrl.protocol !== "postgresql:") {
        errors.push("DATABASE_URL must use postgres:// or postgresql://");
      }
    } catch {
      errors.push("DATABASE_URL must be a valid PostgreSQL connection URL");
    }
  }

  if (env.DATABASE_SSL !== "true") errors.push("DATABASE_SSL=true is required in production");

  if (!env.PUBLIC_APP_ORIGIN) {
    errors.push("PUBLIC_APP_ORIGIN must be configured in production");
  } else {
    try {
      const origin = new URL(env.PUBLIC_APP_ORIGIN);
      if (origin.protocol !== "https:" || origin.origin !== env.PUBLIC_APP_ORIGIN.replace(/\/$/, "")) {
        errors.push("PUBLIC_APP_ORIGIN must be an HTTPS origin without a path");
      }
    } catch {
      errors.push("PUBLIC_APP_ORIGIN must be a valid HTTPS origin");
    }
  }
  return errors;
}

export function isAllowedBrowserOrigin(
  requestOrigin: string | undefined,
  configuredOrigin: string | undefined,
  production: boolean,
): boolean {
  if (!requestOrigin) return !production;
  const expected = (configuredOrigin ?? "http://localhost:3000").replace(/\/$/, "");
  return requestOrigin === expected;
}

export function assertRuntimeEnvironment(env: RuntimeEnvironment = process.env): void {
  const errors = validateProductionEnvironment(env);
  if (errors.length) throw new Error("Production configuration is incomplete: " + errors.join("; "));
}
