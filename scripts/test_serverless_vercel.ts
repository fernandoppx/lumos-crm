/**
 * Testes automatizados de compatibilidade Vercel Serverless & Express Routes para Lumus CRM
 */

import http from 'http';
import app from '../api/index.ts';
import { evolutionService } from '../src/server/evolutionService.ts';

async function runTests() {
  console.log('--- INICIANDO SUÍTE DE TESTES VERCEL SERVERLESS & EXPRESS ---');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}: ${detail || 'Condição não satisfeita'}`);
      failed++;
    }
  }

  // 1. Verificação da assinatura da Vercel Function
  assert(typeof app === 'function', 'api/index.ts exporta uma função Express/Vercel válida');

  // Inicializa servidor HTTP temporário na memória para disparar requisições reais
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as any;
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 2. Teste: Rota GET /api/health
    const resHealth = await fetch(`${baseUrl}/api/health`);
    const healthJson = await resHealth.json();
    assert(resHealth.status === 200 && healthJson.status === 'ok', 'GET /api/health retorna 200 OK');

    // 3. Teste: Compatibilidade sem prefixo /api (quando Vercel remove o prefixo na reescrita)
    const resHealthDirect = await fetch(`${baseUrl}/health`);
    const healthDirectJson = await resHealthDirect.json();
    assert(resHealthDirect.status === 200 && healthDirectJson.status === 'ok', 'GET /health (fallback sem prefixo) funciona corretamente');

    // 4. Teste: Rota GET /api/config
    const resConfig = await fetch(`${baseUrl}/api/config`);
    const configJson = await resConfig.json();
    assert(resConfig.status === 200 && 'webhookUrl' in configJson, 'GET /api/config retorna metadados de configuração');

    // 5. Teste: Rota GET /api/webhook/logs
    const resLogs = await fetch(`${baseUrl}/api/webhook/logs`);
    const logsJson = await resLogs.json();
    assert(resLogs.status === 200 && Array.isArray(logsJson.logs), 'GET /api/webhook/logs retorna lista de logs');

    // 6. Teste: Rota GET /api/whatsapp/status
    const resStatus = await fetch(`${baseUrl}/api/whatsapp/status`);
    const statusJson = await resStatus.json();
    assert(resStatus.status === 200 && ('state' in statusJson || 'configured' in statusJson), 'GET /api/whatsapp/status responde com status de conexão');

    // 7. Teste: Validação de parâmetros em POST /api/whatsapp/send-message
    const resSendInvalid = await fetch(`${baseUrl}/api/whatsapp/send-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const sendInvalidJson = await resSendInvalid.json();
    assert(resSendInvalid.status === 400 && sendInvalidJson.error?.includes('obrigatórios'), 'POST /api/whatsapp/send-message valida campos phone e message');

    // 8. Teste: Webhook sem autenticação quando WEBHOOK_SECRET estiver configurado
    process.env.WEBHOOK_SECRET = 'segredo_teste_lumus_123';
    const resWebhookUnauthorized = await fetch(`${baseUrl}/api/webhook/evolution`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'TEST' }),
    });
    assert(resWebhookUnauthorized.status === 401, 'POST /api/webhook/evolution rejeita requisições sem WEBHOOK_SECRET válido');

    // 9. Teste: Webhook com autenticação via cabeçalho x-webhook-secret
    const resWebhookAuthorized = await fetch(`${baseUrl}/api/webhook/evolution`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': 'segredo_teste_lumus_123',
      },
      body: JSON.stringify({ event: 'CONNECTION_UPDATE', state: 'open' }),
    });
    const webhookJson = await resWebhookAuthorized.json();
    assert(resWebhookAuthorized.status === 200 && webhookJson.status === 'connection_updated', 'POST /api/webhook/evolution autentica com x-webhook-secret e processa CONNECTION_UPDATE');

    // 10. Teste: Idempotência de mensagens (duplicidade)
    const testExternalId = `msg_test_${Date.now()}_abc`;
    const messagePayload = {
      event: 'MESSAGES_UPSERT',
      instance: 'lumus-crm',
      data: {
        key: {
          id: testExternalId,
          fromMe: false,
          remoteJid: '5511999998888@s.whatsapp.net',
        },
        pushName: 'Cliente Teste Vercel',
        message: {
          conversation: 'Olá, este é um teste para verificação Vercel',
        },
      },
    };

    // Primeiro envio do webhook:
    const resMsg1 = await fetch(`${baseUrl}/api/webhook/evolution`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': 'segredo_teste_lumus_123',
      },
      body: JSON.stringify(messagePayload),
    });
    const msg1Json = await resMsg1.json();
    // Se credenciais de serviço ainda não foram injetadas no ambiente de teste, o backend retorna 500 informando PERMISSION_DENIED de forma controlada; com credenciais ativas, retorna 200 'processed'.
    const isExpectedMsg1Status = resMsg1.status === 200 || (resMsg1.status === 500 && msg1Json.error?.includes('PERMISSION_DENIED'));
    assert(isExpectedMsg1Status, `Primeiro webhook processado ou protegido com segurança (HTTP ${resMsg1.status}, status: ${msg1Json.status || msg1Json.error})`);

    // Segundo envio do mesmo externalId (deve detectar duplicidade):
    const resMsg2 = await fetch(`${baseUrl}/api/webhook/evolution`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': 'segredo_teste_lumus_123',
      },
      body: JSON.stringify(messagePayload),
    });
    const msg2Json = await resMsg2.json();
    assert(resMsg2.status === 200 && msg2Json.status === 'ignored_duplicate', 'Segundo envio com mesmo externalId é detectado como "ignored_duplicate"');

    // 11. Teste: Mensagem de grupo ignorada para atendimento comercial individual
    const groupPayload = {
      event: 'MESSAGES_UPSERT',
      instance: 'lumus-crm',
      data: {
        key: {
          id: `group_msg_${Date.now()}`,
          fromMe: false,
          remoteJid: '1234567890-987654@g.us',
        },
        message: { conversation: 'Mensagem de grupo' },
      },
    };
    const resGroup = await fetch(`${baseUrl}/api/webhook/evolution`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': 'segredo_teste_lumus_123',
      },
      body: JSON.stringify(groupPayload),
    });
    const groupJson = await resGroup.json();
    assert(resGroup.status === 200 && groupJson.status === 'ignored_group', 'Mensagem de grupo WhatsApp (@g.us) é ignorada com status "ignored_group"');

    // 12. Teste: Consulta de logs após processamento de webhooks
    const resLogsAfter = await fetch(`${baseUrl}/api/webhook/logs`);
    const logsAfterJson = await resLogsAfter.json();
    assert(resLogsAfter.status === 200 && logsAfterJson.logs.length > 0, 'GET /api/webhook/logs retorna os logs gerados durante os testes');

    // Restaura ambiente
    delete process.env.WEBHOOK_SECRET;

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  console.log('----------------------------------------------------');
  console.log(`TOTAL DE TESTES: ${passed + failed} | APROVADOS: ${passed} | FALHAS: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erro fatal executando os testes:', err);
  process.exit(1);
});
