// Vercel serverless function for the medical consultation API.
// Thin wrapper around the shared runConsultation pipeline in src/consult.ts.
import { runConsultation } from "../src/consult.js";

function sendJson(res: any, status: number, payload: unknown) {
  if (typeof res.status === "function") {
    res.status(status).json(payload);
    return;
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { patientName, symptoms, location } = body;
    const result = await runConsultation({ patientName, symptoms, location });
    sendJson(res, 200, result);
  } catch (error: any) {
    console.error("[Backend Error]", error);
    sendJson(res, 500, { error: error.message || "Internal Server Error" });
  }
}
