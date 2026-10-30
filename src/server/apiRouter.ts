import { Router, Request, Response } from 'express';
import { evolutionService } from './evolutionService.ts';
import { persistWebhookMessage } from './webhookPersistence.ts';
import { getAdminFirestore } from './firebaseAdmin.ts';

export const apiRouter = Router();

// Middleware de compatibilidade para garantir que res.status e res.json funcionem em qualquer ambiente (Connect/Vite/Express)
apiRouter.use((_req, res, next) => {
  const anyRes = res as any;
  if (typeof anyRes.status !== 'function') {
    anyRes.status = function (code: number) {
      this.statusCode = code;
      return this;
    };
  }
  if (typeof anyRes.json !== 'function') {
    anyRes.json = function (obj: any) {
      this.setHeader('Content-Type', 'application/json; charset=utf-8');
      this.end(JSON.stringify(obj));
      return this;
    };
  }
  next();
});

export interface WebhookLogEntry {
  id: string;
  timestamp: string;
  event: string;
  status: 'processed' | 'duplicate' | 'unauthorized' | 'error';
  summary: string;
}

const recentWebhookLogs: WebhookLogEntry[] = [];

async function addWebhookLog(event: string, status: WebhookLogEntry['status'], summary: string): Promise<void> {
  const entry: WebhookLogEntry = {
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    event,
    status,
    summary,
  };

  // Mantém buffer local em memória como fallback rápido
  recentWebhookLogs.unshift(entry);
  if (recentWebhookLogs.length > 50) {
    recentWebhookLogs.pop();
  }

  // Persistência no Firestore (coleção webhook_logs) para sobrevivência em instâncias serverless
  try {
    const { db } = getAdminFirestore();
    if (db) {
      await db.collection('webhook_logs').doc(entry.id).set({
        id: entry.id,
        timestamp: entry.timestamp,
        receivedAt: Date.now(),
        event,
        status,
        summary,
      });
    }
  } catch (err: any) {
    // Falha ao gravar log de auditoria nunca impede o fluxo do webhook
    console.warn('[WebhookLog Persist Warning]:', err?.message || err);
  }
}

// Health check
apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'Lumus CRM API', timestamp: new Date().toISOString() });
});

// Configuração e status das integrações
apiRouter.get('/config', (_req: Request, res: Response) => {
  const config = evolutionService.getConfig();
  res.json(config);
});

// Status da conexão WhatsApp
apiRouter.get('/whatsapp/status', async (_req: Request, res: Response) => {
  try {
    const status = await evolutionService.getStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao consultar status' });
  }
});

// Obtenção do QR Code para conexão
apiRouter.get('/whatsapp/qrcode', async (_req: Request, res: Response) => {
  try {
    const result = await evolutionService.getQrCode();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao gerar QR Code' });
  }
});

// Desconectar WhatsApp
apiRouter.post('/whatsapp/disconnect', async (_req: Request, res: Response) => {
  try {
    const result = await evolutionService.disconnect();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Erro ao desconectar' });
  }
});

// Envio de mensagem de texto
apiRouter.post('/whatsapp/send-message', async (req: Request, res: Response) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        error: 'Campos "phone" e "message" são obrigatórios.',
      });
    }

    const result = await evolutionService.sendTextMessage(phone, message);
    if (!result.success) {
      return res.status(400).json(result);
    }

    // Registra chave de idempotência de forma atômica no Firestore para proteger contra eco de webhook
    if (result.externalId) {
      try {
        const { db } = getAdminFirestore();
        if (db) {
          const instanceName = process.env.EVOLUTION_INSTANCE_NAME?.trim() || 'lumus-crm';
          const idempRef = db.collection('idempotency_keys').doc(`${instanceName}_${result.externalId}`);
          await idempRef.set({
            instanceName,
            externalId: result.externalId,
            fromMe: true,
            phone,
            type: 'sent_by_crm',
            processedAt: new Date().toISOString(),
          });
        }
      } catch (idempErr) {
        // Falha no registro de auditoria da idempotência não impede o sucesso do envio
        console.warn('[SendMessage Idempotency Warning]:', idempErr);
      }
    }

    return res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Erro interno no envio' });
  }
});

