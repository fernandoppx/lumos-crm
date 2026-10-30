/**
 * Módulo de persistência transacional e idempotente para webhooks da Evolution API no Lumus CRM.
 * 
 * Requisitos atendidos:
 * - Idempotência atômica por instância e ID externo da mensagem.
 * - Suporte a transações no Firestore com todas as leituras antes das gravações.
 * - Tratamento de contatos desconhecidos, grupos (@g.us) e identificadores @lid.
 * - Normalização de telefones brasileiros e correspondência inteligente com leads existentes.
 * - Preservação dos modelos de dados (messages, conversations, leads, activities).
 * - Prevenção de duplicação para mensagens fromMe=true enviadas pelo CRM.
 */

import { getAdminFirestore, FieldValue } from './firebaseAdmin.ts';
import { normalizePhone, formatPhoneDisplay } from '../utils/formatters.ts';

export interface WebhookMessageExtraction {
  externalId: string;
  fromMe: boolean;
  remoteJid: string;
  senderPhone: string;
  contactName: string;
  body: string;
  mediaType: 'text' | 'image' | 'audio' | 'document';
  mediaUrl?: string;
  timestamp: string;
  isGroup: boolean;
  isLid: boolean;
}

/**
 * Normaliza número brasileiro considerando variações do 9º dígito (DDD + 8 ou 9 dígitos)
 */
export function getPhoneVariants(rawPhone: string): string[] {
  const normalized = normalizePhone(rawPhone);
  if (!normalized) return [];

  const digits = normalized.replace(/\D/g, '');
  const variants = new Set<string>([normalized]);

  // Se é número brasileiro (DDI 55)
  if (digits.startsWith('55')) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);

    // Se tem 13 dígitos no total (55 + DDD + 9 dígitos), cria variante sem o 9º dígito se começar com 9
    if (digits.length === 13 && rest.startsWith('9')) {
      const eightDigit = `+55${ddd}${rest.slice(1)}`;
      variants.add(eightDigit);
    }
    // Se tem 12 dígitos no total (55 + DDD + 8 dígitos), cria variante adicionando o 9 na frente
    else if (digits.length === 12) {
      const nineDigit = `+55${ddd}9${rest}`;
      variants.add(nineDigit);
    }
  }

  return Array.from(variants);
}

/**
 * Extrai dados padronizados do payload da Evolution API
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

  // Identifica telefone real do remetente
  let rawPhone = remoteJid.replace(/@.+$/, '');
  if (isLid && (key.participant || data.participant)) {
    rawPhone = String(key.participant || data.participant).replace(/@.+$/, '');
  }

  const senderPhone = isGroup ? remoteJid : normalizePhone(rawPhone) || rawPhone;
  const pushName = data?.pushName || payload?.pushName || '';
  const contactName = pushName.trim() || (isGroup ? 'Grupo WhatsApp' : formatPhoneDisplay(senderPhone));

  // Extrai texto de múltiplos formatos suportados pela Evolution API
  const msgObj = data?.message || payload?.message || {};
  let body = '';
  let mediaType: 'text' | 'image' | 'audio' | 'document' = 'text';
  let mediaUrl: string | undefined = undefined;

  if (typeof msgObj.conversation === 'string') {
    body = msgObj.conversation;
  } else if (msgObj.extendedTextMessage?.text) {
    body = msgObj.extendedTextMessage.text;
  } else if (msgObj.imageMessage) {
    mediaType = 'image';
    body = msgObj.imageMessage.caption || '[Imagem]';
    mediaUrl = msgObj.imageMessage.url;
  } else if (msgObj.audioMessage) {
    mediaType = 'audio';
    body = '[Mensagem de Áudio]';
    mediaUrl = msgObj.audioMessage.url;
  } else if (msgObj.documentMessage) {
    mediaType = 'document';
    body = msgObj.documentMessage.fileName || msgObj.documentMessage.caption || '[Documento]';
    mediaUrl = msgObj.documentMessage.url;
  } else if (msgObj.buttonsResponseMessage?.selectedDisplayText) {
    body = msgObj.buttonsResponseMessage.selectedDisplayText;
  } else if (msgObj.listResponseMessage?.title) {
    body = msgObj.listResponseMessage.title;
  } else if (data?.body) {
    body = String(data.body);
  }

  // Timestamp
  let timestamp = new Date().toISOString();
  const rawTimestamp = data?.messageTimestamp || payload?.messageTimestamp;
  if (rawTimestamp) {
    const ms = typeof rawTimestamp === 'number' && rawTimestamp < 10000000000 ? rawTimestamp * 1000 : Number(rawTimestamp);
    if (!isNaN(ms)) {
      timestamp = new Date(ms).toISOString();
    }
  }

  return {
    externalId,
    fromMe,
    remoteJid,
    senderPhone,
    contactName,
    body: body.trim() || (fromMe ? 'Mensagem enviada' : 'Mensagem recebida'),
    mediaType,
    mediaUrl,
    timestamp,
    isGroup,
    isLid,
  };
}

/**
 * Persiste a mensagem no Firestore com controle transacional e idempotência
 */
