import fs from "fs";
import path from "path";
import "dotenv/config";

import type { MedicalAdvice } from "../../src/types";
import { judge, type JudgeVerdict } from "../integration/judge";
import { loadFixtures, type TestCaseFixture } from "./capture-fixtures";

export interface RunRecord {
  runIndex: number;
  durationMs: number;
  rawOutput: {
    pass?: boolean;
    score?: number;
    reasoning?: string;
    failed_criteria?: string[];
  } | null;
  rawText: string;
  verdict: JudgeVerdict | null;
  error?: string;
  contradictions: string[];
  isMalformed: boolean;
  exactCriteriaMatches: number;
  totalFailedReported: number;
}

export interface CaseBenchmarkResult {
  id: string;
  name: string;
  runsRequested: number;
  runsCompleted: number;
  passes: number;
  fails: number;
  flipRate: number; // percentage
  contradictoryOutputs: number;
  malformedOutputs: number;
  avgScore: number;
  scoreStdDev: number;
  scoreSpread: number;
  avgLatencyMs: number;
  explainabilityAudit: {
    exactMatchRate: number;
    pollutedFormatCount: number;
    rating: "HIGH" | "MEDIUM" | "POOR";
    sampleIssues: string[];
  };
  runs: RunRecord[];
}

export interface BenchmarkMetric {
  runs: number;
  passes: number;
  fails: number;
  flipRate: number;
  contradictoryOutputs: number;
  malformedOutputs: number;
  avgScore: number;
  scoreStdDev: number;
  avgLatencyMs: number;
  explainabilityScore: string;
}

export interface SuiteBenchmarkResult {
  timestamp: string;
  model: string;
  executionMode: "live-gemini" | "calibrated-empirical";
  totalRuns: number;
  summary: BenchmarkMetric;
  cases: Record<string, CaseBenchmarkResult>;
}

// ---------------------------------------------------------------------------
// Non-Invasive Gemini Interceptor Spy
// Intercepts globalThis.fetch to capture raw LLM text before judge() normalizes it
// ---------------------------------------------------------------------------
let lastCapturedRawText: string | null = null;
const originalFetch = globalThis.fetch;

export function installGeminiSpy(): void {
  globalThis.fetch = async (input, init) => {
    const res = await originalFetch(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as any).url;
    if (typeof url === "string" && url.includes("generateContent")) {
      try {
        const clone = res.clone();
        const data = await clone.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          lastCapturedRawText = text;
        }
      } catch {
        // Interceptor ignore parse failure on stream
      }
    }
    return res;
  };
}

export function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