// Logs recentes do Webhook para diagnóstico (Firestore com fallback em memória)
apiRouter.get('/webhook/logs', async (_req: Request, res: Response) => {
  try {
    const { db } = getAdminFirestore();
    if (db) {
      const snapshot = await db.collection('webhook_logs')
        .orderBy('timestamp', 'desc')
        .limit(50)
        .get();

      if (!snapshot.empty) {
        const logs: WebhookLogEntry[] = snapshot.docs.map(doc => {
          const d = doc.data();
          return {
            id: d.id || doc.id,
            timestamp: d.timestamp || new Date().toISOString(),
            event: d.event || 'UNKNOWN',
            status: d.status || 'processed',
            summary: d.summary || '',
          };
        });
        return res.json({ logs });
      }
    }
  } catch (err: any) {
    console.warn('[Get Webhook Logs Firestore Warning]:', err?.message || err);
  }

  // Fallback em memória caso o Firestore esteja inacessível ou sem registros
  res.json({ logs: recentWebhookLogs });
});

// Endpoint receptor oficial de Webhooks da Evolution API
apiRouter.post('/webhook/evolution', async (req: Request, res: Response) => {
  const headers = req.headers;
  const query = req.query;

  // Validação de autenticidade / segredo
  const isAuthorized = evolutionService.validateWebhookRequest(headers, query);
  if (!isAuthorized) {
    await addWebhookLog('UNKNOWN', 'unauthorized', 'Assinatura ou segredo do webhook inválido.');
    return res.status(401).json({ error: 'Webhook não autorizado' });
  }

  const payload = req.body || {};
  const event = String(payload.event || payload.type || req.headers['x-evolution-event'] || 'UNKNOWN').toUpperCase();
  const instanceName = process.env.EVOLUTION_INSTANCE_NAME?.trim() || payload.instance || 'lumus-crm';

  // Tratamento de mensagens recebidas / enviadas (MESSAGES_UPSERT)
  if (event.includes('MESSAGES') || payload.data?.key?.id) {
    const rawData = Array.isArray(payload.data) ? payload.data[0] : payload.data || payload;
    const externalId = rawData?.key?.id || payload?.key?.id;

    // Descarte imediato para evitar processamento redundante em rajadas da rede ou retentativas simultâneas
    if (externalId && evolutionService.isMessageAlreadyProcessed(externalId)) {
      await addWebhookLog(event, 'duplicate', `Mensagem descartada por duplicidade (ID: ${externalId})`);
      return res.status(200).json({ status: 'ignored_duplicate', externalId });
    }

    try {
      const persistenceResult = await persistWebhookMessage(payload, instanceName);

      if (persistenceResult.status === 'ignored_duplicate') {
        await addWebhookLog(event, 'duplicate', `Mensagem descartada por duplicidade (ID: ${persistenceResult.externalId})`);
        return res.status(200).json({ status: 'ignored_duplicate', externalId: persistenceResult.externalId });
      }

      if (persistenceResult.status === 'ignored_group') {
        await addWebhookLog(event, 'processed', `Mensagem de grupo ignorada para atendimento individual comercial (ID: ${persistenceResult.externalId})`);
        return res.status(200).json({ status: 'ignored_group', externalId: persistenceResult.externalId });
      }

      if (persistenceResult.status === 'processed') {
        await addWebhookLog(event, 'processed', `Mensagem persistida com sucesso no Firestore (ID: ${persistenceResult.externalId})`);
        return res.status(200).json({
          status: 'processed',
          externalId: persistenceResult.externalId,
          conversationId: persistenceResult.conversationId,
        });
      }

      // Erro na persistência
      await addWebhookLog(event, 'error', `Falha ao processar mensagem: ${persistenceResult.error?.slice(0, 80) || 'Erro desconhecido'}`);
      const isValidationError = persistenceResult.error?.includes('Payload');
      return res.status(isValidationError ? 400 : 500).json({
        status: 'error',
        error: persistenceResult.error,
        externalId: persistenceResult.externalId,
      });
    } catch (err: any) {
      await addWebhookLog(event, 'error', `Exceção inesperada: ${err.message || String(err)}`);
      return res.status(500).json({ status: 'error', error: err.message || 'Erro interno no processamento do webhook' });
    }
  }

  // Tratamento de eventos de conexão
  if (event.includes('CONNECTION') || event.includes('STATUS')) {
    const state = payload.data?.state || payload.state || payload.status;
    await addWebhookLog(event, 'processed', `Mudança de conexão: ${state}`);
    return res.status(200).json({ status: 'connection_updated', state });
  }

  // Tratamento de atualização de QR Code
  if (event.includes('QRCODE')) {
    await addWebhookLog(event, 'processed', 'Novo QR Code gerado pelo webhook');
    return res.status(200).json({ status: 'qrcode_updated' });
  }

  await addWebhookLog(event, 'processed', `Evento recebido: ${event}`);
  return res.status(200).json({ status: 'received', event });
});

