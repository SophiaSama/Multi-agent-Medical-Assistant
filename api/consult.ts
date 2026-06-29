// Vercel serverless function for the medical consultation API.
// Mirrors the /api/consult route from server.ts so it works on Vercel,
// where the long-running Express server is not used.
import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@supabase/supabase-js";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { headers: { "User-Agent": "aistudio-build" } },
});

let supabaseClient: any = null;
function getSupabase() {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_API_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) supabaseClient = createClient(url, key);
    else console.warn(`[Supabase] Not initialized. URL: ${!!url}, Key: ${!!key}.`);
  }
  return supabaseClient;
}

class Agent {
  name: string;
  systemInstruction: string;
  model: string;
  constructor(name: string, systemInstruction: string, model = "gemini-2.5-flash-lite") {
    this.name = name;
    this.systemInstruction = systemInstruction;
    this.model = model;
  }
  async process(input: string, context: any = {}): Promise<string> {
    const prompt = `Context: ${JSON.stringify(context)}\n\nInput: ${input}`;
    try {
      const interaction = await ai.interactions.create({
        model: this.model,
        system_instruction: this.systemInstruction,
        input: prompt,
      });
      let output = "";
      for (const step of interaction.steps) {
        if (step.type === "model_output") {
          const t = step.content?.find((c) => c.type === "text");
          if (t && t.text) output += t.text;
        }
      }
      return output;
    } catch (e: any) {
      console.error(`[${this.name}] Error:`, e.message);
      return `Agent Error: ${e.message}`;
    }
  }
}

const frontDeskAgent = new Agent(
  "Front-Desk-Agent",
  "You are the Front Desk Agent. Register the user, summarize their symptoms briefly, and identify their patient profile. If past history is provided in context, acknowledge it to provide continuity. Output a concise patient summary."
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

async function runGroundedClinicSearch(location: string, symptoms: string): Promise<string> {
  const userMsg = location?.trim()
    ? `Find 1-2 currently open clinics or polyclinics near ${location} for a patient with these symptoms: ${symptoms}. Provide the clinic name, address, and phone number for each.`
    : `No location was provided. Advise the patient to contact their local emergency services or national medical hotline.`;
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-lite",
      contents: userMsg,
      config: {
        systemInstruction:
          "You are the Clinic Seeker Agent. Use Google Search to find real, currently open clinics near the patient's location. Prioritise clinics that are open right now. Present name, address, and phone number concisely. Do not fabricate clinic details.",
        tools: [{ googleSearch: {} }],
      },
    });
    return response.text ?? "Unable to find nearby clinics at this time.";
  } catch (err: any) {
    return `Unable to find nearby clinics: ${err.message}`;
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const { patientName, symptoms, location } = req.body || {};

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
      if (error) console.error(`[Memory] Failed to read patient history:`, error);
    }

    const frontDeskResult = await frontDeskAgent.process("Register this patient.", {
      patientName,
      symptoms,
      pastHistory,
    });

    const contextBundle = { symptoms, location, frontDeskSummary: frontDeskResult };
    const [clinicResult, pharmacyResult, riskResult] = await Promise.all([
      runGroundedClinicSearch(location || "", symptoms),
      pharmacyGuideAgent.process("Determine OTC medications and dietary limits.", contextBundle),
      riskAssessmentAgent.process("Evaluate the severity of these symptoms.", contextBundle),
    ]);

    const followUpResult = await followUpAgent.process("Generate a post-consultation care plan.", {
      ...contextBundle,
      clinicRecommendation: clinicResult,
      pharmacyGuidance: pharmacyResult,
      riskAssessment: riskResult,
    });

    const finalInput = `Front Desk: ${frontDeskResult}\nClinic: ${clinicResult}\nPharmacy: ${pharmacyResult}\nRisk Assessment: ${riskResult}\nFollow-Up Plan: ${followUpResult}`;
    const interaction = await ai.interactions.create({
      model: "gemini-2.5-flash-lite",
      input: finalInput,
      system_instruction: "You are the orchestrator. Synthesize the reports into a strict JSON.",
      response_format: {
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
    });

    let jsonOutput = "";
    const lastStep = interaction.steps.at(-1);
    if (lastStep && lastStep.type === "model_output") {
      const t = lastStep.content?.find((c) => c.type === "text");
      if (t) jsonOutput = t.text;
    }
    const cleaned = jsonOutput.replace(/```json\s*([\s\S]*?)\s*```/g, "$1").trim();
    const jsonResponse = JSON.parse(cleaned);

    if (supabase) {
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
      if (insertError) console.error(`[Persistence] Failed to save record:`, insertError);
    }

    res.status(200).json(jsonResponse);
  } catch (error: any) {
    console.error("[Backend Error]", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
}
