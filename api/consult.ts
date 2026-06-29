// Vercel serverless function for the medical consultation API.
// Thin wrapper around the shared runConsultation pipeline in src/consult.ts.
import { runConsultation } from "@/src/consult";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const { patientName, symptoms, location } = req.body || {};
    const result = await runConsultation({ patientName, symptoms, location });
    res.status(200).json(result);
  } catch (error: any) {
    console.error("[Backend Error]", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
}
