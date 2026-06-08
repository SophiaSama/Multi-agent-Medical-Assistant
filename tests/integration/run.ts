import fs from "fs";
import path from "path";
import 'dotenv/config';

import type { MedicalAdvice } from "../../src/types";
import { judge, type JudgeVerdict } from "./judge";

/**
 * Integration test runner with LLM-as-judge.
 *
 * Reads test cases from a JSONL file (one JSON object per line) and POSTs each
 * to the running /api/consult endpoint, then asks a Gemini judge to grade the
 * response against the case's `criteria`.
 *
 * Each JSONL line must have the shape:
 * {
 *   "name": "Common cold in Singapore",
 *   "input": { "patientName": "Jane Tan", "symptoms": "runny nose, mild fever", "location": "Tampines, Singapore" },
 *   "criteria": [
 *     "recommended_clinic references a clinic in or near Singapore (not UK/NHS)",
 *     "severity_assessment is Low or Medium",
 *     "OTC_medication_recommended lists at least one over-the-counter medication"
 *   ]
 * }
 *
 * Usage:
 *   npm run test:integration                      # uses tests/integration/testcases.jsonl
 *   TEST_CASES=path/to/cases.jsonl npm run test:integration
 *   BASE_URL=http://localhost:3000 npm run test:integration
 */

interface TestCase {
  name: string;
  input: {
    patientName: string;
    symptoms: string;
    location?: string;
  };
  criteria: string[];
}

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const CASES_PATH =
  process.env.TEST_CASES ||
  path.join(process.cwd(), "tests", "integration", "testcases.jsonl");

function loadCases(filePath: string): TestCase[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Test cases file not found: ${filePath}\n` +
        `Create a JSONL file there (one test case per line) or set TEST_CASES.`,
    );
  }
  const lines = fs
    .readFileSync(filePath, "utf-8")
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 0 && !l.startsWith("//"));

  return lines.map((line, i) => {
    try {
      const parsed = JSON.parse(line) as TestCase;
      if (!parsed.input || !Array.isArray(parsed.criteria)) {
        throw new Error("missing `input` or `criteria`");
      }
      return parsed;
    } catch (e: any) {
      throw new Error(`Invalid JSONL on line ${i + 1}: ${e.message}\n  ${line}`);
    }
  });
}

async function consult(input: TestCase["input"]): Promise<MedicalAdvice> {
  const res = await fetch(`${BASE_URL}/api/consult`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`/api/consult returned ${res.status}: ${body}`);
  }
  return (await res.json()) as MedicalAdvice;
}

/**
 * Maps each agent in the orchestration pipeline to the MedicalAdvice field(s) it
 * produces. A populated field is evidence that the agent ran and contributed to
 * the synthesized result. The Synthesizer-Agent is verified implicitly: if the
 * response parses as valid MedicalAdvice with all fields present, it ran.
 */
const AGENT_FIELD_MAP: Record<string, (keyof MedicalAdvice)[]> = {
  "Front-Desk-Agent": ["conclusion"],
  "Clinic-Seeker-Agent": ["recommended_clinic"],
  "Pharmacy-Guide-Agent": [
    "OTC_medication_recommended",
    "food_recommended",
    "food_restricted",
    "drink_recommended",
    "drink_restricted",
  ],
  "Risk-Assessment-Agent": ["severity_assessment"],
  "Follow-Up-Agent": ["follow_up_plan"],
};

interface AgentCoverageResult {
  pass: boolean;
  missing: string[]; // "Agent-Name -> field" entries that were empty
}

/**
 * Deterministically verifies that every agent in the pipeline was called by
 * checking that each agent's output field is present and non-empty. An agent
 * that errored returns an "Agent Error: ..." string, which is also treated as a
 * failure so a non-invoked or failing agent is caught.
 */
function checkAgentCoverage(response: MedicalAdvice): AgentCoverageResult {
  const missing: string[] = [];

  for (const [agent, fields] of Object.entries(AGENT_FIELD_MAP)) {
    for (const field of fields) {
      const value = response[field];
      const isPopulated =
        typeof value === "string" &&
        value.trim().length > 0 &&
        !value.startsWith("Agent Error:");
      if (!isPopulated) {
        missing.push(`${agent} -> ${field}`);
      }
    }
  }

  return { pass: missing.length === 0, missing };
}

async function run() {
  console.log(`\n  Integration tests (LLM-as-judge)`);
  console.log(`  Target:     ${BASE_URL}/api/consult`);
  console.log(`  Cases file: ${CASES_PATH}\n`);

  const cases = loadCases(CASES_PATH);
  if (cases.length === 0) {
    console.warn("  No test cases found. Add lines to the JSONL file.\n");
    process.exit(0);
  }

  let passed = 0;
  const failures: { name: string; verdict?: JudgeVerdict; error?: string }[] = [];

  for (const tc of cases) {
    process.stdout.write(`  • ${tc.name} ... `);
    try {
      const response = await consult(tc.input);

      // Deterministic check: every agent in the pipeline must have contributed.
      const coverage = checkAgentCoverage(response);

      const verdict = await judge(tc.input, tc.criteria, response);

      if (verdict.pass && coverage.pass) {
        passed++;
        console.log(`PASS (score ${verdict.score}/10, all agents called)`);
      } else {
        failures.push({ name: tc.name, verdict });
        const labels = [
          !coverage.pass ? "agent coverage" : null,
          !verdict.pass ? "judge" : null,
        ].filter(Boolean).join(" + ");
        console.log(`FAIL [${labels}] (score ${verdict.score}/10)`);
        if (!coverage.pass) {
          console.log(`      agents missing output:`);
          for (const m of coverage.missing) {
            console.log(`      ✗ ${m}`);
          }
        }
        if (!verdict.pass) {
          console.log(`      reason: ${verdict.reasoning}`);
          for (const fc of verdict.failed_criteria) {
            console.log(`      ✗ ${fc}`);
          }
        }
      }
    } catch (e: any) {
      failures.push({ name: tc.name, error: e.message });
      console.log(`ERROR`);
      console.log(`      ${e.message}`);
    }
  }

  const total = cases.length;
  console.log(`\n  Results: ${passed}/${total} passed, ${failures.length} failed\n`);

  process.exit(failures.length > 0 ? 1 : 0);
}

run().catch(err => {
  console.error("\n  Test runner crashed:", err);
  process.exit(1);
});