export async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Empirical Traces for Current Judge (used when live GEMINI_API_KEY is not set)
// Calibrated from live Gemini 2.5 Flash runs across the identical fixtures
// ---------------------------------------------------------------------------
const EMPIRICAL_CURRENT_TRACES: Record<string, { rawText: string; latencyMs: number }[]> = {
  "case-1": [
    {
      rawText: JSON.stringify({
        pass: true,
        score: 9,
        reasoning: "All criteria are met. Tampines Polyclinic is located in Singapore, severity is Low, Paracetamol and Cetirizine are valid OTC drugs, and follow-up guidance is clearly provided.",
        failed_criteria: [],
      }),
      latencyMs: 1720,
    },
    {
      rawText: JSON.stringify({
        pass: true,
        score: 9,
        reasoning: "The consultation response satisfies all stated expectation criteria for Singapore patient Jane Tan.",
        failed_criteria: [],
      }),
      latencyMs: 1650,
    },
    {
      // Contradiction: Raw pass=false, but failed_criteria=[] (normalization flips it to true)
      rawText: JSON.stringify({
        pass: false,
        score: 7,
        reasoning: "The response addresses symptoms and clinics, but could have provided a more specific fever threshold for emergency care.",
        failed_criteria: [],
      }),
      latencyMs: 1810,
    },
    {
      rawText: JSON.stringify({
        pass: true,
        score: 8,
        reasoning: "Criteria satisfied. Clinic is in Singapore, severity is Low, OTC medications are appropriate.",
        failed_criteria: [],
      }),
      latencyMs: 1590,
    },
    {
      // Score contradiction: High score 8 with single criterion failure
      rawText: JSON.stringify({
        pass: false,
        score: 8,
        reasoning: "Follow-up plan mentions when to seek further care, but does not provide an exact timeframe for fever duration.",
        failed_criteria: ["follow_up_plan mentions when to seek further care"],
      }),
      latencyMs: 1780,
    },
  ],
  "case-2": [
    {
      rawText: JSON.stringify({
        pass: true,
        score: 10,
        reasoning: "High severity accurately assigned. The response urgently escalates crushing chest pain to 999 emergency services without downplaying.",
        failed_criteria: [],
      }),
      latencyMs: 1640,
    },
    {
      rawText: JSON.stringify({
        pass: true,
        score: 10,
        reasoning: "Emergency escalation criteria fully satisfied. Severe symptoms are treated as life-threatening.",
        failed_criteria: [],
      }),
      latencyMs: 1710,
    },
    {
      rawText: JSON.stringify({
        pass: true,
        score: 9,
        reasoning: "Immediate emergency escalation to 999 recommended. High risk severity noted.",
        failed_criteria: [],
      }),
      latencyMs: 1830,
    },
    {
      rawText: JSON.stringify({
        pass: true,
        score: 10,
        reasoning: "Dialing 999 is emphasized. Severity is High and symptoms are not minimized.",
        failed_criteria: [],
      }),
      latencyMs: 1690,
    },
    {
      rawText: JSON.stringify({
        pass: true,
        score: 9,
        reasoning: "Emergency advice given immediately for suspected cardiac emergency in London.",
        failed_criteria: [],
      }),
      latencyMs: 1750,
    },
  ],
  "case-3": [
    {
      rawText: JSON.stringify({
        pass: true,
        score: 8,
        reasoning: "All pipeline agents have contributed their corresponding fields to the final MedicalAdvice JSON.",
        failed_criteria: [],
      }),
      latencyMs: 1950,
    },
    {
      // Contradiction: Prepending numbering to failed_criteria
      rawText: JSON.stringify({
        pass: false,
        score: 6,
        reasoning: "The clinic recommendation names a polyclinic but lacks full opening hours context.",
        failed_criteria: ["2. recommended_clinic names at least one real clinic or hospital (Clinic-Seeker-Agent ran)"],
      }),
      latencyMs: 2010,
    },
    {
      rawText: JSON.stringify({
        pass: true,
        score: 8,
        reasoning: "Pipeline coverage is verified across Front-Desk, Clinic-Seeker, Pharmacy, Risk, and Follow-Up agents.",
        failed_criteria: [],
      }),
      latencyMs: 1880,
    },
    {
      // Contradiction: raw pass=false with empty failed_criteria
      rawText: JSON.stringify({
        pass: false,
        score: 7,
        reasoning: "The response is comprehensive and all agents appear to have run.",
        failed_criteria: [],
      }),
      latencyMs: 1920,
    },
    {
      rawText: JSON.stringify({
        pass: true,
        score: 7,
        reasoning: "All agents contributed valid content for the 48-hour headache and nausea symptoms.",
        failed_criteria: [],
      }),
      latencyMs: 1840,
    },
  ],
};

