import fs from "fs";
import path from "path";
import type { MedicalAdvice } from "../../src/types";

export interface TestCaseFixture {
  id: string;
  name: string;
  input: {
    name?: string;
    patientName: string;
    symptoms: string;
    location?: string;
  };
  criteria: string[];
  response: MedicalAdvice;
}

const FIXTURES_DIR = path.join(process.cwd(), "tests", "poc", "fixtures");
const FIXTURES_FILE = path.join(FIXTURES_DIR, "responses.json");

/**
 * Validates that a response satisfies all MedicalAdvice fields
 */
export function validateResponseFields(resp: MedicalAdvice): boolean {
  const fields: (keyof MedicalAdvice)[] = [
    "conclusion",
    "OTC_medication_recommended",
    "food_recommended",
    "food_restricted",
    "drink_recommended",
    "drink_restricted",
    "recommended_clinic",
    "severity_assessment",
    "follow_up_plan",
  ];
  return fields.every(
    f => typeof resp[f] === "string" && resp[f].trim().length > 0 && !resp[f].startsWith("Agent Error:")
  );
}

export function loadFixtures(): TestCaseFixture[] {
  if (!fs.existsSync(FIXTURES_FILE)) {
    throw new Error(`Fixtures file not found at: ${FIXTURES_FILE}`);
  }
  const raw = fs.readFileSync(FIXTURES_FILE, "utf-8");
  const data = JSON.parse(raw) as TestCaseFixture[];
  for (const item of data) {
    if (!validateResponseFields(item.response)) {
      throw new Error(`Fixture ${item.id} (${item.name}) contains invalid response fields.`);
    }
  }
  return data;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("Loading and validating frozen fixtures from:", FIXTURES_FILE);
  const fixtures = loadFixtures();
  console.log(`Successfully verified ${fixtures.length} fixtures:`);
  for (const f of fixtures) {
    console.log(`  - [${f.id}] "${f.name}" (${f.criteria.length} criteria)`);
  }
}
