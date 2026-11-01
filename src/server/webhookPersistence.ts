/**
 * Persistência dos eventos da Evolution API no Firestore, por número (instância).
 *
 * - Cada número de WhatsApp tem suas próprias conversas: ID determinístico
 *   `conv_<instância>_<telefone>`. O mesmo cliente falando com dois vendedores
 *   gera duas conversas separadas, cada uma respondida pelo número certo.
 * - Mensagens ficam em `conversations/{id}/messages` (consulta ordenada sem índice composto).
 * - Idempotência atômica por instância + ID externo da mensagem.
 * - Mídias (imagem, áudio, vídeo, documento) são salvas no Firebase Storage.
 */

import crypto from 'crypto';
import { getAdminFirestore, uploadToStorage, FieldValue } from './firebaseAdmin.ts';
import { normalizePhone, formatPhoneDisplay } from '../utils/formatters.ts';

export type MediaKind = 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker';

export interface WebhookMessageExtraction {
  externalId: string;
  fromMe: boolean;
  remoteJid: string;
  senderPhone: string;
  contactName: string;
  body: string;
  mediaType: MediaKind;
  mediaMime?: string;
  fileName?: string;
  mediaBase64?: string;
  timestamp: string;
  isGroup: boolean;
  isLid: boolean;
  /** true quando era @lid e não veio o telefone real */
  unresolvedLid: boolean;
}

export interface InstanceRef {
  id: string;
  label: string;
  ownerId: string | null;
  ownerName: string | null;
}

/** "messages.upsert" (v2) e "MESSAGES_UPSERT" (v1) viram "MESSAGES_UPSERT". */
export function normalizeEvent(raw: unknown): string {
  return String(raw || 'UNKNOWN')
    .trim()
    .toUpperCase()
    .replace(/[.\-\s]+/g, '_');
}

export function conversationIdFor(instanceId: string, phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const safeInstance = instanceId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `conv_${safeInstance}_${digits}`;
}

/**
 * Variações de um número brasileiro (com e sem o 9º dígito).
 */
export function getPhoneVariants(rawPhone: string): string[] {
  const normalized = normalizePhone(rawPhone);
  if (!normalized) return [];
  const digits = normalized.replace(/\D/g, '');
  const variants = new Set<string>([normalized]);
  if (digits.startsWith('55')) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    if (digits.length === 13 && rest.startsWith('9')) {
      variants.add(`+55${ddd}${rest.slice(1)}`);
    } else if (digits.length === 12) {
      variants.add(`+55${ddd}9${rest}`);
    }
  }
  return Array.from(variants);
}

function jidToPhone(jid: unknown): string {
  return String(jid || '')
    .replace(/@.+$/, '')
    .replace(/:\d+$/, '');
}

/**
 * Extrai dados padronizados do payload da Evolution API (v1 e v2).
 */
