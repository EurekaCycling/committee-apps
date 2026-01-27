# AGENTS.md

This file is for coding agents working in this repository. It summarizes
how to build, lint, and test the project and captures code style guidelines
observed in the codebase.

No Cursor or Copilot instruction files were found in:
- .cursor/rules/
- .cursorrules
- .github/copilot-instructions.md

Repository layout
- backend/: Go Lambda handlers and storage helpers
- frontend/: Vite + React + TypeScript UI
- cdk/: AWS CDK app (TypeScript)
- infra/: Infrastructure assets (if needed)

Key entrypoints
- `backend/cmd/api/main.go`: Lambda router wiring.
- `backend/internal/endpoints/`: API handlers.
- `frontend/src/App.tsx`: app routes and auth wrapper.
- `cdk/bin/`: CDK app entrypoint.

Build / lint / test commands

Root (SAM)
- Build: `make build` (runs `sam build`)
- Local API: `make start-api` (runs `sam local start-api`)

Runtime configuration (reference only)
- Backend expects `DOCUMENTS_BUCKET_NAME`, `DATA_BUCKET_NAME`.
- Backend reads `DOCUMENTS_SIGNING_SECRET` (falls back to a dev default).
- Frontend uses `VITE_NO_AUTH=true` to bypass auth for local mocking.

Backend (Go)
- From `backend/`
- Build: `go build ./cmd/api`
- Test all: `go test ./...`
- Run single test: `go test ./internal/endpoints -run '^TestLedgerGet$'`
- Format edited files: `gofmt -w path/to/file.go`
- Notes: no dedicated lint command configured for Go
- Storage: handlers read/write via `deps.Data` and `deps.Storage` (S3-backed).

Frontend (Vite + React)
- From `frontend/`
- Install: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Preview build: `npm run preview`
- Tests: no test runner configured in `package.json`
- Mock data: `frontend/src/mocks/` used when `VITE_NO_AUTH` is true.

CDK (TypeScript)
- From `cdk/`
- Install: `npm install`
- Build: `npm run build`
- Test all (Jest): `npm run test`
- Run single test by name: `npm run test -- -t "pattern"`
- Run single test file: `npm run test -- path/to/file.test.ts -t "pattern"`

Code style guidelines

General
- Keep changes small and scoped; avoid unrelated refactors.
- Follow existing patterns in each package (backend vs frontend vs cdk).
- Prefer ASCII in source files unless the file already uses Unicode.
- Avoid adding new dependencies unless required for the task.

Go (backend)
- Formatting: always run gofmt on edited Go files.
- Imports: standard library first, then third-party; gofmt will sort/group.
- Naming:
  - Exported types/functions in CamelCase.
  - Local variables in lowerCamelCase.
  - Constants in lowerCamelCase unless exported.
- Types:
  - Use explicit structs with json tags for API payloads.
  - Prefer small helper structs near the handlers that use them.
- Error handling:
  - Check and return errors immediately.
  - Use `errorResponse(err, deps.Headers)` for 500 responses.
  - For validation failures, return 400 with a clear JSON error.
- Logging: use `fmt.Printf` (matches existing handlers).
- Time parsing/formatting: use explicit layouts like `"2006-01"` or
  `"02/01/2006"` (see ledger endpoints).
- Rounding: use helper functions like `roundCurrency` for money calculations.
- Lambda responses: return `events.APIGatewayProxyResponse` with `deps.Headers`.
- API conventions:
  - Read query params from `request.QueryStringParameters`.
  - Use JSON responses for errors and success payloads.

TypeScript + React (frontend)
- Formatting: ESLint is configured via `npm run lint`; keep it clean.
- Imports:
  - Use `import type` for types (already used in `src/api.ts`).
  - Keep third-party imports at the top, then local modules.
- Naming:
  - React components use PascalCase and named exports.
  - Hooks use `useX` naming.
  - Local vars and functions in lowerCamelCase.
- Types:
  - Strict TypeScript is enabled; avoid `any` unless unavoidable.
  - Prefer explicit types for API response shapes.
- Error handling:
  - Use `apiFetch` for HTTP calls to keep consistent auth/error handling.
  - Surface user-facing errors via UI alert state (see `Ledger.tsx`).
- State management:
  - Prefer local component state and hooks; avoid unnecessary globals.
- Strings and punctuation:
  - Single quotes are the norm in existing files.
  - Semicolons are used consistently; keep them.
- CSS usage:
  - Styles are plain CSS files imported next to components/pages.
  - Preserve existing class naming patterns when adjusting styles.
- Auth/config:
  - Runtime config is loaded via `fetchAppConfig` in `src/config`.
  - Use `VITE_NO_AUTH=true` for local mocking; avoid hardcoding tokens.
  - `apiFetch` centralizes auth headers and error handling.

CDK (TypeScript)
- Compiler settings are strict and use `NodeNext` modules.
- Prefer strongly typed constructs and avoid `any`.
- Keep stack/resource naming consistent with existing constructs.
- Tests use Jest; keep stacks small and testable.

File-specific conventions and helpers
- Backend common helpers:
  - `backend/internal/endpoints/common.go` contains `errorResponse` and
    default headers helpers. Reuse these rather than duplicating logic.
- Ledger endpoints:
  - `backend/internal/endpoints/ledger.go` has ledger models and utilities;
    keep related helpers in this file unless shared elsewhere.

API response conventions
- Default CORS/JSON headers come from `DefaultHeaders()`.
- For non-JSON responses (e.g., PDF), override `Content-Type` explicitly.
- Prefer `json.Marshal` for payloads rather than hand-building JSON strings.

Testing notes
- Backend tests are limited; `TestLedgerGet` is an example integration test
  that skips in CI when `CI` is set.
- Frontend currently lacks a test setup; add one only if needed.
- CDK tests use Jest and can be filtered by name with `-t`.

If you add new commands or tooling, update this file accordingly.
