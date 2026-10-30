// server.ts
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// src/server/apiRouter.ts
import { Router } from "express";

// src/server/evolutionService.ts
var processedExternalIds = /* @__PURE__ */ new Map();
setInterval(() => {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1e3;
  for (const [id, timestamp] of processedExternalIds.entries()) {
    if (timestamp < oneDayAgo) {
      processedExternalIds.delete(id);
    }
  }
}, 60 * 60 * 1e3);
var EvolutionService = class {
  getEnvConfig() {
    const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "") || "";
    const apiKey = process.env.EVOLUTION_API_KEY?.trim() || "";
    const instanceName = process.env.EVOLUTION_INSTANCE_NAME?.trim() || "";
    const webhookSecret = process.env.WEBHOOK_SECRET?.trim() || "";
    return {
      apiUrl,
      apiKey,
      instanceName,
      webhookSecret,
      isConfigured: Boolean(apiUrl && apiKey && instanceName)
    };
  }
  getConfig() {
    const env = this.getEnvConfig();
    const appUrl = (process.env.APP_URL || "").replace(/\/+$/, "");
    const webhookUrl = appUrl ? `${appUrl}/api/webhook/evolution` : "/api/webhook/evolution";
    return {
      isConfigured: env.isConfigured,
      apiUrl: env.apiUrl ? `${env.apiUrl.slice(0, 15)}...` : void 0,
      instanceName: env.instanceName || void 0,
      webhookUrl,
      hasWebhookSecret: Boolean(env.webhookSecret)
    };
  }
  /**
   * Consulta o estado de conexão real da instância na Evolution API
   */
  async getStatus() {
    const env = this.getEnvConfig();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (!env.isConfigured) {
      return {
        configured: false,
        state: "disconnected",
        lastCheckedAt: now,
        message: "Vari\xE1veis EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE_NAME n\xE3o configuradas no ambiente."
      };
    }
    try {
      const response = await fetch(`${env.apiUrl}/instance/connectionState/${env.instanceName}`, {
        method: "GET",
        headers: {
          "apikey": env.apiKey,
          "Content-Type": "application/json"
        }
      });
      if (!response.ok) {
        const errorText = await response.text();
        return {
          configured: true,
          state: "error",
          instanceName: env.instanceName,
          lastCheckedAt: now,
          message: `Falha ao consultar Evolution API (${response.status}): ${errorText.slice(0, 200)}`
        };
      }
      const data = await response.json();
      const rawState = (data?.instance?.state || data?.state || data?.connectionStatus || data?.status || "close").toLowerCase();
      let mappedState = "disconnected";
      if (rawState === "open" || rawState === "connected") {
        mappedState = "connected";
      } else if (rawState === "connecting" || rawState === "pairing") {
        mappedState = "connecting";
      } else {
        mappedState = "disconnected";
      }
      let connectedPhone = void 0;
      const ownerJid = data?.instance?.ownerJid || data?.ownerJid || data?.instance?.phone;
      if (ownerJid) {
        connectedPhone = String(ownerJid).replace(/@.+$/, "");
      }
      return {
        configured: true,
        state: mappedState,
        instanceName: env.instanceName,
        connectedPhone,
        profileName: data?.instance?.profileName || data?.profileName,
        lastCheckedAt: now,
        details: { rawState }
      };
    } catch (err) {
      return {
        configured: true,
        state: "error",
        instanceName: env.instanceName,
        lastCheckedAt: now,
        message: `N\xE3o foi poss\xEDvel conectar ao servidor da Evolution API: ${err.message || String(err)}`
      };
    }
  }
  /**
   * Solicita ou atualiza o QR Code para pareamento
   */
  async getQrCode() {
    const env = this.getEnvConfig();
    if (!env.isConfigured) {
      return {
        success: false,
        error: "Configura\xE7\xE3o da Evolution API incompleta (.env). Verifique a p\xE1gina de integra\xE7\xE3o."
      };
    }
    try {
      const response = await fetch(`${env.apiUrl}/instance/connect/${env.instanceName}`, {
        method: "GET",
        headers: {
          "apikey": env.apiKey,
          "Content-Type": "application/json"
        }
      });
      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Erro ao solicitar QR Code (${response.status}): ${errorText.slice(0, 200)}`
        };
      }
      const data = await response.json();
      let qrCodeBase64 = data?.base64 || data?.qrcode?.base64 || data?.qrCode;
      if (qrCodeBase64 && !qrCodeBase64.startsWith("data:image")) {
        qrCodeBase64 = `data:image/png;base64,${qrCodeBase64}`;
      }
      return {
        success: Boolean(qrCodeBase64 || data?.code),
        qrCodeBase64,
        pairingCode: data?.pairingCode,
        state: data?.state || (qrCodeBase64 ? "waiting_qr" : "open")
      };
    } catch (err) {
      return {
        success: false,
        error: `Erro de comunica\xE7\xE3o ao obter QR Code: ${err.message}`
      };
    }
  }
  /**
   * Desconecta a instância do WhatsApp (logout)
   */
  async disconnect() {
    const env = this.getEnvConfig();
    if (!env.isConfigured) {
      return { success: false, error: "Evolution API n\xE3o configurada." };
    }
    try {
      const response = await fetch(`${env.apiUrl}/instance/logout/${env.instanceName}`, {
        method: "DELETE",
        headers: {
          "apikey": env.apiKey,
          "Content-Type": "application/json"
        }
      });
      if (!response.ok && response.status !== 404) {
        const errText = await response.text();
        return { success: false, error: `Falha ao desconectar: ${errText.slice(0, 200)}` };
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  /**
   * Envia mensagem de texto via Evolution API
   */
  async sendTextMessage(phone, text) {
    const env = this.getEnvConfig();
    if (!env.isConfigured) {
      return {
        success: false,
        status: "failed",
        error: "Evolution API n\xE3o configurada. Configure as vari\xE1veis de ambiente para envio real."
      };
    }
    const cleanNumber = phone.replace(/\D/g, "");
    if (!cleanNumber || cleanNumber.length < 10) {
      return {
        success: false,
        status: "failed",
        error: "N\xFAmero de telefone inv\xE1lido para envio via WhatsApp."
      };
    }
    try {
      const response = await fetch(`${env.apiUrl}/message/sendText/${env.instanceName}`, {
        method: "POST",
        headers: {
          "apikey": env.apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          number: cleanNumber,
          text,
          delay: 1e3
        })
      });
      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          status: "failed",
          error: `Falha no envio Evolution API (${response.status}): ${errorText.slice(0, 250)}`
        };
      }
      const result = await response.json();
      const externalId = result?.key?.id || result?.id || `msg_${Date.now()}`;
      processedExternalIds.set(externalId, Date.now());
      return {
        success: true,
        status: "sent",
        externalId
      };
    } catch (err) {
      return {
        success: false,
        status: "failed",
        error: `Erro ao enviar mensagem: ${err.message}`
      };
    }
  }
  /**
   * Valida a autenticidade da requisição do Webhook
   */
  validateWebhookRequest(headers, query) {
    const env = this.getEnvConfig();
    if (env.webhookSecret) {
      const headerSecret = headers["x-webhook-secret"] || headers["webhook-secret"] || headers["apikey"] || query["secret"];
      if (headerSecret !== env.webhookSecret && headerSecret !== env.apiKey) {
        return false;
      }
    }
    return true;
  }
  /**
   * Verifica se mensagem já foi processada (idempotência)
   */
  isMessageAlreadyProcessed(externalId) {
    if (!externalId) return false;
    if (processedExternalIds.has(externalId)) {
      return true;
    }
    processedExternalIds.set(externalId, Date.now());
    return false;
  }
};
var evolutionService = new EvolutionService();

// src/server/apiRouter.ts
var apiRouter = Router();
var recentWebhookLogs = [];
function addWebhookLog(event, status, summary) {
  const entry = {
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    event,
    status,
    summary
  };
  recentWebhookLogs.unshift(entry);
  if (recentWebhookLogs.length > 30) {
    recentWebhookLogs.pop();
  }
}
apiRouter.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "Lumus CRM API", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
});
apiRouter.get("/config", (_req, res) => {
  const config = evolutionService.getConfig();
  res.json(config);
});
apiRouter.get("/whatsapp/status", async (_req, res) => {
  try {
    const status = await evolutionService.getStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message || "Erro ao consultar status" });
  }
});
apiRouter.get("/whatsapp/qrcode", async (_req, res) => {
  try {
    const result = await evolutionService.getQrCode();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Erro ao gerar QR Code" });
  }
});
apiRouter.post("/whatsapp/disconnect", async (_req, res) => {
  try {
    const result = await evolutionService.disconnect();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "Erro ao desconectar" });
  }
});
apiRouter.post("/whatsapp/send-message", async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        error: 'Campos "phone" e "message" s\xE3o obrigat\xF3rios.'
      });
    }
    const result = await evolutionService.sendTextMessage(phone, message);
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message || "Erro interno no envio" });
  }
});
apiRouter.get("/webhook/logs", (_req, res) => {
  res.json({ logs: recentWebhookLogs });
});
apiRouter.post("/webhook/evolution", (req, res) => {
  const headers = req.headers;
  const query = req.query;
  const isAuthorized = evolutionService.validateWebhookRequest(headers, query);
  if (!isAuthorized) {
    addWebhookLog("UNKNOWN", "unauthorized", "Assinatura ou segredo do webhook inv\xE1lido.");
    return res.status(401).json({ error: "Webhook n\xE3o autorizado" });
  }
  const payload = req.body || {};
  const event = String(payload.event || payload.type || req.headers["x-evolution-event"] || "UNKNOWN").toUpperCase();
  if (event.includes("MESSAGES") || payload.data?.key?.id) {
    const messageData = payload.data || payload;
    const externalId = messageData?.key?.id || messageData?.id;
    const fromMe = messageData?.key?.fromMe === true;
    const remoteJid = messageData?.key?.remoteJid || messageData?.remoteJid || "";
    const phone = remoteJid.replace(/@.+$/, "");
    const text = messageData?.message?.conversation || messageData?.message?.extendedTextMessage?.text || messageData?.body || "";
    if (externalId && evolutionService.isMessageAlreadyProcessed(externalId)) {
      addWebhookLog(event, "duplicate", `Mensagem descartada por duplicidade (ID: ${externalId})`);
      return res.json({ status: "ignored_duplicate", externalId });
    }
    addWebhookLog(
      event,
      "processed",
      `${fromMe ? "Enviada" : "Recebida"} de ${phone}: "${text.slice(0, 30)}..."`
    );
    return res.json({ status: "processed", externalId, phone, fromMe });
  }
  if (event.includes("CONNECTION") || event.includes("STATUS")) {
    const state = payload.data?.state || payload.state || payload.status;
    addWebhookLog(event, "processed", `Mudan\xE7a de conex\xE3o: ${state}`);
    return res.json({ status: "connection_updated", state });
  }
  if (event.includes("QRCODE")) {
    addWebhookLog(event, "processed", "Novo QR Code gerado pelo webhook");
    return res.json({ status: "qrcode_updated" });
  }
  addWebhookLog(event, "processed", `Evento recebido: ${event}`);
  return res.json({ status: "received", event });
});

// server.ts
dotenv.config();
var __filename = fileURLToPath(import.meta.url);
var __dirname = path.dirname(__filename);
var app = express();
var PORT = process.env.PORT || 3e3;
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/api", apiRouter);
var distPath = path.resolve(__dirname, "dist");
app.use(express.static(distPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});
app.listen(PORT, () => {
  console.log(`Lumus CRM backend rodando na porta ${PORT}`);
});
