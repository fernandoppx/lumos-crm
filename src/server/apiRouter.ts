import { Router, Request, Response, NextFunction } from 'express';
import {
  evolutionService,
  getAppUrl,
  buildWebhookUrl,
  getWebhookSecret,
  makeInstanceName,
  mapRawState,
  OutgoingMediaType,
} from './evolutionService.ts';
import {
  persistWebhookMessage,
  extractEvolutionMessage,
  normalizeEvent,
  storeMediaFile,
  updateMessageStatus,
  mediaPlaceholder,
  InstanceRef,
} from './webhookPersistence.ts';
import { getAdminFirestore, getAdminAuth, hasServiceAccount } from './firebaseAdmin.ts';

export const apiRouter = Router();

// Compatibilidade res.status / res.json em qualquer runtime (Connect/Vite/Express)
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

// ---------------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------------

type Role = 'admin' | 'manager' | 'sales_rep';

interface AuthedUser {
  uid: string;
  email: string;
  name: string;
  role: Role;
}

type AuthedRequest = Request & { user?: AuthedUser };

const profileCache = new Map<string, { user: AuthedUser; at: number }>();
const PROFILE_TTL_MS = 30_000;

function isManagerRole(role: Role) {
  return role === 'admin' || role === 'manager';
}

/** Exige login válido (token do Firebase) e conta ativa. */
function requireUser(...roles: Role[]) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = String(req.headers.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return res.status(401).json({ error: 'Faça login para continuar.' });

    let uid: string;
    let email = '';
    try {
      const decoded = await getAdminAuth().verifyIdToken(token);
      uid = decoded.uid;
      email = decoded.email || '';
    } catch {
      return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
    }

    const cached = profileCache.get(uid);
    let user = cached && Date.now() - cached.at < PROFILE_TTL_MS ? cached.user : null;

    if (!user) {
      const { db, error } = getAdminFirestore();
      if (!db) return res.status(503).json({ error });
      const snap = await db.collection('users').doc(uid).get();
      const p = snap.data() as any;
      if (!snap.exists || p?.active === false) {
        return res.status(403).json({ error: 'Seu acesso ainda não foi aprovado por um administrador.' });
      }
      user = { uid, email: p.email || email, name: p.name || email || 'Usuário', role: (p.role as Role) || 'sales_rep' };
      profileCache.set(uid, { user, at: Date.now() });
    }

    if (roles.length && !roles.includes(user.role)) {
      return res.status(403).json({ error: 'Você não tem permissão para esta ação.' });
    }
    req.user = user;
    next();
  };
}

function dbOrFail(res: Response) {
  const { db, error } = getAdminFirestore();
  if (!db) {
    res.status(503).json({ error });
    return null;
  }
  return db;
}

// ---------------------------------------------------------------------------
// Instâncias (números de WhatsApp)
// ---------------------------------------------------------------------------

const INSTANCES = 'whatsapp_instances';
const MAX_INSTANCES = Math.max(1, Number(process.env.MAX_WHATSAPP_INSTANCES || 10));

async function loadInstance(id: string) {
  const { db } = getAdminFirestore();
  if (!db) return null;
  const snap = await db.collection(INSTANCES).doc(id).get();
  return snap.exists ? ({ id: snap.id, ...(snap.data() as any) } as any) : null;
}

function canManageInstance(user: AuthedUser, inst: any) {
  return isManagerRole(user.role) || inst.ownerId === user.uid;
}

/** Garante que a instância antiga (EVOLUTION_INSTANCE_NAME) apareça como um número no CRM. */
async function ensureLegacyInstance(instanceName: string): Promise<any | null> {
  const legacyName = process.env.EVOLUTION_INSTANCE_NAME?.trim();
  if (!legacyName || legacyName !== instanceName) return null;
  const { db } = getAdminFirestore();
  if (!db) return null;
  const ref = db.collection(INSTANCES).doc(legacyName);
  const snap = await ref.get();
  if (snap.exists) return { id: snap.id, ...(snap.data() as any) };
  const now = new Date().toISOString();
  const data = {
    label: 'Número principal',
    ownerId: null,
    ownerName: null,
    state: 'disconnected',
    phone: null,
    legacy: true,
    createdAt: now,
    updatedAt: now,
  };
  await ref.set(data);
  return { id: legacyName, ...data };
}

function instanceRef(inst: any): InstanceRef {
  return { id: inst.id, label: inst.label || inst.id, ownerId: inst.ownerId || null, ownerName: inst.ownerName || null };
}