export function extractEvolutionMessage(payload: any): WebhookMessageExtraction | null {
  if (!payload) return null;

  const data = Array.isArray(payload.data) ? payload.data[0] : payload.data || payload;
  const key = data?.key || payload?.key;
  if (!key || !key.id) return null;

  const externalId = String(key.id);
  const fromMe = key.fromMe === true;
  const remoteJid = String(key.remoteJid || data?.remoteJid || '');
  const isGroup = remoteJid.endsWith('@g.us');
  const isLid = remoteJid.endsWith('@lid');

  let rawPhone = jidToPhone(remoteJid);
  let unresolvedLid = false;
  if (isLid) {
    // Contatos com identificador "@lid": a Evolution v2 envia o telefone real em campos alternativos.
    const alt =
      key.remoteJidAlt || key.senderPn || data?.senderPn || key.participantAlt || data?.remoteJidAlt || '';
    if (alt && !String(alt).endsWith('@lid')) {
      rawPhone = jidToPhone(alt);
    } else {
      unresolvedLid = true;
    }
  }

  const senderPhone = isGroup ? remoteJid : unresolvedLid ? `lid:${rawPhone}` : normalizePhone(rawPhone) || rawPhone;
  const pushName = String(data?.pushName || payload?.pushName || '').trim();
  const contactName =
    (!fromMe && pushName) || (isGroup ? 'Grupo WhatsApp' : unresolvedLid ? 'Contato WhatsApp' : formatPhoneDisplay(senderPhone));

  let msgObj = data?.message || payload?.message || {};
  // Mensagens efêmeras / "ver uma vez" vêm embrulhadas
  msgObj = msgObj.ephemeralMessage?.message || msgObj.viewOnceMessage?.message || msgObj.viewOnceMessageV2?.message || msgObj;

  let body = '';
  let mediaType: MediaKind = 'text';
  let mediaMime: string | undefined;
  let fileName: string | undefined;

  if (typeof msgObj.conversation === 'string') {
    body = msgObj.conversation;
  } else if (msgObj.extendedTextMessage?.text) {
    body = msgObj.extendedTextMessage.text;
  } else if (msgObj.imageMessage) {
    mediaType = 'image';
    body = msgObj.imageMessage.caption || '';
    mediaMime = msgObj.imageMessage.mimetype;
  } else if (msgObj.videoMessage) {
    mediaType = 'video';
    body = msgObj.videoMessage.caption || '';
    mediaMime = msgObj.videoMessage.mimetype;
  } else if (msgObj.audioMessage) {
    mediaType = 'audio';
    mediaMime = msgObj.audioMessage.mimetype;
  } else if (msgObj.documentMessage || msgObj.documentWithCaptionMessage) {
    const doc = msgObj.documentMessage || msgObj.documentWithCaptionMessage?.message?.documentMessage || {};
    mediaType = 'document';
    fileName = doc.fileName || doc.title || 'documento';
    body = doc.caption || '';
    mediaMime = doc.mimetype;
  } else if (msgObj.stickerMessage) {
    mediaType = 'sticker';
    mediaMime = msgObj.stickerMessage.mimetype || 'image/webp';
  } else if (msgObj.buttonsResponseMessage?.selectedDisplayText) {
    body = msgObj.buttonsResponseMessage.selectedDisplayText;
  } else if (msgObj.listResponseMessage?.title) {
    body = msgObj.listResponseMessage.title;
  } else if (msgObj.reactionMessage) {
    body = `Reagiu com ${msgObj.reactionMessage.text || 'um emoji'}`;
  } else if (msgObj.locationMessage) {
    const l = msgObj.locationMessage;
    body = `📍 Localização: https://maps.google.com/?q=${l.degreesLatitude},${l.degreesLongitude}`;
  } else if (msgObj.contactMessage) {
    body = `👤 Contato compartilhado: ${msgObj.contactMessage.displayName || ''}`;
  } else if (data?.body) {
    body = String(data.body);
  }

  const mediaBase64: string | undefined = msgObj.base64 || data?.message?.base64 || data?.base64 || undefined;

  let timestamp = new Date().toISOString();
  const rawTimestamp = data?.messageTimestamp || payload?.messageTimestamp;
  if (rawTimestamp) {
    const n = Number(rawTimestamp);
    const ms = n < 10000000000 ? n * 1000 : n;
    if (!isNaN(ms)) timestamp = new Date(ms).toISOString();
  }

  return {
    externalId,
    fromMe,
    remoteJid,
    senderPhone,
    contactName,
    body: body.trim(),
    mediaType,
    mediaMime,
    fileName,
    mediaBase64,
    timestamp,
    isGroup,
    isLid,
    unresolvedLid,
  };
}

export function mediaPlaceholder(type: MediaKind, fileName?: string): string {
  switch (type) {
    case 'image':
      return '📷 Imagem';
    case 'audio':
      return '🎤 Áudio';
    case 'video':
      return '🎬 Vídeo';
    case 'document':
      return `📄 ${fileName || 'Documento'}`;
    case 'sticker':
      return 'Figurinha';
    default:
      return 'Mensagem';
  }
}

function extensionFor(mime: string | undefined, type: MediaKind): string {
  const m = (mime || '').split(';')[0].trim();
  const map: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/webm': 'webm',
    'video/mp4': 'mp4',
    'application/pdf': 'pdf',
  };
  if (map[m]) return map[m];
  return type === 'audio' ? 'ogg' : type === 'image' ? 'jpg' : type === 'video' ? 'mp4' : 'bin';
}

/**
 * Salva um arquivo (base64) no Firebase Storage e devolve uma URL de download.
 * Retorna null se o Storage não estiver disponível — a mensagem é gravada mesmo assim.
 */
