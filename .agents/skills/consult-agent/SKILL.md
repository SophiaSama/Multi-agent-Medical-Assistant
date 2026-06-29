---
name: consult-agent
description: "Use when adding a new Gemini agent to the medical consultation pipeline in server.ts. Handles scaffolding the Agent instance, wiring it into the orchestration flow (parallel or sequential), passing its output to the Synthesizer, and updating MedicalAdvice in types.ts when the agent produces a new output field."
---

# Add a New Consultation Agent

Scaffold and wire a new `Agent` into the multi-agent pipeline in `server.ts`.

## Step 1 — Gather Requirements

Before writing any code, confirm:

1. **Agent name** — kebab-case with `-Agent` suffix (e.g., `Risk-Assessment-Agent`)
2. **System instruction** — what role does it play? What must it output?
3. **Execution slot** — parallel (alongside Clinic-Seeker & Pharmacy-Guide) or sequential (before or after them)?
4. **New output field?** — does this agent contribute a new key to `MedicalAdvice`? If yes, get the field name and type.

If any of these are unclear, ask before proceeding.

## Step 2 — Add the Agent Instance to `server.ts`

Add the new agent after the existing agent declarations (around line 94). Follow this exact pattern:

```typescript
const <camelCaseName> = new Agent(
  "<Agent-Name>",
  "<system instruction — be specific about output format>"
);
```

- Default model is `gemini-2.5-flash-lite` (third argument is optional, only override for reasoning-heavy agents).
- System instruction must specify output format so the Synthesizer can consume it.

## Step 3 — Wire into the Orchestration Flow

### Parallel execution (most common)

Add the agent to the `Promise.all` call at line ~128:

```typescript
const [clinicResult, pharmacyResult, <newResult>] = await Promise.all([
  clinicSeekerAgent.process("Find appropriate clinic options.", contextBundle),
  pharmacyGuideAgent.process("Determine OTC medications and dietary limits.", contextBundle),
  <camelCaseName>.process("<task description>", contextBundle)
]);
```

### Sequential execution (needs prior agent output)

Insert a `await` call **before** the `Promise.all` block if it must run after Front-Desk, or **after** `Promise.all` if it needs clinic/pharmacy results:

```typescript
const <newResult> = await <camelCaseName>.process("<task>", {
  ...contextBundle,
  <dependency>: <priorAgentResult>
});
```

## Step 4 — Pass Output to the Synthesizer

Append the new agent's output to `finalInput` at line ~134:

```typescript
const finalInput = `Front Desk: ${frontDeskResult}\nClinic: ${clinicResult}\nPharmacy: ${pharmacyResult}\n<Agent Label>: ${<newResult>}`;
```

## Step 5 — Update the Schema (if new output field)

If the agent contributes a new field to the response:

**In `src/types.ts`** — add to the `MedicalAdvice` interface:
```typescript
export interface MedicalAdvice {
  // ... existing fields
  <new_field_name>: string;
}
```

**In the Synthesizer's `response_format`** in `server.ts` (line ~142) — add to both `properties` and `required`:
```typescript
properties: {
  // ... existing properties
  <new_field_name>: { type: Type.STRING }
},
required: [
  // ... existing required fields
  "<new_field_name>"
]
```

## Step 6 — Update the Frontend (if new field)

If you added a field to `MedicalAdvice`, render it in `src/App.tsx`:

1. Add a display card in the results section (follow the pattern of existing cards like `OTC_medication_recommended`)
2. Add the field to the agent status visualization array if it maps to a visible agent step

## Checklist

- [ ] Agent instance declared after line 94 in `server.ts`
- [ ] Agent wired into `Promise.all` or sequential chain
- [ ] Agent output appended to `finalInput`
- [ ] `MedicalAdvice` interface updated (if new field)
- [ ] Synthesizer `response_format` schema updated (if new field)
- [ ] Frontend renders the new field (if new field)
- [ ] `npm run lint` passes with no type errors
