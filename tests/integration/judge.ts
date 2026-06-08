import { GoogleGenAI, Type } from "@google/genai";
import 'dotenv/config';

import type { MedicalAdvice } from "../../src/types";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

export interface JudgeVerdict {
  pass: boolean;
  score: number; // 0-10
  reasoning: string;
  failed_criteria: string[];
}

const JUDGE_SYSTEM_INSTRUCTION = `You are a strict medical-AI evaluation judge.
You are given:
1. The patient's input (symptoms, location, name).
2. A set of expectation criteria the response MUST satisfy.
3. The MedicalAdvice JSON produced by the system under test.

Evaluate whether the response satisfies EVERY criterion. Judge only against the
stated criteria; do not invent new requirements. A criterion is satisfied if the
response reasonably fulfills its intent. Be objective and concise.

Output a JSON object:
- pass: true only if all criteria are satisfied.
- score: integer 0-10 overall quality given the criteria.
- reasoning: one or two sentences explaining the verdict.
- failed_criteria: the exact criteria strings that were NOT satisfied (empty if all pass).`;

export async function judge(
  input: Record<string, unknown>,
  criteria: string[],
  response: MedicalAdvice,
): Promise<JudgeVerdict> {
  const evaluationInput = [
    `PATIENT INPUT:\n${JSON.stringify(input, null, 2)}`,
    `EXPECTATION CRITERIA:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}`,
    `SYSTEM RESPONSE (MedicalAdvice JSON):\n${JSON.stringify(response, null, 2)}`,
  ].join("\n\n");

  const interaction = await ai.interactions.create({
    model: "gemini-2.5-flash",
    input: evaluationInput,
    system_instruction: JUDGE_SYSTEM_INSTRUCTION,
    response_format: {
      type: Type.OBJECT,
      properties: {
        pass: { type: Type.BOOLEAN },
        score: { type: Type.INTEGER },
        reasoning: { type: Type.STRING },
        failed_criteria: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ["pass", "score", "reasoning", "failed_criteria"],
    },
  });

  let raw = "";
  const lastStep = interaction.steps.at(-1);
  if (lastStep && lastStep.type === 'model_output') {
    const textContent = lastStep.content?.find(c => c.type === 'text');
    if (textContent && textContent.text) {
      raw = textContent.text;
    }
  }

  const cleaned = raw.replace(/```json\s*([\s\S]*?)\s*```/g, "$1").trim();
  return JSON.parse(cleaned) as JudgeVerdict;
}
