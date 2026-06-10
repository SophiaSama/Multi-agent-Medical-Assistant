import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

// TLS trust: behind a corporate proxy, Node's global fetch (undici) may not trust
// the proxy's root CA, causing UNABLE_TO_GET_ISSUER_CERT_LOCALLY on HTTPS calls
// (e.g. to Supabase). When EXTRA_CA_CERTS (or NODE_EXTRA_CA_CERTS) is set, load
// the bundle and apply it to every outbound fetch via undici's dispatcher.
//
// undici is imported lazily (only when a CA path is configured) because eagerly
// loading the npm `undici` package crashes on some Node 20.x runtimes
// (`webidl.util.markAsUncloneable is not a function`). CI and the default
// container don't use a proxy, so they never load undici.
async function applyExtraCaCerts() {
  const extraCaPath = process.env.EXTRA_CA_CERTS || process.env.NODE_EXTRA_CA_CERTS;
  if (!extraCaPath) {
    console.warn(`[TLS] No EXTRA_CA_CERTS configured. If you are behind a TLS-intercepting proxy, set EXTRA_CA_CERTS in .env to a PEM bundle path.`);
    return;
  }
  try {
    const ca = fs.readFileSync(extraCaPath);
    const { setGlobalDispatcher, Agent: UndiciAgent } = await import("undici");
    setGlobalDispatcher(new UndiciAgent({ connect: { ca } }));
    console.log(`[TLS] Loaded extra CA bundle from ${extraCaPath}`);
  } catch (err) {
    console.error(`[TLS] Failed to load CA bundle from ${extraCaPath}:`, err);
  }
}

const PORT = process.env.PORT || 3000;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
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
  console.log('[Clinic-Seeker-Agent] Running grounded search...');
  const userMsg = location?.trim()
    ? `Find 1-2 currently open clinics or polyclinics near ${location} for a patient with these symptoms: ${symptoms}. Provide the clinic name, address, and phone number for each.`
    : `No location was provided. Advise the patient to contact their local emergency services or national medical hotline.`;
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-lite',
      contents: userMsg,
      config: {
        systemInstruction: "You are the Clinic Seeker Agent. Use Google Search to find real, currently open clinics near the patient's location. Prioritise clinics that are open right now. Present name, address, and phone number concisely. Do not fabricate clinic details.",
        tools: [{ googleSearch: {} }],
      },
    });
    return response.text ?? 'Unable to find nearby clinics at this time.';
  } catch (err: any) {
    console.error('[Clinic-Seeker-Agent] Grounded search error:', err.message);
    return `Unable to find nearby clinics: ${err.message}`;
  }
}

// A lightweight Google-like ADK (Agent Development Kit) pattern wrapping the Interactions API
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
    // Enrich context with patient memory if available
    const prompt = `Context: ${JSON.stringify(context)}\n\nInput: ${input}`;
    
    try {
      const interaction = await ai.interactions.create({
        model: this.model,
        system_instruction: this.systemInstruction,
        input: prompt,
      });

      let output = "";
      for (const step of interaction.steps) {
        if (step.type === 'model_output') {
          const textContent = step.content?.find(c => c.type === 'text');
          if (textContent && textContent.text) {
            output += textContent.text;
          }
        }
      }
      return output;
    } catch (e: any) {
      console.error(`[${this.name}] Error:`, e.message);
      return `Agent Error: ${e.message}`;
    }
  }
}

// Instantiate our Agents
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

// Synthesizer uses a typed response to format the final JSON
const synthesizerAgent = new Agent(
  "Synthesizer-Agent",
  "You are the synthesis agent. Combine the outputs of the sub-agents into a final JSON structure. NEVER markdown the JSON, return raw JSON string.",
  "gemini-2.5-flash-lite"
);