// Health check (público)
apiRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', service: 'Lumos CRM API', timestamp: new Date().toISOString() });
});

// Diagnóstico da integração (somente gestores)
apiRouter.get('/config', requireUser('admin', 'manager'), (req: Request, res: Response) => {
  const appUrl = getAppUrl(req.headers.host);
  res.json({
    evolutionConfigured: evolutionService.isConfigured(),
    evolutionUrlHint: process.env.EVOLUTION_API_URL ? `${process.env.EVOLUTION_API_URL.slice(0, 24)}…` : null,
    hasServiceAccount: hasServiceAccount(),
    webhookSecretSource: process.env.WEBHOOK_SECRET?.trim() ? 'WEBHOOK_SECRET' : getWebhookSecret() ? 'derivado da chave' : 'nenhum',
    appUrl: appUrl || null,
    appUrlFromEnv: Boolean(process.env.APP_URL?.trim()),
    webhookUrl: appUrl ? `${appUrl}/api/webhook/evolution` : null,
    legacyInstanceName: process.env.EVOLUTION_INSTANCE_NAME?.trim() || null,
    maxInstances: MAX_INSTANCES,
  });
});

// Adiciona um número (cria a instância na Evolution e configura o webhook)
apiRouter.post('/whatsapp/instances', requireUser(), async (req: AuthedRequest, res: Response) => {
  const user = req.user!;
  const db = dbOrFail(res);
  if (!db) return;
  if (!evolutionService.isConfigured()) {
    return res.status(400).json({ error: 'A Evolution API ainda não foi configurada pelo administrador.' });
  }

  const label = String(req.body?.label || '').trim().slice(0, 40);
  let ownerId: string | null = req.body?.ownerId ? String(req.body.ownerId) : user.uid;
  if (!label) return res.status(400).json({ error: 'Dê um nome para o número (ex.: "Vendas Ana").' });
  if (!isManagerRole(user.role) && ownerId !== user.uid) {
    return res.status(403).json({ error: 'Você só pode adicionar um número para você mesmo.' });
  }

  const all = await db.collection(INSTANCES).get();
  if (all.size >= MAX_INSTANCES) {
    return res.status(400).json({ error: `Limite de ${MAX_INSTANCES} números atingido.` });
  }
  if (!isManagerRole(user.role) && all.docs.some((d) => (d.data() as any).ownerId === user.uid)) {
    return res.status(400).json({ error: 'Você já tem um número cadastrado. Peça a um gestor para adicionar outro.' });
  }

  let ownerName: string | null = user.name;
  if (ownerId && ownerId !== user.uid) {
    const o = await db.collection('users').doc(ownerId).get();
    if (!o.exists) return res.status(400).json({ error: 'Responsável não encontrado.' });
    ownerName = (o.data() as any).name || null;
  }
  if (req.body?.ownerId === null) {
    ownerId = null;
    ownerName = null;
  }

  const appUrl = getAppUrl(req.headers.host);
  if (!appUrl) return res.status(400).json({ error: 'Configure APP_URL para gerar o endereço do webhook.' });

  const instanceName = makeInstanceName(label);
  try {
    await evolutionService.createInstance(instanceName, buildWebhookUrl(appUrl));
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }

  const now = new Date().toISOString();
  const data = {
    label,
    ownerId,
    ownerName,
    state: 'connecting',
    phone: null,
    profileName: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
    createdBy: user.uid,
  };
  await db.collection(INSTANCES).doc(instanceName).set(data);
  res.json({ id: instanceName, ...data });
});