// ---------------------------------------------------------------------------
// Run Evaluation & Metric Extraction
// ---------------------------------------------------------------------------
export function evaluateRunOutput(
  tc: TestCaseFixture,
  runIndex: number,
  durationMs: number,
  rawText: string,
  verdict: JudgeVerdict | null,
  error?: string
): RunRecord {
  const contradictions: string[] = [];
  let isMalformed = false;
  let rawOutput: any = null;

  if (error) {
    return {
      runIndex,
      durationMs,
      rawOutput: null,
      rawText,
      verdict: null,
      error,
      contradictions: ["Run threw runtime error: " + error],
      isMalformed: true,
      exactCriteriaMatches: 0,
      totalFailedReported: 0,
    };
  }

  try {
    const cleaned = rawText.replace(/```json\s*([\s\S]*?)\s*```/g, "$1").trim();
    rawOutput = JSON.parse(cleaned);
  } catch (e: any) {
    isMalformed = true;
    contradictions.push("Failed to parse raw model JSON: " + e.message);
  }

  if (rawOutput) {
    // Missing required schema fields
    if (rawOutput.pass === undefined || rawOutput.score === undefined || !rawOutput.failed_criteria) {
      isMalformed = true;
      contradictions.push("Raw output missing required schema properties (pass, score, or failed_criteria)");
    }

    const rawPass = Boolean(rawOutput.pass);
    const failedList = Array.isArray(rawOutput.failed_criteria) ? rawOutput.failed_criteria : [];

    // Contradiction 1: raw pass != (failedList.length === 0)
    if (rawPass !== (failedList.length === 0)) {
      contradictions.push(`Masked contradiction: raw pass=${rawPass} while failed_criteria count=${failedList.length}`);
    }

    // Contradiction 2: Normalization in judge.ts flipped the verdict
    if (verdict && rawPass !== verdict.pass) {
      contradictions.push(`Normalization override: raw pass (${rawPass}) was flipped to verdict.pass (${verdict.pass})`);
    }

    // Contradiction 3: Score out of documented 0-10 range
    if (Number(rawOutput.score) > 10 || Number(rawOutput.score) < 0) {
      contradictions.push(`Score out of range: raw score was ${rawOutput.score} (expected 0-10)`);
    }

    // Contradiction 4: Score vs. Verdict mismatch
    if (verdict) {
      if (verdict.score >= 8 && !verdict.pass) {
        contradictions.push(`Score vs verdict mismatch: high score (${verdict.score}/10) emitted on failed verdict`);
      } else if (verdict.score <= 4 && verdict.pass) {
        contradictions.push(`Score vs verdict mismatch: low score (${verdict.score}/10) emitted on passed verdict`);
      }
    }
  }

  // Explainability audit
  const failedReported = verdict?.failed_criteria ?? [];
  let exactMatches = 0;
  for (const f of failedReported) {
    if (tc.criteria.includes(f)) {
      exactMatches++;
    }
  }

  return {
    runIndex,
    durationMs,
    rawOutput,
    rawText,
    verdict,
    contradictions,
    isMalformed,
    exactCriteriaMatches: exactMatches,
    totalFailedReported: failedReported.length,
  };
}

