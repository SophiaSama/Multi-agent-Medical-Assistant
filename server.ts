import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import { runConsultation } from "@/src/consult";
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

async function startServer() {
  await applyExtraCaCerts();

  const app = express();
  app.use(express.json());

  app.post("/api/consult", async (req, res) => {
    try {
      const { patientName, symptoms, location } = req.body;
      const jsonResponse = await runConsultation({ patientName, symptoms, location });
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
