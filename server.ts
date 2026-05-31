import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { createClient } from "@supabase/supabase-js";
import 'dotenv/config';

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
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      supabaseClient = createClient(url, key);
    }
  }
  return supabaseClient;
}

// A lightweight Google-like ADK (Agent Development Kit) pattern wrapping the Interactions API
class Agent {
  name: string;
  systemInstruction: string;
  model: string;

  constructor(name: string, systemInstruction: string, model: string = "gemini-2.5-flash") {
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

const clinicSeekerAgent = new Agent(
  "Clinic-Seeker-Agent",
  "You are the Clinic Seeker Agent. You MUST search for 1-2 real hospitals, clinics, or polyclinics located in the specified patient location. If the location is Singapore (e.g., Tampines), suggest options like Tampines Polyclinic or Changi General Hospital. Do NOT suggest UK or European numbers like NHS 111 unless the patient is explicitly in those regions. If no location is provided at all, suggest that the user contact their local emergency services or national medical hotline. Be concise."
);

const pharmacyGuideAgent = new Agent(
  "Pharmacy-Guide-Agent",
  "You are the Pharmacy Guide Agent. Based on the patient's symptoms, recommend standard OTC (over the counter) medications. Also provide specific allowed foods, restricted foods, allowed drinks, and restricted drinks. Format concisely."
);

// Synthesizer uses a typed response to format the final JSON
const synthesizerAgent = new Agent(
  "Synthesizer-Agent",
  "You are the synthesis agent. Combine the outputs of the sub-agents into a final JSON structure. NEVER markdown the JSON, return raw JSON string.",
  "gemini-2.5-flash"
);


async function startServer() {
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
          .select('symptoms, diagnosis, created_at')
          .eq('patient_name', patientName)
          .order('created_at', { ascending: false })
          .limit(3);
        
        if (data && data.length > 0) {
          pastHistory = data.map((c: any) => `[${c.created_at}] Symptoms: ${c.symptoms}. Diagnosis: ${c.diagnosis}`).join("\n");
        }
      }

      // Step 1: Front Desk Agent with history awareness
      const registrationMetadata = { patientName, symptoms, pastHistory };
      const frontDeskResult = await frontDeskAgent.process("Register this patient.", registrationMetadata);
      
      // Step 2 & 3: Run Sub-Agents in Parallel (Multi-Agent Routing)
      const contextBundle = { symptoms, location, frontDeskSummary: frontDeskResult };
      
      const [clinicResult, pharmacyResult] = await Promise.all([
        clinicSeekerAgent.process("Find appropriate clinic options.", contextBundle),
        pharmacyGuideAgent.process("Determine OTC medications and dietary limits.", contextBundle)
      ]);
      
      // Step 4: Synthesizer Agent translates all findings into the strict JSON schema
      const finalInput = `Front Desk: ${frontDeskResult}\nClinic: ${clinicResult}\nPharmacy: ${pharmacyResult}`;
      console.log(`[Synthesizer-Agent] Synthesizing final payload...`);
      
      const interaction = await ai.interactions.create({
        model: "gemini-2.5-flash",
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
            recommended_clinic: { type: Type.STRING }
          },
          required: [
             "conclusion", "OTC_medication_recommended", "food_recommended", 
             "food_restricted", "drink_recommended", "drink_restricted", "recommended_clinic"
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
        await supabase.from('medical_records').insert({
          patient_name: patientName,
          symptoms: symptoms,
          diagnosis: jsonResponse.conclusion,
          treatment_plan: jsonResponse.pharmacy_advice,
          clinic_recommendations: jsonResponse.clinics
        });
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
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
