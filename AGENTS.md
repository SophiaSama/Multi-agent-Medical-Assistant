# HealthAgent AI — Agent Instructions

Multi-agent medical consultation app: React 19 + Vite frontend, Express.js backend, Google Gemini multi-agent orchestration, Supabase auth + persistence, Google Maps Places autocomplete.

## Commands

```bash
npm run dev       # Dev server (port 3000, tsx watch → Vite HMR + Express middleware)
npm run build     # Vite frontend + esbuild backend → dist/
npm start         # Production: node dist/server.cjs
npm run lint      # TypeScript type-check (no emit)
npm run clean     # Remove dist/
```

## Architecture

All six AI agents live in `server.ts` as instances of a lightweight `Agent` class (a thin ADK-style wrapper over the `@google/genai` Interactions API). They run against `gemini-2.5-flash-lite`.

| Agent | Role |
|-------|------|
| Front-Desk-Agent | Registers patient, summarizes symptoms with prior-history context |
| Clinic-Seeker-Agent | Finds open clinics near the patient's location using Gemini Google Search grounding |
| Pharmacy-Guide-Agent | Recommends OTC meds + allowed/restricted food & drink |
| Risk-Assessment-Agent | Rates severity Low/Medium/High with a one-line justification |
| Follow-Up-Agent | Produces a post-consultation care plan |
| Synthesizer-Agent | Merges all outputs → validated `MedicalAdvice` JSON |

**Orchestration flow** (`POST /api/consult`):
1. Front-Desk runs first (sequential), enriched with prior history read from Supabase.
2. Clinic-Seeker (`runGroundedClinicSearch` — uses Gemini Google Search grounding), Pharmacy-Guide, and Risk-Assessment run **in parallel** (`Promise.all`).
3. Follow-Up runs next, consuming the parallel results.
4. Synthesizer merges everything via Gemini's `response_format: Type.OBJECT` to enforce the `MedicalAdvice` schema; the result is returned and saved to Supabase.

**Critical contract:** `src/types.ts` defines `MedicalAdvice` — the Synthesizer's JSON schema, the `medical_records` table columns, and this interface must all stay in sync.

## TLS / corporate proxy

Node's global `fetch` (undici) may not trust a corporate TLS-intercepting proxy's root CA, causing `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` on HTTPS calls (e.g. to Supabase). At startup `server.ts` reads `EXTRA_CA_CERTS` (falling back to `NODE_EXTRA_CA_CERTS`) and, if set, applies the PEM bundle to every outbound request via `setGlobalDispatcher(new Agent({ connect: { ca } }))` from `undici`. This is applied in code, so it is independent of which terminal launched the process.

## Key Files

- `server.ts` — All backend logic: TLS/CA setup, `Agent` class, the six agents, Express routes, Supabase persistence
- `src/App.tsx` — Main frontend: auth gating, consultation form, agent status visualization, results display
- `src/Auth.tsx` — Supabase email/password sign-in & sign-up UI
- `src/lib/supabaseClient.ts` — Browser Supabase client (anon key only, RLS-safe)
- `src/types.ts` — Shared types (`MedicalAdvice`, `PatientRecord`)
- `supabase/migrations/` — DB schema (table: `medical_records`)
- `.env.example` — Documented environment variables

## Environment Variables

**Backend (server, read via `dotenv`):**

| Variable | Required | Purpose |
|----------|----------|---------|
| `GEMINI_API_KEY` | Yes | Gemini API access |
| `GOOGLE_MAPS_PLATFORM_KEY` | Yes | Google Places Autocomplete (frontend map widget only) |
| `SUPABASE_URL` | Yes | Server Supabase project URL |
| `SUPABASE_SECRET_API_KEY` | Yes* | Server key for `medical_records` read/write (bypasses RLS); `SUPABASE_SERVICE_ROLE_KEY` is accepted as a fallback |
| `EXTRA_CA_CERTS` | No | Path to a PEM CA bundle; set only behind a TLS-intercepting proxy |

*The backend Supabase client is lazy-initialized — without `SUPABASE_URL` + a key, the app still runs but skips patient history read/write.

**Frontend (browser, must use the `VITE_` prefix to be exposed):**

| Variable | Required | Purpose |
|----------|----------|---------|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL for the browser auth client |
| `VITE_SUPABASE_ANON_KEY` | Yes | Public anon key for auth (never the service/secret key) |

## Conventions

- **TypeScript path alias**: `@/*` resolves to the project root
- **Module system**: ES modules (`"type": "module"` in package.json); the backend is bundled to CJS by esbuild for Node.js compatibility
- **Styling**: Tailwind CSS v4 via Vite plugin — no `tailwind.config.js`, configure in `src/index.css`
- **Auth**: Supabase email/password; `App.tsx` gates the UI on `supabase.auth.onAuthStateChange` and renders `Auth.tsx` when signed out
- **Client-side history**: stored in `localStorage` key `patientsHistory` (JSON array of `PatientRecord`)
- **Server history**: queried from Supabase `medical_records` by `patient_name` before each consultation, then the new result is inserted
- **Never** expose `SUPABASE_SECRET_API_KEY` / `SUPABASE_SERVICE_ROLE_KEY` to the client or a `VITE_` variable — it bypasses RLS

## Stack

React 19 · Vite 6 · Express 4 · `@google/genai` · `@supabase/supabase-js` · `@vis.gl/react-google-maps` · Tailwind CSS v4 · `motion` · `lucide-react` · `undici` (CA dispatcher) · `tsx` (dev) · `esbuild` (backend build)
