/**
 * Testes de unidade da extração de mensagens da Evolution API (v1 e v2).
 * Rodar: npx tsx src/server/__tests__/webhookPersistence.test.ts
 */

import {
  extractEvolutionMessage,
  getPhoneVariants,
  normalizeEvent,
  mapAckStatus,
  conversationIdFor,
} from '../webhookPersistence.ts';
import { makeInstanceName, mapRawState } from '../evolutionService.ts';

let passed = 0;
let total = 0;
function assert(condition: boolean, name: string, details?: any) {
  total++;
  if (condition) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    console.error(`  ❌ ${name}`, details ?? '');
    process.exitCode = 1;
  }
}

console.log('\n▶ Eventos e status');
assert(normalizeEvent('messages.upsert') === 'MESSAGES_UPSERT', 'v2 "messages.upsert" → MESSAGES_UPSERT');
assert(normalizeEvent('MESSAGES_UPDATE') === 'MESSAGES_UPDATE', 'v1 MESSAGES_UPDATE mantido');
assert(normalizeEvent('connection.update') === 'CONNECTION_UPDATE', 'connection.update → CONNECTION_UPDATE');
assert(normalizeEvent('send.message') === 'SEND_MESSAGE', 'send.message → SEND_MESSAGE');
assert(mapAckStatus('READ') === 'read' && mapAckStatus(4) === 'read', 'confirmação de leitura');
assert(mapAckStatus('DELIVERY_ACK') === 'delivered' && mapAckStatus(3) === 'delivered', 'confirmação de entrega');
assert(mapAckStatus('PENDING') === null, 'status desconhecido ignorado');
assert(mapRawState('open') === 'connected' && mapRawState('close') === 'disconnected' && mapRawState('connecting') === 'connecting', 'estado da conexão');

console.log('\n▶ Telefones e IDs');
const v = getPhoneVariants('5512988887777');
assert(v.includes('+5512988887777') && v.includes('+551288887777'), 'variantes com e sem 9º dígito', v);
const v2 = getPhoneVariants('551288887777');
assert(v2.includes('+5512988887777'), 'número de 12 dígitos ganha variante com 9', v2);
assert(conversationIdFor('lumos-ana-ab12', '+5512988887777') === 'conv_lumos-ana-ab12_5512988887777', 'ID de conversa por número + telefone');
const name = makeInstanceName('Vendas Ação São João!');
assert(/^lumos-vendas-acao-sao-joao-[0-9a-f]{6}$/.test(name), 'nome de instância seguro e sem acentos', name);

console.log('\n▶ Extração de mensagens');
const text = extractEvolutionMessage({
  event: 'messages.upsert',
  instance: 'x',
  data: {
    key: { id: 'A1', fromMe: false, remoteJid: '5512988887777@s.whatsapp.net' },
    pushName: 'Maria',
    message: { conversation: 'Oi, quero orçamento' },
    messageTimestamp: 1761850000,
  },
});
assert(text?.body === 'Oi, quero orçamento' && text.senderPhone === '+5512988887777' && text.contactName === 'Maria', 'texto simples', text);
assert(text?.timestamp === new Date(1761850000 * 1000).toISOString(), 'timestamp em segundos convertido');

const img = extractEvolutionMessage({
  data: {
    key: { id: 'A2', fromMe: false, remoteJid: '5512988887777@s.whatsapp.net' },
    message: { imageMessage: { caption: 'foto', mimetype: 'image/jpeg' }, base64: 'AAAA' },
  },
});
assert(img?.mediaType === 'image' && img.body === 'foto' && img.mediaBase64 === 'AAAA' && img.mediaMime === 'image/jpeg', 'imagem com base64 do webhook', img);

const audio = extractEvolutionMessage({
  data: { key: { id: 'A3', remoteJid: '5512988887777@s.whatsapp.net' }, message: { audioMessage: { mimetype: 'audio/ogg; codecs=opus' } } },
});
assert(audio?.mediaType === 'audio' && audio.body === '', 'áudio sem texto', audio);

const docMsg = extractEvolutionMessage({
  data: { key: { id: 'A4', remoteJid: '5512988887777@s.whatsapp.net' }, message: { documentMessage: { fileName: 'proposta.pdf', mimetype: 'application/pdf' } } },
});
assert(docMsg?.mediaType === 'document' && docMsg.fileName === 'proposta.pdf', 'documento com nome', docMsg);

const lid = extractEvolutionMessage({
  data: { key: { id: 'A5', remoteJid: '123456789012345@lid', remoteJidAlt: '5511977776666@s.whatsapp.net' }, message: { conversation: 'oi' } },
});
assert(lid?.senderPhone === '+5511977776666' && !lid.unresolvedLid, 'contato @lid resolvido pelo remoteJidAlt', lid);

const lidUnknown = extractEvolutionMessage({
  data: { key: { id: 'A6', remoteJid: '123456789012345@lid' }, message: { conversation: 'oi' } },
});
assert(lidUnknown?.unresolvedLid === true && lidUnknown.senderPhone.startsWith('lid:'), 'contato @lid sem telefone fica marcado', lidUnknown);

const group = extractEvolutionMessage({ data: { key: { id: 'A7', remoteJid: '120363@g.us' }, message: { conversation: 'oi' } } });
assert(group?.isGroup === true, 'grupo detectado');

const eph = extractEvolutionMessage({
  data: { key: { id: 'A8', remoteJid: '5512988887777@s.whatsapp.net' }, message: { ephemeralMessage: { message: { extendedTextMessage: { text: 'temporária' } } } } },
});
assert(eph?.body === 'temporária', 'mensagem temporária desembrulhada', eph);

const mine = extractEvolutionMessage({
  data: { key: { id: 'A9', fromMe: true, remoteJid: '5512988887777@s.whatsapp.net' }, pushName: 'Vendedor', message: { conversation: 'ok' } },
});
assert(mine?.fromMe === true && mine.contactName !== 'Vendedor', 'mensagem enviada pelo celular não troca o nome do cliente', mine);

assert(extractEvolutionMessage({ data: {} }) === null, 'payload sem key.id é rejeitado');

console.log(`\nResultado: ${passed}/${total} testes passaram\n`);
