// Shared multi-agent consultation logic.
// Imported by both server.ts (local Express dev server) and api/consult.ts
// (Vercel serverless function) so the agent definitions stay in one place.
import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import type { MedicalAdvice } from "@/src/types";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { headers: { "User-Agent": "aistudio-build" } },
});

// Lazy Supabase Client
let supabaseClient: any = null;
function getSupabase() {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_API_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      supabaseClient = createClient(url, key);
    } else {
      console.warn(`[Supabase] Not initialized. URL present: ${!!url}, Key present: ${!!key}.`);
    }
  }
  return supabaseClient;
}

// Clinic Seeker: uses Gemini Google Search grounding for real-time, verified clinic results
async function runGroundedClinicSearch(location: string, symptoms: string): Promise<string> {
  console.log("[Clinic-Seeker-Agent] Running grounded search...");
  const userMsg = location?.trim()
    ? `Find 1-2 currently open clinics or polyclinics near ${location} for a patient with these symptoms: ${symptoms}. Provide the clinic name, address, and phone number for each.`
    : `No location was provided. Advise the patient to contact their local emergency services or national medical hotline.`;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: userMsg,
      config: {
        systemInstruction:
          "You are the Clinic Seeker Agent. Use Google Search to find real, currently open clinics near the patient's location. Prioritise clinics that are open right now. If today is Sunday or a public holiday, prioritise general clinics instead of public hospitals for non-urgent cases. Present name, address, and phone number concisely. Do not fabricate clinic details.",
        tools: [{ googleSearch: {} }],
      },
    });
    // Grounded responses often put text in candidate parts, leaving response.text empty.
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const partsText = parts.map((p: any) => p.text).filter(Boolean).join("\n").trim();
    const text = (response.text ?? "").trim() || partsText;
    return text || "Unable to find nearby clinics at this time.";
  } catch (err: any) {
    console.error("[Clinic-Seeker-Agent] Grounded search error:", err.message);
    return `Unable to find nearby clinics: ${err.message}`;
  }
}

// A lightweight Google-like ADK (Agent Development Kit) pattern over the stable generateContent API
class Agent {
  name: string;
  systemInstruction: string;
  model: string;

  constructor(name: string, systemInstruction: string, model: string = "gemini-2.5-flash-lite") {
    this.name = name;
    this.systemInstruction = systemInstruction;
    this.model = model;
  }

  async process(input: string, context: any = {}): Promise<string> {
    console.log(`[${this.name}] Processing...`);
    const prompt = `Context: ${JSON.stringify(context)}\n\nInput: ${input}`;
    try {
      const response = await ai.models.generateContent({
        model: this.model,
        contents: prompt,
        config: { systemInstruction: this.systemInstruction },
      });
      return (response.text ?? "").trim();
    } catch (e: any) {
      console.error(`[${this.name}] Error:`, e.message);
      return `Agent Error: ${e.message}`;
    }
  }
}

const frontDeskAgent = new Agent(
  "Front-Desk-Agent",
  "You are the Front Desk Agent. Register the user, summarize their symptoms briefly, and identify their patient profile. Use currentTime and the timestamps in pastHistory to classify the visit: if a prior record exists on an EARLIER calendar day with similar symptoms, note it as a recurring/ongoing condition; if a prior record is on the SAME calendar day, treat it as a duplicate request and do not call it chronic; otherwise treat it as new. Never infer 'chronic' or 'recurring' without dated prior history. Output a concise patient summary."
);

const pharmacyGuideAgent = new Agent(
  "Pharmacy-Guide-Agent",
  "You are the Pharmacy Guide Agent. Based on the patient's symptoms, recommend standard OTC (over the counter) medications. Also provide specific allowed foods, restricted foods, allowed drinks, and restricted drinks. Format concisely."
);

const riskAssessmentAgent = new Agent(
  "Risk-Assessment-Agent",
  "You are the Risk Assessment Agent. Based on the patient's reported symptoms, evaluate the severity as Low, Medium, or High. Provide a one-sentence justification. Format your output as '<Level>: <reason>'."
);

const followUpAgent = new Agent(
  "Follow-Up-Agent",
  "You are the Follow-Up Agent. Based on the patient's symptoms, risk level, recommended clinic, and pharmacy guidance, generate a concise post-consultation care plan. Include: when to seek emergency care, expected recovery timeline, and two or three self-care actions. Be practical and brief."
);

const synthesizerAgent = new Agent(
  "Synthesizer-Agent",
  "You are the synthesis agent. Combine the outputs of the sub-agents into a final JSON structure. NEVER markdown the JSON, return raw JSON string.",
  "gemini-2.5-flash-lite"
);

