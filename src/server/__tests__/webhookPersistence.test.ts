/**
 * Suíte de testes automatizados para recebimento, extração,
 * normalização de telefones, idempotência e persistência de mensagens da Evolution API no Lumus CRM.
 */

import { extractEvolutionMessage, getPhoneVariants } from '../webhookPersistence.ts';
import { evolutionService } from '../evolutionService.ts';

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, details?: any) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ PASS: ${testName}`);
  } else {
    console.error(`  ❌ FAIL: ${testName}`, details || '');
    throw new Error(`Falha no teste: ${testName}`);
  }
}

async function runTestSuite() {
  console.log('====================================================');
  console.log(' INICIANDO TESTES DO WEBHOOK EVOLUTION API NO CRM  ');
  console.log('====================================================\n');

  // ----------------------------------------------------
  // TESTE 1: Extração de Mensagem de Texto Padrão (conversation)
  // ----------------------------------------------------
  console.log('--- Teste 1: Formatos de Mensagem ---');
  const simplePayload = {
    event: 'messages.upsert',
    instance: 'lumus-crm',
    data: {
      key: {
        remoteJid: '5511987654321@s.whatsapp.net',
        fromMe: false,
        id: 'EVO_MSG_001',
      },
      pushName: 'Carlos Silva',
      message: {
        conversation: 'Olá! Gostaria de uma cotação para o software.',
      },
      messageTimestamp: 1711800000,
    },
  };

  const extractedSimple = extractEvolutionMessage(simplePayload);
  assert(extractedSimple !== null, 'Payload simples deve ser extraído');
  assert(extractedSimple?.externalId === 'EVO_MSG_001', 'externalId deve ser EVO_MSG_001');
  assert(extractedSimple?.fromMe === false, 'fromMe deve ser false');
  assert(extractedSimple?.body === 'Olá! Gostaria de uma cotação para o software.', 'Texto do body extraído corretamente');
  assert(extractedSimple?.contactName === 'Carlos Silva', 'Nome do contato Carlos Silva');
  assert(extractedSimple?.isGroup === false, 'Não deve ser grupo');
  assert(extractedSimple?.isLid === false, 'Não deve ser LID');

  // ----------------------------------------------------
  // TESTE 2: Mensagem de Texto Estendida (extendedTextMessage)
  // ----------------------------------------------------
  const extendedPayload = {
    data: {
      key: {
        remoteJid: '5521998877665@s.whatsapp.net',
        fromMe: true,
        id: 'EVO_MSG_EXT_002',
      },
      pushName: 'Vendedor Lumus',
      message: {
        extendedTextMessage: {
          text: 'Segue nossa proposta comercial atualizada.',
        },
      },
      messageTimestamp: 1711800010,
    },
  };

  const extractedExt = extractEvolutionMessage(extendedPayload);
  assert(extractedExt !== null, 'Payload estendido deve ser extraído');
  assert(extractedExt?.externalId === 'EVO_MSG_EXT_002', 'externalId deve ser EVO_MSG_EXT_002');
  assert(extractedExt?.fromMe === true, 'fromMe deve ser true');
  assert(extractedExt?.body === 'Segue nossa proposta comercial atualizada.', 'Texto estendido extraído');

  // ----------------------------------------------------
  // TESTE 3: Mensagens de Mídia (Imagem com Legenda, Áudio, Documento)
  // ----------------------------------------------------
  console.log('\n--- Teste 2: Mídias e Botões ---');
  const imagePayload = {
    data: {
      key: { remoteJid: '5511987654321@s.whatsapp.net', fromMe: false, id: 'EVO_IMG_003' },
      message: {
        imageMessage: {
          caption: 'Foto do comprovante de pagamento',
          url: 'https://example.com/media/recibo.jpg',
        },
      },
    },
  };
  const extractedImg = extractEvolutionMessage(imagePayload);
  assert(extractedImg?.mediaType === 'image', 'Tipo de mídia deve ser image');
  assert(extractedImg?.body === 'Foto do comprovante de pagamento', 'Legenda da imagem extraída no body');
  assert(extractedImg?.mediaUrl === 'https://example.com/media/recibo.jpg', 'URL da imagem extraída');

  const audioPayload = {
    data: {
      key: { remoteJid: '5511987654321@s.whatsapp.net', fromMe: false, id: 'EVO_AUD_004' },
      message: {
        audioMessage: {
          url: 'https://example.com/audio/voice.ogg',
        },
      },
    },
  };
  const extractedAudio = extractEvolutionMessage(audioPayload);
  assert(extractedAudio?.mediaType === 'audio', 'Tipo de mídia audio');
  assert(extractedAudio?.body === '[Mensagem de Áudio]', 'Body padrão para áudio');

  // ----------------------------------------------------
  // TESTE 4: Mensagens de Grupos (@g.us) e Filtro Comercial
  // ----------------------------------------------------
  console.log('\n--- Teste 3: Grupos e LIDs ---');
  const groupPayload = {
    data: {
      key: {
        remoteJid: '120363024849182394@g.us',
        participant: '5511987654321@s.whatsapp.net',
        fromMe: false,
        id: 'EVO_GRP_005',
      },
      message: {
        conversation: 'Mensagem enviada no grupo comercial',
      },
    },
  };
  const extractedGroup = extractEvolutionMessage(groupPayload);
  assert(extractedGroup?.isGroup === true, 'Mensagem com @g.us identificada como grupo');
  assert(extractedGroup?.contactName === 'Grupo WhatsApp', 'Nome padrão para grupo');

  // ----------------------------------------------------
  // TESTE 5: Identificadores @lid do WhatsApp
  // ----------------------------------------------------
  const lidPayload = {
    data: {
      key: {
        remoteJid: '159283748291029@lid',
        participant: '5511987654321@s.whatsapp.net',
        fromMe: false,
        id: 'EVO_LID_006',
      },
      message: {
        conversation: 'Olá via identificador LID',
      },
    },
  };
  const extractedLid = extractEvolutionMessage(lidPayload);
  assert(extractedLid?.isLid === true, 'Identificado como @lid');
  assert(Boolean(extractedLid?.senderPhone?.includes('5511987654321')), 'Extrai telefone do participante real quando remoteJid for @lid');

  // ----------------------------------------------------
  // TESTE 6: Normalização de Telefones Brasileiros e Variantes do 9º Dígito
  // ----------------------------------------------------
  console.log('\n--- Teste 4: Normalização e 9º Dígito Brasileiro ---');
  const variants13 = getPhoneVariants('+55 11 98765-4321');
  assert(variants13.length === 2, 'Número BR de 9 dígitos deve gerar 2 variantes (com e sem o 9)');
  assert(variants13.includes('+5511987654321'), 'Variante com 9 dígitos presente');
  assert(variants13.includes('+551187654321'), 'Variante legada de 8 dígitos presente');

  const variants12 = getPhoneVariants('551187654321');
  assert(variants12.length === 2, 'Número BR de 8 dígitos deve gerar 2 variantes');
  assert(variants12.includes('+551187654321'), 'Variante de 8 dígitos mantida');
  assert(variants12.includes('+5511987654321'), 'Variante expandida com o 9 presente');

  // ----------------------------------------------------
  // TESTE 7: Idempotência em Memória e Desduplicação
  // ----------------------------------------------------
  console.log('\n--- Teste 5: Idempotência de Mensagens ---');
  const testMsgId = 'MSG_TEST_IDEMP_' + Date.now();
  const firstCheck = evolutionService.isMessageAlreadyProcessed(testMsgId);
  assert(firstCheck === false, 'Primeira ocorrência do ID não deve ser considerada duplicada');
  const secondCheck = evolutionService.isMessageAlreadyProcessed(testMsgId);
  assert(secondCheck === true, 'Segunda ocorrência do mesmo ID DEVE ser detectada como duplicada');

  // ----------------------------------------------------
  // TESTE 8: Validação de Segurança do Webhook (WEBHOOK_SECRET)
  // ----------------------------------------------------
  console.log('\n--- Teste 6: Validação de Segurança do Webhook ---');
  // Se WEBHOOK_SECRET estiver configurado no .env, deve exigir chave válida
  const secret = process.env.WEBHOOK_SECRET;
  if (secret) {
    const validHeader = evolutionService.validateWebhookRequest({ 'x-webhook-secret': secret }, {});
    assert(validHeader === true, 'Validação com cabeçalho x-webhook-secret correto');

    const validQuery = evolutionService.validateWebhookRequest({}, { secret });
    assert(validQuery === true, 'Validação com query param secret correto');

    const invalidHeader = evolutionService.validateWebhookRequest({ 'x-webhook-secret': 'chave-incorreta' }, {});
    assert(invalidHeader === false, 'Rejeição com chave secreta incorreta');
  } else {
    // Quando não configurado, permite teste sem bloquear
    const defaultAuth = evolutionService.validateWebhookRequest({}, {});
    assert(defaultAuth === true, 'Permite requisição se webhookSecret não estiver configurado');
  }

  console.log('\n====================================================');
  console.log(` RESULTADO DOS TESTES: ${passedTests}/${totalTests} PASSARAM COM SUCESSO `);
  console.log('====================================================\n');
}

runTestSuite().catch((err) => {
  console.error('\n❌ ERRO NA EXECUÇÃO DA SUÍTE DE TESTES:', err);
  process.exit(1);
});
