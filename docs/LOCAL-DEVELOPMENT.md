# Local development

Requirements: Node.js 22+, pnpm 10+, and Docker Compose.

1. Copy `.env.example` to `.env`. The supplied values are for local development only.
2. Start local dependencies: `docker compose up -d`.
3. Install dependencies: `corepack enable && pnpm install`.
4. Apply schema migrations: `pnpm db:migrate`.
5. Start the API in one terminal: `pnpm dev:api`.
6. Start the worker in another terminal: `pnpm dev:worker`.
7. Start the web app in a third terminal: `pnpm dev:web`.
8. Open the local web app at `http://localhost:3000`, create an account, and sign in.

The application database role is intentionally a non-superuser so PostgreSQL row-level security policies are exercised in local development. Docker's administrator password and the app password in the example are public development-only values; never reuse them outside your machine.

The AWS connection wizard cannot validate a real account until the deployed CloudRoute runtime has a dedicated role and `CLOUDROUTE_AWS_PRINCIPAL_ARN` is configured. Do not grant a broad AWS principal access to your account to bypass this deployment prerequisite.

To reset local data, stop the services and remove the named volumes with `docker compose down -v`. This deletes local development data.
