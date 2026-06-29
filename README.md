# HealthAgent AI — Multi-Agent Medical Assistant

A medical consultation web app that orchestrates **six Google Gemini agents** to register a patient, find nearby clinics, recommend OTC medication and diet, assess risk, and produce a follow-up care plan — then synthesizes everything into a single structured result and persists it for patient history.

> ⚠️ **Disclaimer:** This is a demo application for educational purposes. It does **not** provide professional medical advice. Always consult a qualified healthcare provider.

## Demo
![assessment](assets\assessment.png)

![map](assets\clinics.png)

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 6, Tailwind CSS v4, `motion`, `lucide-react` |
| Maps | `@vis.gl/react-google-maps` (Google Places autocomplete) |
| Backend | Express 4 (served via Vite middleware in dev, bundled to CJS by esbuild for prod) |
| AI | `@google/genai` → `gemini-2.5-flash-lite` |
| Auth & DB | Supabase (email/password auth + `medical_records` table) |
| Runtime | Node.js, `tsx` (dev watch), `undici` (corporate-proxy CA trust) |

## Architecture

The backend (`server.ts`) defines a lightweight `Agent` class wrapping the Gemini Interactions API. A consultation (`POST /api/consult`) runs:

1. **Front-Desk-Agent** — registers the patient and summarizes symptoms, enriched with prior history from Supabase. *(sequential)*
2. **Clinic-Seeker**, **Pharmacy-Guide**, and **Risk-Assessment** agents — run **in parallel**.
3. **Follow-Up-Agent** — builds a care plan from the parallel results. *(sequential)*
4. **Synthesizer-Agent** — merges all outputs into validated `MedicalAdvice` JSON (enforced via Gemini's typed `response_format`), which is returned to the UI and saved to Supabase.

## Prerequisites

- Node.js 18+ (developed on Node 26)
- A [Gemini API key](https://ai.google.dev/)
- A [Google Maps Platform key](https://developers.google.com/maps) with Places enabled
- A [Supabase](https://supabase.com/) project (for auth + history)

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment** — copy `.env.example` to `.env` and fill in values:

   ```bash
   # Backend (read by the server via dotenv)
   GEMINI_API_KEY=...
   GOOGLE_MAPS_PLATFORM_KEY=...
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_SECRET_API_KEY=...        # server key for medical_records (bypasses RLS)

   # Frontend (VITE_ prefix exposes these to the browser bundle)
   VITE_SUPABASE_URL=https://<project>.supabase.co
   VITE_SUPABASE_ANON_KEY=...         # public anon key only — never the secret key

   # Optional: only if behind a TLS-intercepting corporate proxy
   EXTRA_CA_CERTS=
   ```

3. **Apply the database schema** — run the SQL in `supabase/migrations/` against your Supabase project (SQL editor or CLI) to create the `medical_records` table.

4. **Run the app**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000, sign up / sign in, and start a consultation.

## Scripts

```bash
npm run dev       # Dev server (port 3000, tsx watch → Vite HMR + Express)
npm run build     # Build frontend (Vite) + backend (esbuild) → dist/
npm start         # Run the production build: node dist/server.cjs
npm run lint      # TypeScript type-check (no emit)
npm run clean     # Remove dist/
```

## Environment variables

| Variable | Scope | Required | Purpose |
|----------|-------|----------|---------|
| `GEMINI_API_KEY` | Backend | Yes | Gemini API access |
| `GOOGLE_MAPS_PLATFORM_KEY` | Backend | Yes | Google Places autocomplete |
| `SUPABASE_URL` | Backend | Yes | Server Supabase project URL |
| `SUPABASE_SECRET_API_KEY` | Backend | Yes* | Read/write `medical_records` (bypasses RLS). `SUPABASE_SERVICE_ROLE_KEY` accepted as fallback |
| `VITE_SUPABASE_URL` | Frontend | Yes | Supabase URL for the browser auth client |
| `VITE_SUPABASE_ANON_KEY` | Frontend | Yes | Public anon key for auth |
| `EXTRA_CA_CERTS` | Backend | No | Path to a PEM CA bundle; see below |

\*Without Supabase configured, the app still runs but skips patient-history read/write.

> 🔒 Never put `SUPABASE_SECRET_API_KEY` / `SUPABASE_SERVICE_ROLE_KEY` in a `VITE_` variable or client code — it bypasses Row Level Security.

## Behind a corporate proxy (TLS interception)

If outbound HTTPS calls fail with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, your network proxy presents a root CA that Node doesn't trust. Export your OS trust store to a PEM bundle and point `EXTRA_CA_CERTS` at it. The server applies it to Node's global `fetch` (undici) at startup.

Export the Windows trust store (PowerShell):

```powershell
$out = "$env:USERPROFILE\corp-ca\win-ca-bundle.pem"
New-Item -ItemType Directory -Force -Path (Split-Path $out) | Out-Null
$certs = Get-ChildItem Cert:\LocalMachine\Root, Cert:\CurrentUser\Root, Cert:\LocalMachine\CA, Cert:\CurrentUser\CA
$sb = New-Object System.Text.StringBuilder
foreach ($c in $certs) {
  [void]$sb.AppendLine("-----BEGIN CERTIFICATE-----")
  [void]$sb.AppendLine([Convert]::ToBase64String($c.RawData, 'InsertLineBreaks'))
  [void]$sb.AppendLine("-----END CERTIFICATE-----")
}
Set-Content -Path $out -Value $sb.ToString() -Encoding ascii
```

Then set `EXTRA_CA_CERTS` to that path in `.env`. (`.env` is the right place because the server reads it at runtime — Node's built-in `NODE_EXTRA_CA_CERTS` cannot be set via `.env`.)

## Project structure

```
server.ts                 # Backend: TLS/CA setup, agents, Express routes, Supabase persistence
src/
  App.tsx                 # Main UI: auth gating, form, agent status, results
  Auth.tsx                # Supabase email/password auth UI
  types.ts                # Shared types (MedicalAdvice, PatientRecord)
  lib/supabaseClient.ts   # Browser Supabase client (anon key)
  index.css               # Tailwind v4 config + styles
supabase/migrations/      # DB schema (medical_records)
```
