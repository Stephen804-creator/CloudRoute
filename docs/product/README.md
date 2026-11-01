# CloudRoute Product Documentation

Read these documents before implementing a milestone.

| Order | Document | Authority |
|---:|---|---|
| 1 | [Product Requirements](PRODUCT-REQUIREMENTS.md) | What CloudRoute is, who it serves, MVP scope and exclusions |
| 2 | [Technical Requirements](TECHNICAL-REQUIREMENTS.md) | Architecture, interfaces, security, reliability, deployment and tests |
| 3 | [Data Schema](DATA-SCHEMA.md) | Current PostgreSQL tables, columns, constraints, relationships, RLS and lifecycle |
| 4 | [Design Brief](DESIGN-BRIEF.md) | Navigation, page behavior, visual direction, language and accessibility |
| 5 | [Implementation Plan](IMPLEMENTATION-PLAN.md) | Milestones, acceptance tests, validation gates and delivery order |

## Authority and change control

- PRD is authoritative for product scope and user-visible behavior.
- TRD is authoritative for technical behavior and architecture.
- SQL migrations are the executable database source of truth; DATA-SCHEMA describes them.
- Design Brief is authoritative for interface and interaction behavior.
- Implementation Plan is authoritative for delivery sequence and acceptance evidence.
- Existing code does not silently override an explicit requirement. If code and documents conflict, record a change proposal and reconcile before adding more behavior.
- No cloud write/control capability is allowed in the MVP.
- A feature is not release-accepted until evidence is recorded.

## Standard terminology

Use CR-Mxx for milestones, CR-AT for acceptance tests, CR-VALxx for external validation gates, CR-ADR for architecture decisions, and CR-RISK for tracked risks. New branches and PR titles follow the implementation plan.