export async function persistWebhookMessage(
  payload: any,
  instanceName: string
): Promise<{
  success: boolean;
  status: 'processed' | 'ignored_duplicate' | 'ignored_group' | 'error';
  externalId?: string;
  conversationId?: string;
  error?: string;
}> {
  const extracted = extractEvolutionMessage(payload);
  if (!extracted) {
    return {
      success: false,
      status: 'error',
      error: 'Payload da Evolution API não contém mensagem válida ou identificador key.id.',
    };
  }

  const { externalId, fromMe, senderPhone, contactName, body, mediaType, mediaUrl, timestamp, isGroup } = extracted;

  // Se for grupo de WhatsApp (@g.us), ignorar para atendimento individual comercial
  if (isGroup) {
    return {
      success: true,
      status: 'ignored_group',
      externalId,
    };
  }

  const { db, error: adminError } = getAdminFirestore();
  if (!db || adminError) {
    // Retorna erro estruturado informando a indisponibilidade do banco
    return {
      success: false,
      status: 'error',
      externalId,
      error: adminError || 'Firebase Admin não pôde ser inicializado.',
    };
  }

  const idempotencyKey = `${instanceName}_${externalId}`;
  const idempRef = db.collection('idempotency_keys').doc(idempotencyKey);

  try {
    const result = await db.runTransaction(async (transaction) => {
      // 1. LEITURA 1: Idempotência atômica
      const idempSnap = await transaction.get(idempRef);
      if (idempSnap.exists) {
        return {
          status: 'ignored_duplicate' as const,
          externalId,
        };
      }

      // 2. LEITURA 2: Verifica se mensagem já existe no banco por externalId
      // (Protege contra mensagens fromMe gravadas anteriormente pelo CRM)
      const existingMsgQuery = db.collection('messages').where('externalId', '==', externalId).limit(1);
      const existingMsgSnap = await transaction.get(existingMsgQuery);
      if (!existingMsgSnap.empty) {
        // Marca na idempotência e encerra sem duplicar
        transaction.set(idempRef, {
          instanceName,
          externalId,
          type: fromMe ? 'sent_by_crm' : 'duplicate_existing',
          processedAt: new Date().toISOString(),
        });
        return {
          status: 'ignored_duplicate' as const,
          externalId,
        };
      }

      // 3. LEITURA 3: Busca conversa existente pelos telefones (variantes de DDD e 9º dígito)
      const phoneVariants = getPhoneVariants(senderPhone);
      let existingConvDoc: FirebaseFirestore.DocumentSnapshot | null = null;

      for (const phone of phoneVariants) {
        const convQuery = db.collection('conversations').where('phone', '==', phone).limit(1);
        const convSnap = await transaction.get(convQuery);
        if (!convSnap.empty) {
          existingConvDoc = convSnap.docs[0];
          break;
        }
      }

      // 4. LEITURA 4: Busca se existe Lead correspondente caso a conversa não tenha leadId
      let matchedLeadDoc: FirebaseFirestore.DocumentSnapshot | null = null;
      let matchedLeadId: string | null = (existingConvDoc?.data() as any)?.leadId || null;

      if (!matchedLeadId) {
        for (const phone of phoneVariants) {
          const leadQuery = db.collection('leads').where('phone', '==', phone).limit(1);
          const leadSnap = await transaction.get(leadQuery);
          if (!leadSnap.empty) {
            matchedLeadDoc = leadSnap.docs[0];
            matchedLeadId = matchedLeadDoc.id;
            break;
          }
        }
      } else {
        const leadRef = db.collection('leads').doc(matchedLeadId);
        matchedLeadDoc = await transaction.get(leadRef);
      }

      // --- TODAS AS LEITURAS FORAM CONCLUÍDAS. INICIANDO GRAVAÇÕES ATÔMICAS ---

      // A. Grava chave de idempotência
      transaction.set(idempRef, {
        instanceName,
        externalId,
        fromMe,
        phone: senderPhone,
        processedAt: new Date().toISOString(),
      });

      // B. Resolve ou Cria a Conversa
      let convRef: FirebaseFirestore.DocumentReference;
      let conversationId: string;
      const leadData = matchedLeadDoc?.data() as any;

      if (existingConvDoc && existingConvDoc.exists) {
        convRef = existingConvDoc.ref;
        conversationId = existingConvDoc.id;
        const currentData = existingConvDoc.data() as any;

        // Atualização da conversa existente
        const convUpdates: Record<string, any> = {
          lastMessage: body,
          lastMessageAt: timestamp,
          updatedAt: timestamp,
        };

        // Incrementa não lidas se recebida de cliente
        if (!fromMe) {
          convUpdates.unreadCount = FieldValue.increment(1);
        }

        // Se encontrou lead e conversa não tinha leadId
        if (!currentData?.leadId && matchedLeadId) {
          convUpdates.leadId = matchedLeadId;
          if (leadData?.name) {
            convUpdates.contactName = leadData.name;
          }
        }

        transaction.update(convRef, convUpdates);
      } else {
        // Cria nova conversa com ID determinístico baseado no telefone
        const cleanDigits = senderPhone.replace(/\D/g, '');
        convRef = db.collection('conversations').doc(`conv_${cleanDigits || externalId}`);
        conversationId = convRef.id;

        const newConvData = {
          phone: senderPhone,
          contactName: leadData?.name || contactName || formatPhoneDisplay(senderPhone),
          leadId: matchedLeadId || null,
          lastMessage: body,
          lastMessageAt: timestamp,
          unreadCount: fromMe ? 0 : 1,
          assignedTo: leadData?.ownerId || null,
          status: 'open',
          updatedAt: timestamp,
        };

        transaction.set(convRef, newConvData);
      }

      // C. Grava Mensagem
      const msgRef = db.collection('messages').doc();
      const messageData = {
        conversationId,
        leadId: matchedLeadId || null,
        externalId,
        sender: fromMe ? 'user' : 'contact',
        fromMe,
        body,
        status: fromMe ? 'sent' : 'delivered',
        mediaType,
        mediaUrl: mediaUrl || null,
        timestamp,
      };
      transaction.set(msgRef, messageData);

      // D. Se associada a um Lead, atualiza lastContactAt e adiciona Activity de auditoria
      if (matchedLeadId && matchedLeadDoc && matchedLeadDoc.exists) {
        const leadRef = db.collection('leads').doc(matchedLeadId);
        transaction.update(leadRef, {
          lastContactAt: timestamp,
          updatedAt: timestamp,
        });

        const actRef = db.collection('activities').doc();
        const activityData = {
          leadId: matchedLeadId,
          userId: leadData?.ownerId || 'system',
          userName: fromMe ? (leadData?.ownerName || 'Vendedor') : (leadData?.name || contactName),
          type: fromMe ? 'whatsapp_sent' : 'whatsapp_received',
          description: fromMe
            ? `Mensagem enviada por WhatsApp: "${body.slice(0, 60)}${body.length > 60 ? '...' : ''}"`
            : `Mensagem recebida por WhatsApp: "${body.slice(0, 60)}${body.length > 60 ? '...' : ''}"`,
          metadata: {
            externalId,
            conversationId,
            fromMe,
          },
          timestamp,
        };
        transaction.set(actRef, activityData);
      }

      return {
        status: 'processed' as const,
        externalId,
        conversationId,
      };
    });

    return {
      success: true,
      status: result.status,
      externalId: result.externalId,
      conversationId: result.conversationId,
    };
  } catch (err: any) {
    const msg = err.message || String(err);
    console.error('[WebhookPersistence Error]:', msg);
    return {
      success: false,
      status: 'error',
      externalId,
      error: msg,
    };
  }
}
