# Unit 1 — Foundation Acceptance Checklist

- [x] Repository uses a pnpm workspace with TypeScript packages.
- [x] API, web, worker, shared contracts, connector packages, and database package boundaries exist.
- [x] API exposes a liveness-only `GET /health` endpoint.
- [x] Initial page clearly states that no cloud accounts are connected and no live data is shown.
- [x] Connector contract is read-only and has no resource mutation methods.
- [x] Security baseline documents credential handling, tenant isolation, and partial-sync safety.
- [ ] Install dependencies and run type checks locally.
- [ ] Run API tests and build the web application locally.
- [ ] Add CI checks and resolve any environment-specific failures.

## Commands

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm test
pnpm --filter @cloudroute/web build
pnpm --filter @cloudroute/api build
```

The unchecked items require execution in a Node.js environment. Creating files on GitHub does not itself prove that dependencies install or tests pass.