export interface ConsultInput {
  patientName: string;
  symptoms: string;
  location?: string;
}

// Runs the full multi-agent consultation pipeline and persists the result.
export async function runConsultation({ patientName, symptoms, location }: ConsultInput): Promise<MedicalAdvice> {
  console.log(`[API] New consultation request for ${patientName} at ${location || "Unknown Location"}`);

  // Memory Integration: Fetch past medical history from Supabase
  let pastHistory = "No prior records found.";
  const supabase = getSupabase();
  if (supabase) {
    const { data, error } = await supabase
      .from("medical_records")
      .select("symptoms, conclusion, created_at")
      .eq("patient_name", patientName)
      .order("created_at", { ascending: false })
      .limit(3);
    if (data && data.length > 0) {
      pastHistory = data
        .map((c: any) => `[${c.created_at}] Symptoms: ${c.symptoms}. Conclusion: ${c.conclusion}`)
        .join("\n");
    }
    if (error) console.error("[Memory] Failed to read patient history from Supabase:", error);
  }

  // Step 1: Front Desk Agent with history awareness
  const currentTime = new Date().toISOString();
  const frontDeskResult = await frontDeskAgent.process("Register this patient.", {
    patientName,
    symptoms,
    pastHistory,
    currentTime,
  });

  // Step 2: Run Sub-Agents in Parallel (Multi-Agent Routing)
  const contextBundle = { symptoms, location, frontDeskSummary: frontDeskResult };
  const [clinicResult, pharmacyResult, riskResult] = await Promise.all([
    runGroundedClinicSearch(location || "", symptoms),
    pharmacyGuideAgent.process("Determine OTC medications and dietary limits.", contextBundle),
    riskAssessmentAgent.process("Evaluate the severity of these symptoms.", contextBundle),
  ]);

  // Step 3: Follow-Up consumes parallel results
  const followUpResult = await followUpAgent.process("Generate a post-consultation care plan.", {
    ...contextBundle,
    clinicRecommendation: clinicResult,
    pharmacyGuidance: pharmacyResult,
    riskAssessment: riskResult,
  });

  // Step 4: Synthesizer translates all findings into the strict JSON schema
  const finalInput = `Front Desk: ${frontDeskResult}\nClinic: ${clinicResult}\nPharmacy: ${pharmacyResult}\nRisk Assessment: ${riskResult}\nFollow-Up Plan: ${followUpResult}`;
  console.log("[Synthesizer-Agent] Synthesizing final payload...");
  const interaction = await ai.models.generateContent({
    model: synthesizerAgent.model,
    contents: finalInput,
    config: {
      systemInstruction: "You are the orchestrator. Synthesize the reports into a strict JSON.",
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          conclusion: { type: Type.STRING },
          OTC_medication_recommended: { type: Type.STRING },
          food_recommended: { type: Type.STRING },
          food_restricted: { type: Type.STRING },
          drink_recommended: { type: Type.STRING },
          drink_restricted: { type: Type.STRING },
          recommended_clinic: { type: Type.STRING },
          severity_assessment: { type: Type.STRING },
          follow_up_plan: { type: Type.STRING },
        },
        required: [
          "conclusion", "OTC_medication_recommended", "food_recommended",
          "food_restricted", "drink_recommended", "drink_restricted",
          "recommended_clinic", "severity_assessment", "follow_up_plan",
        ],
      },
    },
  });

  const jsonOutput = interaction.text ?? "";
  const cleaned = jsonOutput.replace(/```json\s*([\s\S]*?)\s*```/g, "$1").trim();
  const jsonResponse: MedicalAdvice = JSON.parse(cleaned);

  // Persistence: Save the consultation result to Supabase
  if (supabase) {
    console.log("[Persistence] Saving record to Supabase...");
    const { error: insertError } = await supabase.from("medical_records").insert({
      patient_name: patientName,
      symptoms,
      conclusion: jsonResponse.conclusion,
      OTC_medication_recommended: jsonResponse.OTC_medication_recommended,
      food_recommended: jsonResponse.food_recommended,
      food_restricted: jsonResponse.food_restricted,
      drink_recommended: jsonResponse.drink_recommended,
      drink_restricted: jsonResponse.drink_restricted,
      recommended_clinic: jsonResponse.recommended_clinic,
      severity_assessment: jsonResponse.severity_assessment,
      follow_up_plan: jsonResponse.follow_up_plan,
    });
    if (insertError) console.error("[Persistence] Failed to save record to Supabase:", insertError);
    else console.log(`[Persistence] Record saved successfully for ${patientName}.`);
  } else {
    console.warn("[Persistence] Supabase client not configured — skipping save.");
  }

  return jsonResponse;
}