// Associa ao CRM uma instância que já existe na Evolution (somente gestores)
apiRouter.post('/whatsapp/instances/import', requireUser('admin', 'manager'), async (req: AuthedRequest, res: Response) => {
  const db = dbOrFail(res);
  if (!db) return;
  const instanceName = String(req.body?.instanceName || '').trim();
  const label = String(req.body?.label || instanceName).trim().slice(0, 40);
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(instanceName)) {
    return res.status(400).json({ error: 'Nome de instância inválido.' });
  }
  const appUrl = getAppUrl(req.headers.host);
  try {
    await evolutionService.setWebhook(instanceName, buildWebhookUrl(appUrl));
    const st = await evolutionService.getStatus(instanceName);
    let ownerName: string | null = null;
    const ownerId = req.body?.ownerId ? String(req.body.ownerId) : null;
    if (ownerId) ownerName = ((await db.collection('users').doc(ownerId).get()).data() as any)?.name || null;
    const now = new Date().toISOString();
    const data = {
      label,
      ownerId,
      ownerName,
      state: st.state,
      phone: st.phone || null,
      profileName: st.profileName || null,
      lastError: st.error || null,
      createdAt: now,
      updatedAt: now,
    };
    await db.collection(INSTANCES).doc(instanceName).set(data, { merge: true });
    res.json({ id: instanceName, ...data });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// Atualiza nome / responsável
apiRouter.patch('/whatsapp/instances/:id', requireUser('admin', 'manager'), async (req: AuthedRequest, res: Response) => {
  const db = dbOrFail(res);
  if (!db) return;
  const inst = await loadInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Número não encontrado.' });
  const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
  if (typeof req.body?.label === 'string' && req.body.label.trim()) updates.label = req.body.label.trim().slice(0, 40);
  if (req.body?.ownerId !== undefined) {
    if (req.body.ownerId) {
      const o = await db.collection('users').doc(String(req.body.ownerId)).get();
      if (!o.exists) return res.status(400).json({ error: 'Responsável não encontrado.' });
      updates.ownerId = o.id;
      updates.ownerName = (o.data() as any).name || null;
    } else {
      updates.ownerId = null;
      updates.ownerName = null;
    }
  }
  await db.collection(INSTANCES).doc(inst.id).update(updates);
  res.json({ success: true });
});

// QR Code para parear
apiRouter.post('/whatsapp/instances/:id/qrcode', requireUser(), async (req: AuthedRequest, res: Response) => {
  const db = dbOrFail(res);
  if (!db) return;
  const inst = await loadInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Número não encontrado.' });
  if (!canManageInstance(req.user!, inst)) return res.status(403).json({ error: 'Só o responsável ou um gestor pode conectar este número.' });
  try {
    const qr = await evolutionService.getQrCode(inst.id);
    await db.collection(INSTANCES).doc(inst.id).update({ state: qr.state, lastError: null, updatedAt: new Date().toISOString() });
    res.json(qr);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// Consulta o status na Evolution e grava no banco
apiRouter.post('/whatsapp/instances/:id/refresh', requireUser(), async (req: AuthedRequest, res: Response) => {
  const db = dbOrFail(res);
  if (!db) return;
  const inst = await loadInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Número não encontrado.' });
  try {
    const st = await evolutionService.getStatus(inst.id);
    const updates: Record<string, any> = {
      state: st.state,
      lastError: st.error || null,
      updatedAt: new Date().toISOString(),
    };
    if (st.phone) updates.phone = st.phone;
    if (st.profileName) updates.profileName = st.profileName;
    if (st.profilePicUrl) updates.profilePicUrl = st.profilePicUrl;
    await db.collection(INSTANCES).doc(inst.id).update(updates);
    res.json(st);
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// Reaplica o webhook (útil depois de trocar o domínio do CRM)
apiRouter.post('/whatsapp/instances/:id/webhook', requireUser('admin', 'manager'), async (req: AuthedRequest, res: Response) => {
  const inst = await loadInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Número não encontrado.' });
  try {
    await evolutionService.setWebhook(inst.id, buildWebhookUrl(getAppUrl(req.headers.host)));
    res.json({ success: true });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// Desconecta (logout do WhatsApp)
apiRouter.post('/whatsapp/instances/:id/logout', requireUser(), async (req: AuthedRequest, res: Response) => {
  const db = dbOrFail(res);
  if (!db) return;
  const inst = await loadInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Número não encontrado.' });
  if (!canManageInstance(req.user!, inst)) return res.status(403).json({ error: 'Sem permissão.' });
  try {
    await evolutionService.logout(inst.id);
    await db.collection(INSTANCES).doc(inst.id).update({ state: 'disconnected', updatedAt: new Date().toISOString() });
    res.json({ success: true });
  } catch (err: any) {
    res.status(502).json({ error: err.message });
  }
});

// Remove o número (da Evolution e do CRM). As conversas são mantidas.
apiRouter.delete('/whatsapp/instances/:id', requireUser(), async (req: AuthedRequest, res: Response) => {
  const db = dbOrFail(res);
  if (!db) return;
  const inst = await loadInstance(req.params.id);
  if (!inst) return res.status(404).json({ error: 'Número não encontrado.' });
  if (!canManageInstance(req.user!, inst)) return res.status(403).json({ error: 'Sem permissão.' });
  try {
    await evolutionService.deleteInstance(inst.id);
  } catch (err: any) {
    if (req.query.force !== '1') return res.status(502).json({ error: err.message, canForce: true });
  }
  await db.collection(INSTANCES).doc(inst.id).delete();
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Envio de mensagens
// ---------------------------------------------------------------------------

async function resolveConversationForSend(req: AuthedRequest, res: Response) {
  const user = req.user!;
  const db = dbOrFail(res);
  if (!db) return null;
  const conversationId = String(req.body?.conversationId || '');
  if (!conversationId) {
    res.status(400).json({ error: 'conversationId é obrigatório.' });
    return null;
  }
  const convRef = db.collection('conversations').doc(conversationId);
  const convSnap = await convRef.get();
  if (!convSnap.exists) {
    res.status(404).json({ error: 'Conversa não encontrada.' });
    return null;
  }
  const conv = convSnap.data() as any;

  let inst = conv.instanceId ? await loadInstance(conv.instanceId) : null;
  if (!inst && conv.instanceId) inst = await ensureLegacyInstance(conv.instanceId);
  if (!inst) {
    res.status(400).json({ error: 'Esta conversa não está ligada a nenhum número de WhatsApp. Escolha um número para iniciar.' });
    return null;
  }

  const allowed = canManageInstance(user, inst) || conv.assignedTo === user.uid || (!conv.assignedTo && !inst.ownerId);
  if (!allowed) {
    res.status(403).json({ error: `Esta conversa é atendida por ${conv.assignedToName || inst.ownerName || 'outro vendedor'}. Peça a transferência para responder.` });
    return null;
  }
  if (inst.state !== 'connected') {
    res.status(409).json({ error: `O número "${inst.label}" está desconectado. Conecte-o em Integração WhatsApp.` });
    return null;
  }
  return { db, convRef, conv, inst };
}

async function recordOutgoing(
  ctx: { db: FirebaseFirestore.Firestore; convRef: FirebaseFirestore.DocumentReference; conv: any; inst: any },
  user: AuthedUser,
  msg: { body: string; mediaType: string; mediaUrl?: string | null; mediaMime?: string | null; fileName?: string | null },
  send: () => Promise<{ success: boolean; externalId?: string; error?: string }>
) {
  const { db, convRef, conv, inst } = ctx;
  const now = new Date().toISOString();
  const msgRef = convRef.collection('messages').doc();
  await msgRef.set({
    conversationId: convRef.id,
    instanceId: inst.id,
    leadId: conv.leadId || null,
    sender: 'user',
    fromMe: true,
    body: msg.body,
    status: 'sending',
    mediaType: msg.mediaType,
    mediaUrl: msg.mediaUrl || null,
    mediaMime: msg.mediaMime || null,
    fileName: msg.fileName || null,
    senderName: user.name,
    senderId: user.uid,
    timestamp: now,
  });

  let result: { success: boolean; externalId?: string; error?: string };
  try {
    result = await send();
  } catch (err: any) {
    result = { success: false, error: err?.message || String(err) };
  }

  if (!result.success) {
    await msgRef.update({ status: 'failed', errorMessage: result.error || 'Falha no envio' });
    return result;
  }

  const batch = db.batch();
  if (result.externalId) {
    batch.set(db.collection('idempotency_keys').doc(`${inst.id}_${result.externalId}`.replace(/\//g, '_')), {
      instanceId: inst.id,
      externalId: result.externalId,
      fromMe: true,
      conversationId: convRef.id,
      messagePath: msgRef.path,
      type: 'sent_by_crm',
      processedAt: new Date().toISOString(),
    });
  }
  batch.update(msgRef, { status: 'sent', externalId: result.externalId || null });
  const preview = msg.mediaType !== 'text' && msg.body ? msg.body : msg.body || mediaPlaceholder(msg.mediaType as any, msg.fileName || undefined);
  const convUpdates: Record<string, any> = {
    lastMessage: preview,
    lastMessageAt: now,
    lastMessageFromMe: true,
    updatedAt: now,
    status: 'open',
  };
  if (!conv.assignedTo) {
    convUpdates.assignedTo = user.uid;
    convUpdates.assignedToName = user.name;
  }
  batch.update(convRef, convUpdates);
  if (conv.leadId) {
    batch.update(db.collection('leads').doc(conv.leadId), { lastContactAt: now, updatedAt: now });
    batch.set(db.collection('activities').doc(), {
      leadId: conv.leadId,
      userId: user.uid,
      userName: user.name,
      type: 'whatsapp_sent',
      description: `Mensagem enviada por WhatsApp (${inst.label}): "${preview.slice(0, 50)}${preview.length > 50 ? '...' : ''}"`,
      metadata: { conversationId: convRef.id, instanceId: inst.id },
      timestamp: now,
    });
  }
  try {
    await batch.commit();
  } catch (err: any) {
    // A mensagem já saiu pelo WhatsApp; falha aqui é só de registro
    console.warn('[Send record warning]:', err?.message || err);
  }
  return result;
}

apiRouter.post('/whatsapp/send', requireUser(), async (req: AuthedRequest, res: Response) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Mensagem vazia.' });
  if (text.length > 4000) return res.status(400).json({ error: 'Mensagem muito longa (máx. 4000 caracteres).' });
  const ctx = await resolveConversationForSend(req, res);
  if (!ctx) return;
  const result = await recordOutgoing(ctx, req.user!, { body: text, mediaType: 'text' }, () =>
    evolutionService.sendText(ctx.inst.id, ctx.conv.phone, text)
  );
  if (!result.success) return res.status(502).json({ success: false, error: result.error });
  res.json({ success: true, externalId: result.externalId });
});

const MAX_MEDIA_BYTES = 3 * 1024 * 1024; // limite seguro para o corpo da requisição na Vercel

apiRouter.post('/whatsapp/send-media', requireUser(), async (req: AuthedRequest, res: Response) => {
  const base64 = String(req.body?.base64 || '');
  const mimetype = String(req.body?.mimetype || 'application/octet-stream');
  const fileName = String(req.body?.fileName || 'arquivo').slice(0, 120);
  const caption = String(req.body?.caption || '').slice(0, 1000);
  if (!base64) return res.status(400).json({ error: 'Arquivo vazio.' });
  const bytes = Math.floor((base64.replace(/^data:[^;]+;base64,/, '').length * 3) / 4);
  if (bytes > MAX_MEDIA_BYTES) return res.status(413).json({ error: 'Arquivo maior que 3 MB.' });

  const type: OutgoingMediaType = mimetype.startsWith('image/')
    ? 'image'
    : mimetype.startsWith('video/')
      ? 'video'
      : mimetype.startsWith('audio/')
        ? 'audio'
        : 'document';

  const ctx = await resolveConversationForSend(req, res);
  if (!ctx) return;

  const mediaUrl = await storeMediaFile(ctx.inst.id, `out_${Date.now()}`, base64, mimetype, type);
  const result = await recordOutgoing(
    ctx,
    req.user!,
    { body: caption, mediaType: type, mediaUrl, mediaMime: mimetype, fileName },
    () => evolutionService.sendMedia(ctx.inst.id, ctx.conv.phone, { type, base64, mimetype, fileName, caption })
  );
  if (!result.success) return res.status(502).json({ success: false, error: result.error });
  res.json({ success: true, externalId: result.externalId });
});

// ---------------------------------------------------------------------------
// Logs do webhook (gestores)
// ---------------------------------------------------------------------------

async function addWebhookLog(event: string, status: string, summary: string, instanceId?: string) {
  const { db } = getAdminFirestore();
  if (!db) return;
  const id = `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  try {
    await db.collection('webhook_logs').doc(id).set({
      id,
      timestamp: new Date().toISOString(),
      event,
      status,
      summary: summary.slice(0, 300),
      instanceId: instanceId || null,
    });
  } catch (err: any) {
    console.warn('[WebhookLog Warning]:', err?.message || err);
  }
}

apiRouter.get('/webhook/logs', requireUser('admin', 'manager'), async (_req: Request, res: Response) => {
  const db = dbOrFail(res);
  if (!db) return;
  const snap = await db.collection('webhook_logs').orderBy('timestamp', 'desc').limit(50).get();
  res.json({ logs: snap.docs.map((d) => d.data()) });
});

// ---------------------------------------------------------------------------
// Webhook da Evolution API
// ---------------------------------------------------------------------------

const recentlyProcessed = new Map<string, number>();
function seenRecently(key: string) {
  const now = Date.now();
  if (recentlyProcessed.size > 5000) {
    for (const [k, t] of recentlyProcessed) if (now - t > 10 * 60_000) recentlyProcessed.delete(k);
  }
  return recentlyProcessed.has(key);
}

apiRouter.post('/webhook/evolution', async (req: Request, res: Response) => {
  if (!evolutionService.validateWebhookRequest(req.headers as any, req.query as any)) {
    await addWebhookLog('UNKNOWN', 'unauthorized', 'Requisição recusada: segredo do webhook ausente ou inválido.');
    return res.status(401).json({ error: 'Webhook não autorizado' });
  }

  const payload = req.body || {};
  const event = normalizeEvent(payload.event || payload.type || req.headers['x-evolution-event']);
  const instanceName = String(
    (typeof payload.instance === 'string' ? payload.instance : payload.instance?.instanceName) || payload.instanceName || ''
  ).trim();

  const { db, error } = getAdminFirestore();
  if (!db) {
    console.error('[Webhook] banco indisponível:', error);
    return res.status(503).json({ error });
  }

  let inst = instanceName ? await loadInstance(instanceName) : null;
  if (!inst && instanceName) inst = await ensureLegacyInstance(instanceName);
  if (!inst) {
    await addWebhookLog(event, 'ignored', `Evento de um número que não está cadastrado no CRM ("${instanceName || 'sem nome'}").`);
    return res.status(200).json({ status: 'ignored_unknown_instance' });
  }

  try {
    if (event === 'MESSAGES_UPSERT' || event === 'SEND_MESSAGE') {
      const extracted = extractEvolutionMessage(payload);
      if (!extracted) {
        await addWebhookLog(event, 'error', 'Payload sem mensagem válida.', inst.id);
        return res.status(400).json({ error: 'Payload inválido' });
      }
      if (extracted.isGroup) return res.status(200).json({ status: 'ignored_group' });

      const dedupeKey = `${inst.id}_${extracted.externalId}`;
      if (seenRecently(dedupeKey)) return res.status(200).json({ status: 'ignored_duplicate' });

      // Mídia: usa o base64 do webhook ou baixa pela Evolution, e guarda no Storage
      let mediaUrl: string | null = null;
      if (extracted.mediaType !== 'text') {
        let b64 = extracted.mediaBase64 || null;
        let mime = extracted.mediaMime;
        if (!b64) {
          const data = Array.isArray(payload.data) ? payload.data[0] : payload.data;
          const fetched = await evolutionService.getMediaBase64(inst.id, data);
          if (fetched) {
            b64 = fetched.base64;
            mime = mime || fetched.mimetype;
          }
        }
        if (b64) mediaUrl = await storeMediaFile(inst.id, extracted.externalId, b64, mime, extracted.mediaType);
      }

      const r = await persistWebhookMessage(payload, instanceRef(inst), { mediaUrl, extracted });
      if (r.status === 'processed' || r.status === 'ignored_duplicate') {
        recentlyProcessed.set(dedupeKey, Date.now()); // marca somente após gravar
      }
      if (r.status === 'error') {
        await addWebhookLog(event, 'error', `Falha ao gravar mensagem: ${r.error}`, inst.id);
        return res.status(500).json({ status: 'error', error: r.error });
      }
      if (r.status === 'processed') {
        await addWebhookLog(event, 'processed', `Mensagem ${extracted.fromMe ? 'enviada' : 'recebida'} em "${inst.label}".`, inst.id);
      }
      return res.status(200).json(r);
    }

    if (event === 'MESSAGES_UPDATE') {
      await updateMessageStatus(inst.id, payload);
      return res.status(200).json({ status: 'status_updated' });
    }

    if (event === 'CONNECTION_UPDATE') {
      const d = payload.data || {};
      const state = mapRawState(d.state || d.status || payload.state);
      const updates: Record<string, any> = {
        state,
        lastEventAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastError: null,
      };
      if (d.wuid) updates.phone = String(d.wuid).replace(/@.+$/, '').replace(/:\d+$/, '');
      if (d.profileName) updates.profileName = d.profileName;
      if (d.profilePictureUrl) updates.profilePicUrl = d.profilePictureUrl;
      if (state === 'disconnected' && d.statusReason) updates.lastError = `Desconectado (código ${d.statusReason})`;
      await db.collection(INSTANCES).doc(inst.id).set(updates, { merge: true });
      await addWebhookLog(event, 'processed', `"${inst.label}": ${state}`, inst.id);
      return res.status(200).json({ status: 'connection_updated', state });
    }

    if (event === 'QRCODE_UPDATED') {
      await db.collection(INSTANCES).doc(inst.id).set(
        { state: 'connecting', lastEventAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { merge: true }
      );
      return res.status(200).json({ status: 'qrcode_updated' });
    }

    return res.status(200).json({ status: 'received', event });
  } catch (err: any) {
    await addWebhookLog(event, 'error', `Exceção: ${err?.message || err}`, inst.id);
    return res.status(500).json({ status: 'error', error: err?.message || 'Erro interno' });
  }
});