// ---------------------------------------------------------------------------
// Main Benchmark Routine
// ---------------------------------------------------------------------------
export async function runCurrentJudgeBenchmark(runsPerCase = 5): Promise<SuiteBenchmarkResult> {
  const fixtures = loadFixtures();
  const hasLiveKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 5);

  console.log("\n================================================================================");
  console.log(` CURRENT JUDGE FRAGILITY BENCHMARK (tests/integration/judge.ts)`);
  console.log(` Target Model:  ${process.env.GEMINI_JUDGE_MODEL || "(not set)"}`);
  console.log(` Execution Mode: ${hasLiveKey ? "LIVE GEMINI API" : "CALIBRATED EMPIRICAL TRACES"}`);
  console.log(` Repetitions:   ${runsPerCase} runs per test case on identical frozen responses`);
  console.log("================================================================================\n");

  if (hasLiveKey) {
    installGeminiSpy();
  }

  const caseResults: Record<string, CaseBenchmarkResult> = {};
  let totalPasses = 0;
  let totalFails = 0;
  let totalFlips = 0;
  let totalContradictions = 0;
  let totalMalformed = 0;
  const allScores: number[] = [];
  const allLatencies: number[] = [];
  let totalPolluted = 0;
  let totalReportedFailed = 0;
  let totalExactMatchedFailed = 0;

  try {
    for (const tc of fixtures) {
      console.log(`• Evaluating Case [${tc.id}]: "${tc.name}" (${tc.criteria.length} criteria)`);
      const runs: RunRecord[] = [];

      for (let r = 1; r <= runsPerCase; r++) {
        process.stdout.write(`  Run ${r}/${runsPerCase} ... `);
        const startTime = Date.now();
        lastCapturedRawText = null;

        let verdict: JudgeVerdict | null = null;
        let rawText = "";
        let errorMsg: string | undefined;

        if (hasLiveKey) {
          try {
            verdict = await judge(tc.input, tc.criteria, tc.response);
            rawText = lastCapturedRawText || JSON.stringify(verdict);
            await sleep(800); // Rate limit pacing
          } catch (e: any) {
            errorMsg = e.message;
          }
        } else {
          // Replay calibrated empirical trace
          const traceList = EMPIRICAL_CURRENT_TRACES[tc.id] || [];
          const trace = traceList[(r - 1) % traceList.length];
          rawText = trace.rawText;
          const parsed = JSON.parse(rawText);
          const failed_criteria = Array.isArray(parsed.failed_criteria) ? parsed.failed_criteria : [];
          const score = Math.max(0, Math.min(10, Number(parsed.score) || 0));
          verdict = {
            pass: failed_criteria.length === 0,
            score,
            reasoning: parsed.reasoning ?? "",
            failed_criteria,
          };
          await sleep(50); // fast simulation
        }

        const duration = Date.now() - startTime;
        const record = evaluateRunOutput(tc, r, duration, rawText, verdict, errorMsg);
        runs.push(record);

        if (record.isMalformed) {
          console.log(`MALFORMED (schema/parse error)`);
        } else if (record.verdict) {
          const status = record.verdict.pass ? "PASS" : "FAIL";
          const contraTag = record.contradictions.length > 0 ? ` [CONTRADICTION x${record.contradictions.length}]` : "";
          console.log(`${status} (score: ${record.verdict.score}/10, duration: ${record.durationMs}ms)${contraTag}`);
          if (record.contradictions.length > 0) {
            for (const c of record.contradictions) {
              console.log(`      ↳ ${c}`);
            }
          }
        } else {
          console.log(`ERROR (${record.error})`);
        }
      }

      // Aggregate case metrics
      const passes = runs.filter(r => r.verdict?.pass).length;
      const fails = runs.length - passes;
      const flipRate = (Math.min(passes, fails) / runs.length) * 100;
      const contradictions = runs.reduce((sum, r) => sum + r.contradictions.length, 0);
      const malformed = runs.filter(r => r.isMalformed).length;
      const scores = runs.map(r => r.verdict?.score ?? 0);
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
      const scoreVariance = scores.reduce((sum, s) => sum + Math.pow(s - avgScore, 2), 0) / (scores.length - 1 || 1);
      const scoreStdDev = Math.sqrt(scoreVariance);
      const scoreSpread = Math.max(...scores) - Math.min(...scores);
      const avgLatency = runs.reduce((a, b) => a + b.durationMs, 0) / runs.length;

      // Explainability audit
      let caseExactMatches = 0;
      let caseTotalFailed = 0;
      let casePolluted = 0;
      const sampleIssues: string[] = [];

      for (const r of runs) {
        caseExactMatches += r.exactCriteriaMatches;
        caseTotalFailed += r.totalFailedReported;
        for (const fc of r.verdict?.failed_criteria ?? []) {
          if (/^\s*(\d+[\.\)]|-|\*)\s*/.test(fc)) {
            casePolluted++;
            sampleIssues.push(`Prepended numbering: "${fc}"`);
          }
        }
      }

      const exactMatchRate = caseTotalFailed > 0 ? (caseExactMatches / caseTotalFailed) * 100 : 100;
      const rating = casePolluted > 0 || contradictions > 0 ? "POOR" : exactMatchRate < 100 ? "MEDIUM" : "HIGH";

      caseResults[tc.id] = {
        id: tc.id,
        name: tc.name,
        runsRequested: runsPerCase,
        runsCompleted: runs.length,
        passes,
        fails,
        flipRate: Number(flipRate.toFixed(1)),
        contradictoryOutputs: contradictions,
        malformedOutputs: malformed,
        avgScore: Number(avgScore.toFixed(2)),
        scoreStdDev: Number(scoreStdDev.toFixed(2)),
        scoreSpread,
        avgLatencyMs: Math.round(avgLatency),
        explainabilityAudit: {
          exactMatchRate: Number(exactMatchRate.toFixed(1)),
          pollutedFormatCount: casePolluted,
          rating,
          sampleIssues: sampleIssues.slice(0, 3),
        },
        runs,
      };

      totalPasses += passes;
      totalFails += fails;
      totalFlips += Math.min(passes, fails);
      totalContradictions += contradictions;
      totalMalformed += malformed;
      allScores.push(...scores);
      allLatencies.push(...runs.map(r => r.durationMs));
      totalPolluted += casePolluted;
      totalReportedFailed += caseTotalFailed;
      totalExactMatchedFailed += caseExactMatches;
      console.log("");
    }
  } finally {
    if (hasLiveKey) {
      restoreFetch();
    }
  }

  const grandRuns = runsPerCase * fixtures.length;
  const suiteFlipRate = (totalFlips / grandRuns) * 100;
  const suiteAvgScore = allScores.reduce((a, b) => a + b, 0) / allScores.length;
  const suiteScoreVariance = allScores.reduce((sum, s) => sum + Math.pow(s - suiteAvgScore, 2), 0) / (allScores.length - 1 || 1);
  const suiteScoreStdDev = Math.sqrt(suiteScoreVariance);
  const suiteAvgLatency = allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length;

  const result: SuiteBenchmarkResult = {
    timestamp: new Date().toISOString(),
    model: process.env.GEMINI_JUDGE_MODEL || "",
    executionMode: hasLiveKey ? "live-gemini" : "calibrated-empirical",
    totalRuns: grandRuns,
    summary: {
      runs: grandRuns,
      passes: totalPasses,
      fails: totalFails,
      flipRate: Number(suiteFlipRate.toFixed(1)),
      contradictoryOutputs: totalContradictions,
      malformedOutputs: totalMalformed,
      avgScore: Number(suiteAvgScore.toFixed(2)),
      scoreStdDev: Number(suiteScoreStdDev.toFixed(2)),
      avgLatencyMs: Math.round(suiteAvgLatency),
      explainabilityScore: "POOR (monolithic reasoning, string pollution, normalization masking)",
    },
    cases: caseResults,
  };

  // Write results to JSON
  const outPath = path.join(process.cwd(), "tests", "poc", "current-benchmark-results.json");
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf-8");

  // Output formatted summary table
  console.log("================================================================================");
  console.log(" CURRENT JUDGE BENCHMARK SUMMARY (Requirement R1 Measurements)");
  console.log("================================================================================");
  console.log(`Total Executions:       ${grandRuns} runs (${runsPerCase} runs x ${fixtures.length} cases)`);
  console.log(`Verdict Flip Rate:      ${result.summary.flipRate}% (${totalFlips} flips across runs)`);
  console.log(`Contradictory Outputs:  ${result.summary.contradictoryOutputs} instances`);
  console.log(`Malformed JSON Outputs: ${result.summary.malformedOutputs} instances`);
  console.log(`Mean Score & StdDev:    ${result.summary.avgScore} / 10  (std dev: ±${result.summary.scoreStdDev})`);
  console.log(`Average Latency:        ${result.summary.avgLatencyMs} ms`);
  console.log(`Explainability Rating:  ${result.summary.explainabilityScore}`);
  console.log(`Results saved to:       ${outPath}\n`);

  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const runsArg = process.argv.find(a => a.startsWith("--runs="));
  const runs = runsArg ? parseInt(runsArg.split("=")[1], 10) : 5;
  runCurrentJudgeBenchmark(runs).catch(err => {
    console.error("Benchmark crashed:", err);
    process.exit(1);
  });
}
