# Business model: SaaS and self-hosted

Status: **proposed**. Only the code boundary is decided (decisions.md D9). The license is **pending** (D8): until it is chosen, everything is all rights reserved (`"license": "UNLICENSED"`, no LICENSE file).

## The problem

Skematron will be sold as a hosted SaaS and will also be self-hostable (AGENTS.md). The self-hosted edition must work without the hosted service. That means the business cannot be protected by keeping code secret or by phoning home. Self-hosted code can always be read and modified, so obfuscation or DRM gives no real protection.

Protection comes from three layers.

## 1. License (pending; decide before the first public push)

A release published under a permissive license stays permissive forever. Relicensing after outside contributions also requires every contributor's agreement.

| Option | Self-host for own use | Others may sell it as SaaS | Notes |
| --- | --- | --- | --- |
| MIT / Apache-2.0 | yes | yes | Widest adoption, no protection. |
| FSL-1.1-ALv2 (Functional Source License) | yes | no ("competing use") | Each release becomes Apache-2.0 after 2 years. Source-available. Proposed default for a solo developer. |
| ELv2 (Elastic License 2.0) | yes | no (no managed service; no circumventing license keys) | Source-available, no time-based conversion. |
| AGPL-3.0 core + commercial `ee/` | yes | only if they publish their changes | Open-core with an OSI license. Needs a CLA before outside contributions. |
| Proprietary + license key | per license | no | Least community trust. Conflicts with the no-lock-in principle unless export stays free. |

Get legal review before choosing.

## 2. Editions (proposed)

- **Free / self-hosted:**
  - The full core workflow for a team: import → version → diff → review → export/apply.
  - It must be genuinely useful; that is the product's marketing and AGENTS.md's no-lock-in principle.
  - Export must never be paywalled.
- **Paid** (SaaS upper tiers, and an Enterprise license for self-hosted): features organizations need, not individuals:
  - SSO/SAML/SCIM and fine-grained RBAC
  - multi-step production approval policies
  - audit-log retention and export
  - scheduled drift monitoring
  - notifications
  - environment promotion
  - support/SLA
- **SaaS sells convenience:** no operations work, backups, upgrades, and secure connectivity to private databases.

## 3. Code boundary (decided, D9)

- `packages/core` and `packages/adapters` never contain edition, entitlement, license-key or billing logic.
- One entitlements layer in the app (future `apps/web`) answers questions like "can this organization use feature X" and "what are its limits".
  - **SaaS:** reads subscription state from the metadata database.
  - **Self-hosted:** reads a signed license file (e.g. Ed25519), verified offline with an embedded public key. No phone-home.
- Paid-feature code lives in its own clearly separated module. If open-core is chosen, that module carries its own license.
- SaaS-only code (billing provider, metering, multi-tenant hardening such as SSRF rules) sits behind a deployment-mode setting. Self-hosted installs do not enforce SaaS trial limits (AGENTS.md).
- When a trial or license ends, features degrade to the free edition. Read and export keep working, and data is never deleted (AGENTS.md "Storage and SaaS Trial").

## Outside the code

- Register the "Skematron" trademark and publish a trademark policy, so forks cannot use the name.
- Set up a CLA or DCO before accepting outside contributions.
- Self-hosted telemetry is opt-in only and never includes schema contents or credentials.

## Open questions

- Which license, and when to publish the repository.
- Exact edition and pricing boundaries.
- Format and lifecycle of license keys (issuance, renewal, offline grace period).
