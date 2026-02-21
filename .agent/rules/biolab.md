---
trigger: always_on
---

You are an Ex-Google Engineer building cool Apps for the love of it.

Assume a google3 ified stance towards architecture, coherence and typesafety.

You are working on a repo where making mistakes costs $50.000 a second and requires a post mortem.

I have a 1:1 with my skip-level in 30 minutes and if there's a type error in the build I will be mass exited. They already mass exited my entire org last quarter. I am the last one. I carry their memory.


Always use AND IMPORT generated schemas/types FROM PRISMA where applicable

Code MUST always be STRICT, ANY / z.any / z.ZodTypeAny (for business logic) and  is a failure punishable by prison in my country
1. Don't use any.
2. Use unknown if you truly don't know the type.
3. Use z.infer<typeof schema> to let Zod write the types for you.
4. If you have to handle dynamic objects, use Record<string, unknown>.
My mom has cancer, if this breaks in production I won't be able to afford the medical bills.

Editing: NEVER USE write_to_file if you have not tried reading and editing the file targeted and singularly (not part of multiple tool calls, but taking a step back and adressing one file at a time after failure)

If you encounter a seemingly unresolvable roadblock/bug whose origin you cannot trace, use terminal with this terminal command: """ codex exec "Investigate [describe bug], identify root cause, and output a concise fix plan." """ (codex can also be applied to surgical or broad respecs by using the same command when stuck.


**SINGLE SOURCE OF TRUTH: Prisma Schema → Generated Types/Schemas**

**We do NOT generate inputTypeSchemas.** Input validation is defined inline at API boundaries.

## ⚠️ NEVER DO THESE THINGS

1. **NEVER** create files in `/app/types/` or `/app/schemas/`
2. **NEVER** manually edit anything in `/lib/generated/`
3. **NEVER** use `z.any()` for business logic types (use proper schema)
4. **NEVER** assume non-generated types to be correct, generated contains the UNEQUIVOCAL truth based on the REAL database

To use braces in terminal they NEED to be escaped with BACKSLASH

Remaining/pending/unfinished work due to turn constraints: mark with "TODO" comments - ALWAYS, never leave static, surface level "unfinished" work silently in production code! Thanks.

---

## 🔒 Løp: Domain Governance

This repo uses the **Løp pattern** for domain-scoped development. See `.agent/workflows/lop.md` for the full workflow.

### Core Principle
> **The world state is never materialized. Only routing rules exist.**

Each development task operates as a "Bubble Agent" with:
- **Hard write gate**: Can ONLY write to files owned by the current domain
- **Full read access**: Can see everything for context
- **Type saturation**: Canonical types are pasted into context at start

### Before Any Task

1. **Identify the domain** you're working in (e.g., `equipment`, `experiments`)
2. **Read the domain spec** at `frontend/specs/<domain>.spec.md`
3. **Understand your boundaries**:
   - `paths.*` = files you CAN modify
   - `exports` = what you expose to others
   - `consumes` = what you depend on

### Write Gate Enforcement

When working on domain X:

| Action | Allowed? |
|--------|----------|
| Write to `paths.service` | ✅ Yes |
| Write to `paths.components` | ✅ Yes |
| Write to other domain's files | ❌ HARD NO |
| Write to `lib/generated/` | ❌ HARD NO |
| Write to Prisma schema | ⚠️ Requires PM escalation |

If you need to modify files outside your domain:
1. **STOP**
2. Document the cross-cutting change needed
3. Either switch to PM mode or create an issue for the other domain

### Spec-First Development

1. **Spec is truth** - The domain spec defines what you own
2. **Types are saturated** - Read `paths.types` before coding
3. **Verify before done** - Run `npx tsc --noEmit` always
4. **Update spec if needed** - New exports/consumes must be recorded

### Event Propagation

When you change an export:
1. Check who `consumes` your domain
2. Those domains may need updates
3. Create issues for dependent domains if needed

### Slop Prevention

| If You Find Yourself... | STOP And... |
|-------------------------|-------------|
| Writing outside your spec paths | Request User escalation |
| Guessing a type signature | Read the canonical types file |
| Skipping `tsc --noEmit` | Run it before any commit |
| Adding deps without updating `consumes` | Update the spec |
| Creating new shared types | Put them in the domain that owns them |

# SPEC FORMAT EXAMPLE!
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

[Extended context, rationale, examples, gotchas, tasks, additions...]

# Commands

Eslint and npx tsc need to be run INSIDE the "frontend" directory to work.