export async function storeMediaFile(
  folder: string,
  name: string,
  base64: string,
  mime: string | undefined,
  type: MediaKind
): Promise<string | null> {
  try {
    const clean = base64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(clean, 'base64');
    if (!buffer.length || buffer.length > 20 * 1024 * 1024) return null;
    const path = `whatsapp-media/${folder}/${name.replace(/[^a-zA-Z0-9_.-]/g, '_')}.${extensionFor(mime, type)}`;
    const token = crypto.randomUUID();
    const { bucket } = await uploadToStorage(path, buffer, (mime || 'application/octet-stream').split(';')[0], {
      firebaseStorageDownloadTokens: token,
    });
    return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
  } catch (err: any) {
    console.warn('[Media Storage Warning]:', err?.message || err);
    return null;
  }
}

export type PersistStatus = 'processed' | 'ignored_duplicate' | 'ignored_group' | 'error';

/**
 * Persiste uma mensagem recebida/enviada com controle transacional e idempotência.
 * `mediaUrl` já deve vir resolvida (o download/armazenamento acontece fora da transação).
 */
export async function persistWebhookMessage(
  payload: any,
  instance: InstanceRef,
  options: { mediaUrl?: string | null; extracted?: WebhookMessageExtraction | null } = {}
): Promise<{ success: boolean; status: PersistStatus; externalId?: string; conversationId?: string; error?: string }> {
  const extracted = options.extracted ?? extractEvolutionMessage(payload);
  if (!extracted) {
    return {
      success: false,
      status: 'error',
      error: 'Payload da Evolution API não contém mensagem válida ou identificador key.id.',
    };
  }

  const { externalId, fromMe, senderPhone, contactName, mediaType, mediaMime, fileName, timestamp, isGroup } = extracted;
  if (isGroup) return { success: true, status: 'ignored_group', externalId };

  const body = extracted.body || mediaPlaceholder(mediaType, fileName);
  const preview = mediaType !== 'text' && extracted.body ? `${mediaPlaceholder(mediaType, fileName)}: ${extracted.body}` : body;

  const { db, error: adminError } = getAdminFirestore();
  if (!db) {
    return { success: false, status: 'error', externalId, error: adminError || 'Banco indisponível.' };
  }

  const idempRef = db.collection('idempotency_keys').doc(`${instance.id}_${externalId}`.replace(/\//g, '_'));

  try {
    const result = await db.runTransaction(async (tx) => {
      // 1. Idempotência
      const idempSnap = await tx.get(idempRef);
      if (idempSnap.exists) {
        return { status: 'ignored_duplicate' as const, conversationId: (idempSnap.data() as any)?.conversationId };
      }

      // 2. Conversa existente (por ID determinístico, testando variações do 9º dígito)
      const variants = senderPhone.startsWith('lid:') ? [senderPhone] : getPhoneVariants(senderPhone);
      let convSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      for (const phone of variants) {
        const snap = await tx.get(db.collection('conversations').doc(conversationIdFor(instance.id, phone)));
        if (snap.exists) {
          convSnap = snap;
          break;
        }
      }

      // 3. Lead correspondente
      let leadSnap: FirebaseFirestore.DocumentSnapshot | null = null;
      const convLeadId = (convSnap?.data() as any)?.leadId || null;
      if (convLeadId) {
        const s = await tx.get(db.collection('leads').doc(convLeadId));
        if (s.exists) leadSnap = s;
      } else if (!senderPhone.startsWith('lid:')) {
        for (const phone of variants) {
          const q = await tx.get(db.collection('leads').where('phone', '==', phone).limit(1));
          if (!q.empty) {
            leadSnap = q.docs[0];
            break;
          }
        }
      }
      const lead = (leadSnap?.data() as any) || null;
      const leadId = leadSnap?.id || null;

      // --- gravações ---
      const convRef = convSnap ? convSnap.ref : db.collection('conversations').doc(conversationIdFor(instance.id, variants[0] || senderPhone));
      const msgRef = convRef.collection('messages').doc();

      tx.set(idempRef, {
        instanceId: instance.id,
        externalId,
        fromMe,
        conversationId: convRef.id,
        messagePath: msgRef.path,
        processedAt: new Date().toISOString(),
      });

      if (convSnap) {
        const current = convSnap.data() as any;
        const updates: Record<string, any> = {
          lastMessage: preview,
          lastMessageAt: timestamp,
          lastMessageFromMe: fromMe,
          updatedAt: timestamp,
          status: 'open',
        };
        if (!fromMe) updates.unreadCount = FieldValue.increment(1);
        if (!current?.leadId && leadId) {
          updates.leadId = leadId;
          if (lead?.name) updates.contactName = lead.name;
        } else if (!fromMe && !current?.leadId && contactName && current?.contactName !== contactName && /^\+?\d/.test(current?.contactName || '')) {
          // Nome real do contato chegou depois: substitui o número exibido
          updates.contactName = contactName;
        }
        if (!current?.assignedTo) {
          updates.assignedTo = lead?.ownerId || instance.ownerId || null;
          updates.assignedToName = lead?.ownerName || instance.ownerName || null;
        }
        tx.update(convRef, updates);
      } else {
        tx.set(convRef, {
          phone: variants[0] || senderPhone,
          contactName: lead?.name || contactName || formatPhoneDisplay(senderPhone),
          leadId,
          instanceId: instance.id,
          instanceLabel: instance.label,
          lastMessage: preview,
          lastMessageAt: timestamp,
          lastMessageFromMe: fromMe,
          unreadCount: fromMe ? 0 : 1,
          assignedTo: lead?.ownerId || instance.ownerId || null,
          assignedToName: lead?.ownerName || instance.ownerName || null,
          status: 'open',
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }

      tx.set(msgRef, {
        conversationId: convRef.id,
        instanceId: instance.id,
        leadId,
        externalId,
        sender: fromMe ? 'user' : 'contact',
        fromMe,
        body,
        status: fromMe ? 'sent' : 'delivered',
        mediaType,
        mediaUrl: options.mediaUrl || null,
        mediaMime: mediaMime || null,
        fileName: fileName || null,
        senderName: fromMe ? 'Celular' : null,
        timestamp,
      });

      if (leadId) {
        tx.update(db.collection('leads').doc(leadId), { lastContactAt: timestamp, updatedAt: timestamp });
        tx.set(db.collection('activities').doc(), {
          leadId,
          userId: lead?.ownerId || 'system',
          userName: fromMe ? instance.ownerName || 'Vendedor' : lead?.name || contactName,
          type: fromMe ? 'whatsapp_sent' : 'whatsapp_received',
          description: `${fromMe ? 'Mensagem enviada' : 'Mensagem recebida'} por WhatsApp (${instance.label}): "${preview.slice(0, 60)}${preview.length > 60 ? '...' : ''}"`,
          metadata: { externalId, conversationId: convRef.id, instanceId: instance.id, fromMe },
          timestamp,
        });
      }

      return { status: 'processed' as const, conversationId: convRef.id };
    });

    return { success: true, status: result.status, externalId, conversationId: result.conversationId };
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error('[WebhookPersistence Error]:', msg);
    return { success: false, status: 'error', externalId, error: msg };
  }
}

/** Mapeia o status de entrega (MESSAGES_UPDATE) para o status do CRM. */
export function mapAckStatus(raw: unknown): 'sent' | 'delivered' | 'read' | null {
  const s = String(raw ?? '').toUpperCase();
  if (s === 'READ' || s === 'PLAYED' || s === '4' || s === '5') return 'read';
  if (s === 'DELIVERY_ACK' || s === '3') return 'delivered';
  if (s === 'SERVER_ACK' || s === '2') return 'sent';
  return null;
}

const STATUS_RANK: Record<string, number> = { sending: 0, failed: 0, sent: 1, delivered: 2, read: 3 };

/** Atualiza ✓ / ✓✓ / lido de uma mensagem enviada. */
export async function updateMessageStatus(instanceId: string, payload: any): Promise<boolean> {
  const { db } = getAdminFirestore();
  if (!db) return false;
  const items = Array.isArray(payload?.data) ? payload.data : [payload?.data || payload];
  let updated = false;
  for (const d of items) {
    const externalId = d?.keyId || d?.key?.id || d?.id;
    const status = mapAckStatus(d?.status ?? d?.update?.status);
    if (!externalId || !status) continue;
    const idemp = await db.collection('idempotency_keys').doc(`${instanceId}_${externalId}`.replace(/\//g, '_')).get();
    const path = (idemp.data() as any)?.messagePath;
    if (!path) continue;
    const ref = db.doc(path);
    const snap = await ref.get();
    const current = (snap.data() as any)?.status || 'sent';
    if ((STATUS_RANK[status] ?? 0) > (STATUS_RANK[current] ?? 0)) {
      await ref.update({ status });
      updated = true;
    }
  }
  return updated;
}