async function startServer() {
  await applyExtraCaCerts();

  const app = express();
  app.use(express.json());

  app.post("/api/consult", async (req, res) => {
    try {
      const { patientName, symptoms, location } = req.body;
      console.log(`[API] New consultation request for ${patientName} at ${location || 'Unknown Location'}`);
      // Memory Integration: Fetch past medical history from Supabase (MCP-like persistent store)
      let pastHistory = "No prior records found.";
      const supabase = getSupabase();
      if (supabase) {
        const { data, error } = await supabase
          .from('medical_records')
          .select('symptoms, conclusion, created_at')
          .eq('patient_name', patientName)
          .order('created_at', { ascending: false })
          .limit(3);
        
        if (data && data.length > 0) {
          pastHistory = data.map((c: any) => `[${c.created_at}] Symptoms: ${c.symptoms}. Conclusion: ${c.conclusion}`).join("\n");
        }
        if (error) {
          console.error(`[Memory] Failed to read patient history from Supabase:`, error);
        }
      }

      // Step 1: Front Desk Agent with history awareness
      const registrationMetadata = { patientName, symptoms, pastHistory };
      const frontDeskResult = await frontDeskAgent.process("Register this patient.", registrationMetadata);

      // Step 2: Run Sub-Agents in Parallel (Multi-Agent Routing)
      // Clinic-Seeker uses Gemini Google Search grounding for real-time verified results.
      const contextBundle = { symptoms, location, frontDeskSummary: frontDeskResult };

      const [clinicResult, pharmacyResult, riskResult] = await Promise.all([
        runGroundedClinicSearch(location || '', symptoms),
        pharmacyGuideAgent.process("Determine OTC medications and dietary limits.", contextBundle),
        riskAssessmentAgent.process("Evaluate the severity of these symptoms.", contextBundle)
      ]);

      const followUpResult = await followUpAgent.process("Generate a post-consultation care plan.", {
        ...contextBundle,
        clinicRecommendation: clinicResult,
        pharmacyGuidance: pharmacyResult,
        riskAssessment: riskResult,
      });
      
      // Step 4: Synthesizer Agent translates all findings into the strict JSON schema
      const finalInput = `Front Desk: ${frontDeskResult}\nClinic: ${clinicResult}\nPharmacy: ${pharmacyResult}\nRisk Assessment: ${riskResult}\nFollow-Up Plan: ${followUpResult}`;
      console.log(`[Synthesizer-Agent] Synthesizing final payload...`);
      
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
            follow_up_plan: { type: Type.STRING }
          },
          required: [
             "conclusion", "OTC_medication_recommended", "food_recommended",
             "food_restricted", "drink_recommended", "drink_restricted", "recommended_clinic",
             "severity_assessment", "follow_up_plan"
          ]
        }
      });

      let jsonOutput = "";
      const lastStep = interaction.steps.at(-1);
      if (lastStep && lastStep.type === 'model_output') {
         const textContent = lastStep.content?.find(c => c.type === 'text');
         if (textContent) {
           jsonOutput = textContent.text;
         }
      }

      // Cleanup code-blocks if any
      const cleaned = jsonOutput.replace(/```json\s*([\s\S]*?)\s*```/g, "$1").trim();
      const jsonResponse = JSON.parse(cleaned);

      // Persistence: Save the consultation result to Supabase
      if (supabase) {
        console.log(`[Persistence] Saving record to Supabase...`);
        const { error: insertError } = await supabase.from('medical_records').insert({
          patient_name: patientName,
          symptoms: symptoms,
          conclusion: jsonResponse.conclusion,
          OTC_medication_recommended: jsonResponse.OTC_medication_recommended,
          food_recommended: jsonResponse.food_recommended,
          food_restricted: jsonResponse.food_restricted,
          drink_recommended: jsonResponse.drink_recommended,
          drink_restricted: jsonResponse.drink_restricted,
          recommended_clinic: jsonResponse.recommended_clinic,
          severity_assessment: jsonResponse.severity_assessment,
          follow_up_plan: jsonResponse.follow_up_plan
        });
        if (insertError) {
          console.error(`[Persistence] Failed to save record to Supabase:`, insertError);
        } else {
          console.log(`[Persistence] Record saved successfully for ${patientName}.`);
        }
      } else {
        console.warn(`[Persistence] Supabase client not configured — skipping save. Check SUPABASE_URL and SUPABASE_SECRET_API_KEY / SUPABASE_SERVICE_ROLE_KEY.`);
      }

      res.json(jsonResponse);

    } catch (error: any) {
      console.error("[Backend Error]", error);
      res.status(500).json({ error: error.message || "Internal Server Error" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
