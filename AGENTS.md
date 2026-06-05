# HealthAgent AI — Agent Instructions

Multi-agent medical consultation app: React 19 + Vite frontend, Express.js backend, Google Gemini multi-agent orchestration, optional Supabase persistence.

## Commands

```bash
npm run dev       # Dev server (port 3000, Vite HMR + Express)
npm run build     # Vite frontend + esbuild backend → dist/
npm start         # Production: node dist/server.cjs
npm run lint      # TypeScript type-check (no emit)
npm run clean     # Remove dist/
```

## Architecture

All four AI agents live in `server.ts`. They run against `gemini-2.5-flash` via `@google/genai`.

| Agent | Role |
|-------|------|
| Front-Desk-Agent | Registers patient, summarizes symptoms with history context |
| Clinic-Seeker-Agent | Finds region-appropriate hospitals/clinics |
| Pharmacy-Guide-Agent | Recommends OTC meds + food/drink guidance |
| Synthesizer-Agent | Merges all outputs → validated `MedicalAdvice` JSON |

Clinic-Seeker and Pharmacy-Guide run **in parallel** (`Promise.all`). The Synthesizer uses Gemini's `response_format: Type.OBJECT` to enforce the `MedicalAdvice` schema.

**Critical contract:** `src/types.ts` defines `MedicalAdvice` — the Synthesizer's JSON schema must stay in sync with this interface.

## Key Files

- `server.ts` — All backend logic: agents, Express routes, Supabase persistence
- `src/App.tsx` — Full frontend: form, agent status visualization, results display
- `src/types.ts` — Shared types (`MedicalAdvice`, `PatientRecord`)
- `supabase/migrations/` — DB schema (table: `medical_records`)
- `.env.example` — All required environment variables

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `GEMINI_API_KEY` | Yes | Gemini API access |
| `GOOGLE_MAPS_PLATFORM_KEY` | Yes | Google Places Autocomplete |
| `SUPABASE_URL` | No | Patient history persistence |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Supabase admin access |

Supabase client is lazy-initialized — the app runs without it (no patient history).

## Conventions

- **TypeScript path alias**: `@/*` resolves to the project root
- **Module system**: ES modules (`"type": "module"` in package.json); the backend is bundled to CJS by esbuild for Node.js compatibility
- **Styling**: Tailwind CSS v4 via Vite plugin — no `tailwind.config.js`, configure in `src/index.css`
- **Client-side history**: stored in `localStorage` key `patientsHistory` (JSON array of `PatientRecord`)
- **Server history**: queried from Supabase `medical_records` by `patient_name` before each consultation
