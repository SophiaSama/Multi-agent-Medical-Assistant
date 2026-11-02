#!/usr/bin/env node
// Fails the build if a server-only secret ended up in the client bundle.
//
// The VITE_ prefix is an accident guard, not a security boundary: `define`,
// a widened `envPrefix`, or a secret named VITE_* all bypass it. This check
// inspects the actual build output instead, so it catches leaks regardless
// of how they got there.
//
// Two checks over every client file in dist/ (the server bundle is skipped):
//   1. Value match — the literal value of each SECRET_VARS entry present in the
//      build environment must not appear in the output.
//   2. Pattern match — known secret formats that should never be client-side
//      (Supabase secret keys, Supabase service_role JWTs), even if the env var
//      isn't set in this environment.
//
// Only variable names, pattern names, and file paths are reported — never values.
//
// Usage: npm run build && npm run check:bundle   (optional arg: output dir)

import fs from "node:fs";
import path from "node:path";

const DIST = path.resolve(process.argv[2] || "dist");

// Server-only secrets. Public-by-design keys (VITE_SUPABASE_ANON_KEY,
// GOOGLE_MAPS_PLATFORM_KEY) are intentionally absent.
const SECRET_VARS = [
  "GEMINI_API_KEY",
  "SUPABASE_SECRET_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

// Values shorter than this are placeholders/empty and would false-positive.
const MIN_SECRET_LENGTH = 16;

// Files emitted for the Node server, not shipped to browsers.
const SERVER_FILES = /^server\.cjs(\.map)?$/;

const JWT = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

function isServiceRoleJwt(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

const PATTERNS = [
  { name: "Supabase secret key (sb_secret_*)", test: text => /sb_secret_[A-Za-z0-9_-]{10,}/.test(text) },
  { name: "Supabase service_role JWT", test: text => (text.match(JWT) || []).some(isServiceRoleJwt) },
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (dir === DIST && SERVER_FILES.test(entry.name)) return [];
    return [full];
  });
}

if (!fs.existsSync(DIST)) {
  console.error(`[check-bundle] Output directory not found: ${DIST}. Run the build first.`);
  process.exit(2);
}

const secrets = SECRET_VARS
  .map(name => ({ name, value: process.env[name]?.trim() }))
  .filter(s => s.value && s.value.length >= MIN_SECRET_LENGTH);

const files = walk(DIST);
const findings = [];

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const rel = path.relative(process.cwd(), file);
  for (const { name, value } of secrets) {
    if (text.includes(value)) findings.push(`${rel}: value of $${name}`);
  }
  for (const { name, test } of PATTERNS) {
    if (test(text)) findings.push(`${rel}: ${name}`);
  }
}

const checkedVars = secrets.map(s => s.name).join(", ") || "none set in this environment";
console.log(`[check-bundle] Scanned ${files.length} client file(s) in ${path.relative(process.cwd(), DIST) || "."}`);
console.log(`[check-bundle] Value checks: ${checkedVars}`);

if (findings.length > 0) {
  console.error(`\n[check-bundle] FAIL — server-only secrets found in the client bundle:`);
  for (const f of findings) console.error(`  ✗ ${f}`);
  console.error(`\nTreat these credentials as compromised: rotate them, then find how they got in`);
  console.error(`(a vite.config define block, a VITE_-prefixed secret, or a widened envPrefix).`);
  process.exit(1);
}

console.log(`[check-bundle] PASS — no server-only secrets found.`);
