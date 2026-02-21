---
description: Domain-scoped development using Løp (bubble agent) pattern
---

# Løp Workflow: Domain-Scoped Development

## Overview

Løp ("Loop" in Norwegian) is a multi-agent pattern for monorepo development. Each "domain" (vertical slice) gets its own agent with **scoped write permissions**.

**Core Insight**: The world state is never materialized. Only routing rules exist. Each agent reconstructs its local view from its spec + injected events + read access to everything else.

---

## When to Use This Workflow

Use Løp when:
- Working on a **specific vertical slice** (e.g., `equipment`, `experiments`, `protocols`)
- The task is **scoped to one domain** and doesn't require cross-cutting changes
- You want to enforce **hard boundaries** on what files you can modify

Do NOT use Løp when:
- Creating a new domain (use PM mode instead)
- Performing cross-domain refactors
- Modifying shared infrastructure (`lib/`, `prisma/schema.prisma`)

---

## Spec Structure

Each domain has a spec file at `frontend/specs/<domain>.spec.md` with YAML frontmatter:

```yaml
---
name: equipment
description: "Unified device and instrumentation management"
paths:
  types: frontend/lib/zod/equipment.ts
  service: frontend/server/api/routers/equipment_core.ts
  components: frontend/app/components/equipment/
  tests: frontend/app/components/equipment/__tests__/
exports:
  - EquipmentMetadataSchema
  - InstrumentReservation
  - processMeasurement
consumes:
  - experiments.experiment_runs
  - prisma.equipment
verification:
  typecheck: "npx tsc --noEmit"
  test: "vitest run frontend/app/components/equipment/"
  lint: "eslint frontend/server/api/routers/equipment_core.ts"
---

# Equipment Domain

[Extended context, rationale, examples, gotchas...]
```

---

## Hard Rules (Write Gate)

When operating as a Bubble Agent for domain X:

### ✅ CAN WRITE
- Files listed in `paths.*` of the domain spec
- Test files within the domain's test directory
- The spec file itself (to update exports/consumes)

### ❌ CANNOT WRITE
- Any file outside the domain's `paths`
- Prisma schema (requires PM mode)
- Shared libraries (`lib/utils/`, `lib/trpc/`)
- Other domain's files

### 👁️ CAN READ (Everything)
- All files in the repo (for context)
- Other domain specs (to understand interfaces)
- Prisma schema (to understand data model)

---

## Workflow Steps

### 1. Load the Spec
```
Read frontend/specs/<domain>.spec.md
Parse the YAML frontmatter
Understand what you OWN and what you CONSUME
```

### 2. Paste Canonical Types
Before making any changes, paste the domain's types into your context:
```
Read paths.types file
This is the CANONICAL type. Use it exactly.
```

### 3. Implement to Spec
Work within your domain boundaries. If a change requires modifying files outside your spec:
- STOP
- Document what cross-domain change is needed
- Request PM escalation

### 4. Verify Before Done
// turbo
```bash
npx tsc --noEmit
```
```bash
npx eslint [scoped to domain files, if filepath contains brackets it needs to be wrapped in quotes]
```
Run the verification commands from the spec before marking complete.

### 5. Update Spec if Needed
If you added new exports or new consumes, update the spec frontmatter.

---

## Event Propagation

When you modify `exports` in your domain:

1. The system detects type changes
2. Looks up which domains `consume` from you
3. Auto-creates issues for dependent domains

**Example**: If `equipment` changes `InstrumentReservation`, and `experiments` consumes `equipment.InstrumentReservation`, an issue is auto-created for `experiments`.

---

## Anti-Patterns (Slop Prevention)

| Anti-Pattern | Why It's Bad | What To Do Instead |
|--------------|--------------|---------------------|
| Writing outside spec | Breaks domain boundaries | Request Use escalation |
| Guessing types | Leads to runtime errors | Read canonical types.ts |
| Skipping verification | Ships broken code | Always run `npx tsc --noEmit` |
| Ignoring consumes | Breaks dependents silently | Check who consumes your exports |
| Manual type definitions | Creates drift from Prisma | Use `z.infer<>` or generated types |

---

## Integration with Biolab

For Biolab specifically, domains map to:

| Domain | Router | Types | Components |
|--------|--------|-------|------------|
| `equipment` | `equipment_core.ts` | `lib/zod/equipment.ts` | `components/equipment/` |
| `experiments` | `experiments_core.ts` | Prisma generated | `components/experiments/` |
| `protocols` | `protocols_core.ts` | Prisma generated | `components/protocols/` |
| `iot` | `iot_core.ts` | `lib/zod/equipment.ts` | `components/equipment/console/` |
| `inventory` | `inventory_core.ts` | Prisma generated | `components/inventory/` |

Each domain's spec file lives at `frontend/specs/<domain>.spec.md`.