# Security

## Reporting a Vulnerability

We take security seriously. Please do **not** open a public GitHub issue for security vulnerabilities.

### Preferred: GitHub Private Vulnerability Reporting

Use [GitHub Security Advisories](../../security/advisories/new) to report vulnerabilities privately. This is our preferred channel — it keeps the report confidential until a fix is released and allows us to coordinate a CVE assignment.

To use it:
1. Go to the **Security** tab of this repository
2. Click **"Report a vulnerability"**
3. Fill in the details

GitHub Private Vulnerability Reporting must be enabled on the repository for this link to work. If it is not yet enabled, use the email alternative below.

### Alternative: Email

If Private Vulnerability Reporting is not available or you prefer email:

**security@aprumo.dev** _(placeholder — will be updated when domain is registered)_

Please encrypt your report with our PGP key if the content is sensitive. Key will be published at the same address once available.

## Response Policy

- We follow **responsible disclosure**: we ask for a **90-day disclosure window** from the date of your report before any public disclosure.
- A CVE will be reserved on request for confirmed vulnerabilities.
- We will acknowledge receipt of your report within **48 hours** and provide a timeline for a fix within **7 days**.

## Scope

### In scope

Vulnerabilities in `@aprumo/*` published packages, specifically:
- `@aprumo/core`
- `@aprumo/connector-base`
- `@aprumo/connector-starkbank`
- `@aprumo/webhooks`

Vulnerabilities that could lead to:
- Ledger data corruption or unauthorized mutation
- Authentication or authorization bypass in the REST API
- Exact-once webhook guarantee bypass (duplicate processing leading to double-posting)
- Secret / credential exposure via logs or API responses

### Out of scope

- Vulnerabilities in **third-party connectors** not maintained in this repository
- Vulnerabilities in **self-hosted deployments** due to misconfiguration
- Vulnerabilities in **transitive dependencies** (report directly to the upstream maintainer)
- Social engineering attacks against Aprumo contributors
- Denial of service via extremely large payloads (rate limiting is operator-configured)

## PCI Scope Note

Aprumo is designed to operate at **SAQ-A PCI scope** by design. PAN (Primary Account Number / card number) storage is **explicitly out of scope** — Aprumo never stores, processes, or transmits card numbers. Any finding that assumes PAN storage is not applicable.
