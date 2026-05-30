---
status: "Accepted"
date: "2026-05-18"
decision-makers: "Joao Escudero"
---

# ADR-008: MIT License for Core + Enterprise Edition

> **Note on dating:** This decision was made during initial project design (2026-05-18) and documented here on 2026-05-22 as a back-fill from PRD.md §9. The `date` field reflects the original decision.

## Context and Problem Statement

Aprumo's core infrastructure (`@aprumo/core`, `@aprumo/connector-base`, `@aprumo/connector-starkbank`, `@aprumo/webhooks`) must be licensed to maximize adoption while enabling commercial sustainability. Financial infrastructure is a trust-sensitive category: developers and CTOs will hesitate to build on a core that could be relicensed or locked down.

The question is: **which licensing model maximizes adoption while creating a viable commercial path?**

The tension:
- **Pure open-source (MIT)**: maximizes adoption, community contributions, and trust. No direct revenue from the OSS product.
- **Fully closed / proprietary**: blocks community contributions and adoption. Financial infrastructure must be auditable to be trustworthy.
- **Source-available or SSPL**: hybrid that restricts hosting use. Creates friction for self-hosted design partners. Risks perception as "fake OSS."
- **MIT core + enterprise edition**: open core model. Core is fully open; enterprise features (dashboards, hosted service, SLA) are commercial.

## Decision Drivers

* **OSS credibility**: a financial ledger must be auditable. Contributors and adopters must be able to inspect every line of code for correctness and security. MIT achieves this unconditionally.
* **Community connector ecosystem**: the connector model (`LedgerConnector` interface + contract tests) is designed for community-built connectors (Pagar.me, Stripe, Asaas, Iugu, etc.). Community contributors will only build connectors for a project they trust will remain open. MIT removes any ambiguity.
* **Commercial sustainability**: pure MIT with no commercial path risks contributor burnout and unsustainable maintenance. Enterprise edition (dashboards, hosted multi-tenancy, SLA) provides revenue without restricting OSS adoption.
* **GitHub star velocity**: the OSS launch strategy (GitHub stars, community, content) depends on the project being unambiguously open-source. SSPL or BSL would be perceived as "Elasticsearch-style relicensing risk" and reduce adoption.
* **No vendor lock-in message**: design partners choose Aprumo partly because they can self-host and avoid PSP lock-in. A restrictive license would undercut this message.
* **Moat from execution, not license**: the competitive moat comes from connector ecosystem quality, community trust, and execution speed — not from license restrictions.

## Considered Options

* **Option A: MIT for all core packages + commercial enterprise edition** (chosen)
* **Option B: Fully closed source / proprietary**
* **Option C: Server Side Public License (SSPL) or Business Source License (BSL)**

## Decision Outcome

**Chosen option: Option A — MIT license for all core packages (`@aprumo/core`, `@aprumo/connector-base`, `@aprumo/connector-starkbank`, `@aprumo/webhooks`); commercial enterprise edition for non-OSS features.**

### License boundary

**MIT (open source):**
- `@aprumo/core` — ledger schema, `post_transaction`, REST API, balance worker.
- `@aprumo/connector-base` — `LedgerConnector` interface, contract tests, `Money` type, HMAC helpers.
- `@aprumo/connector-starkbank` — Starkbank connector (v0.1).
- `@aprumo/webhooks` — inbound webhook ingest, outbound dispatcher.
- All connector packages built by the community.

**Enterprise (commercial, closed):**
- Hosted multi-tenant Aprumo instance (managed service).
- Analytics dashboards and financial reporting UI.
- Enterprise SLA + dedicated support.
- Advanced multi-tenancy isolation features.
- Potentially: SOC2-certified hosted deployment.

### What is NOT in the OSS core

Per `CLAUDE.md`: "Não crie UI/dashboards no core OSS — isso é da edição enterprise."
- No dashboards.
- No hosted instance in OSS.
- No managed multi-tenancy in OSS.
- No UI layer.

### Consequences

**Good:**
* Unambiguous MIT license maximizes community trust and connector contributions.
* Design partners can audit every line of the ledger for correctness and security.
* No risk of "relicensing" perception — MIT is irrevocable.
* GitHub stars + community growth accelerated by MIT reputation.
* Enterprise edition provides commercial revenue without restricting OSS adoption.
* Connector ecosystem grows via community — competitive moat is network of connectors, not license restriction.

**Bad:**
* AWS-style fork of the enterprise edition is possible. Mitigated: moat from community + execution, not license.
* Enterprise edition monetization depends on execution quality of the hosted service and support — not protected by license.
* MIT does not prevent competitors from building hosted Aprumo services. Accepted.

## Pros and Cons of the Options

### Option A: MIT core + enterprise edition (open core)

**Pros:**
- Maximum adoption and community trust.
- Connector ecosystem growth via community.
- Commercial path via enterprise edition.
- Precedent: HashiCorp (pre-BSL), Grafana, Sentry, GitLab all used this model effectively.

**Cons:**
- No direct revenue from OSS product.
- AWS-style fork risk for enterprise edition.

### Option B: Fully closed source

**Pros:**
- Full control over the codebase.
- Revenue from every user.

**Cons:**
- Financial infrastructure must be auditable. Closed-source ledger is unacceptable to security-conscious CTOs.
- Zero community contributions.
- No connector ecosystem.
- Fundamentally at odds with Aprumo's OSS positioning.

### Option C: SSPL or Business Source License (BSL)

SSPL (used by MongoDB, Elasticsearch post-relicense) and BSL (HashiCorp Terraform) restrict hosting use while allowing self-hosted deployment.

**Why Option C was not chosen:**
- Perception risk: "fake OSS." Both SSPL and BSL are not OSI-approved. The OSS community has strong negative reactions to SSPL (Elasticsearch fork → OpenSearch) and BSL (Terraform fork → OpenTofu).
- Design partners who self-host would be restricted under SSPL hosting definitions.
- Connector contributors would hesitate to build on a project with a restrictive license.
- Aprumo's competitive moat should come from execution and community, not license. Restrictive license does not provide meaningful protection while creating significant adoption friction.

## More Information

* [PRD.md §1.3 — Non-objectives](../PRD.md): "Dashboards / UI rica" is out of scope for OSS.
* [PRD.md §8.2 — Stack](../PRD.md): "MIT OSS" is the licensing model.
* [PRD.md §11 — Risks](../PRD.md): "AWS-style fork of enterprise edition. Moat must come from execution, community, and connector ecosystem."
* Comparable open-core models: Grafana (MIT core + Grafana Cloud), Sentry (BSD → SSPL; case study in relicensing risk), GitLab (MIT CE + EE).
* npm scope: `@aprumo`. GitHub organization: `aprumo`. All published under MIT.
