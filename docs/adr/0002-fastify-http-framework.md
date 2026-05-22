---
status: "Accepted"
date: "2026-05-18"
decision-makers: "Joao Escudero"
---

# ADR-002: Use Fastify as the HTTP Framework

> **Note on dating:** This decision was made during initial project design (2026-05-18) and documented here on 2026-05-22 as a back-fill from PRD.md §9. The `date` field reflects the original decision.

## Context and Problem Statement

Aprumo's core ledger API (Phase 3) needs an HTTP framework to expose the REST endpoints (`POST /transactions`, `GET /accounts/:id`, `POST /accounts`, `GET /health`, etc.) and the webhook ingest endpoint (`POST /webhooks/:provider`). The framework must be TypeScript-first, handle JSON Schema validation without silent type coercion, and produce OpenAPI/Swagger documentation.

The decision is: **which Node.js HTTP framework serves as Aprumo's API layer?**

## Decision Drivers

* **TypeScript-first**: the framework must have first-class TypeScript support with accurate type inference for route handlers, request/response shapes, and plugin ecosystem.
* **`coerceTypes: false` is mandatory**: Aprumo handles money amounts as `BIGINT amount_cents`. Any framework that silently coerces `"123"` → `123` (Number) at the schema validation layer creates a correctness risk. Fastify's Ajv integration exposes `coerceTypes: false` as an explicit option.
* **Built-in JSON Schema validation**: request body and response schemas must be validated declaratively, not via middleware ad-hoc. This enables schema-driven OpenAPI spec generation.
* **Low overhead**: the ledger API will run in the same process as pg-boss workers (or as sibling processes from the same Docker image). Fastify is the lowest-overhead mature Node.js framework at the target RPS (100–500 RPS for v0.1/v0.5).
* **OpenAPI generation**: `@fastify/swagger` + `@fastify/swagger-ui` produce OpenAPI spec from Fastify route schemas with minimal configuration. This is required for the v0.1 spec and design partner onboarding.
* **Plugin ecosystem**: authentication hooks, rate limiting (`@fastify/rate-limit`), CORS (`@fastify/cors`), and structured error responses via plugin composition.
* **Async-first**: Fastify route handlers are async by default. Prometheus metrics via `prom-client` integrate cleanly via a Fastify plugin.

## Considered Options

* **Option A: Fastify 5** (chosen)
* **Option B: Hono**
* **Option C: Express 5**

## Decision Outcome

**Chosen option: Option A — Fastify 5**, because it is the only mature option that combines TypeScript-first design, explicit `coerceTypes: false` support, built-in JSON Schema validation, and `@fastify/swagger` for spec generation. Hono's edge-first positioning makes it stateless-optimized and not idiomatic for persistent Postgres connections. Express lacks schema-native validation and its middleware ecosystem adds coercion risk.

### Consequences

**Good:**
* `coerceTypes: false` prevents silent numeric coercion at the schema validation layer — critical for money amounts.
* Built-in Ajv JSON Schema validation on every route; schema is the documentation.
* `@fastify/swagger` generates OpenAPI spec directly from route schemas — no separate spec maintenance.
* Lowest overhead among mature options: sub-millisecond serialization for typical ledger response payloads.
* Async route handlers align with the `async/await` + Drizzle query pattern throughout Aprumo.
* TypeScript plugin typing via `@fastify/type-provider-typebox` or `zod-fastify` available if richer type inference is needed in Phase 3.

**Bad:**
* No Express middleware compatibility — cannot reuse express-based middleware packages (rate-limit, auth). Mitigated: Fastify ecosystem covers all required middleware.
* Learning curve for developers familiar only with Express — offset by cleaner plugin composition model.
* Fastify's encapsulation model (scoped plugin state) requires deliberate setup for shared database connections and pg-boss instances.

## Pros and Cons of the Options

### Option A: Fastify 5

**Pros:**
- `coerceTypes: false` is an explicit, documented option on the Ajv instance.
- Built-in JSON Schema validation on requests and responses.
- `@fastify/swagger` produces OpenAPI 3.x spec from route schemas without a separate source of truth.
- Fastest throughput among mature Node.js frameworks (relevant for Phase 5 high-volume webhook ingest).
- Async-first: no callback hell, no express-style `next()`.
- TypeScript types for route handlers are accurate when using a type provider.
- Active maintenance; Fastify v5 released 2024 with Node 22 support.

**Cons:**
- No Express middleware compatibility.
- Plugin encapsulation model is non-obvious for Express-familiar developers.

### Option B: Hono

Hono is a lightweight, edge-first HTTP framework with Cloudflare Workers / Deno / Bun as primary targets.

**Why Hono was not chosen:**
- Edge-first design assumes stateless, short-lived handlers. Aprumo's handlers are stateful: they use Drizzle connections, pg-boss instances, and connection pools.
- Hono's type system is accurate but its validation ecosystem (Zod-based via `@hono/zod-validator`) does not integrate with `@fastify/swagger` or produce OpenAPI spec as a first-class feature.
- Less ecosystem depth for authentication, rate limiting, and observability compared to Fastify's plugin library.
- Community and production deployment patterns at Aprumo's use case (persistent Node.js API server with Postgres) favor Fastify.

### Option C: Express 5

Express is the most widely used Node.js framework, now in version 5.

**Why Express was not chosen:**
- No built-in schema validation. Body parsing is middleware; validation is third-party (express-validator, Joi, Zod). This creates coercion risk unless carefully managed.
- No native OpenAPI spec generation from route definitions.
- Callback-based design (even in v5, the async model is not idiomatic — `next()` is still the error propagation mechanism).
- Schema validation layer does not expose `coerceTypes: false` natively — would require Ajv manual configuration around every validated route.
- Slower throughput than Fastify at the serialization layer.

## More Information

* [Fastify documentation](https://www.fastify.io/)
* [`@fastify/swagger`](https://github.com/fastify/fastify-swagger) — OpenAPI spec from Fastify routes
* Fastify `coerceTypes: false` in Ajv options: set via `ajv: { coerceTypes: false }` in `fastify({ ajv: { ... } })`.
* See Phase 3 (Core Ledger API) for Fastify route implementation details.
* Fastify version: 5.8.5 (verified 2026-05-18).
