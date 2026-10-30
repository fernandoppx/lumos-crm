/**
 * Teste rápido da função serverless (sem gravar nada no banco):
 * confere que a API sobe e que as rotas protegidas recusam acesso sem login.
 *
 * Rodar: npx tsx scripts/test_serverless_vercel.ts
 */

import http from 'http';
import app from '../api/index.ts';

async function run() {
  let failed = 0;
  const check = (cond: boolean, name: string) => {
    console.log(`${cond ? '[PASS]' : '[FAIL]'} ${name}`);
    if (!cond) failed++;
  };

  const server = http.createServer(app as any);
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;

  try {
    check((await fetch(`${base}/api/health`)).status === 200, 'GET /api/health responde 200');
    check((await fetch(`${base}/health`)).status === 200, 'GET /health (sem prefixo) responde 200');
    check((await fetch(`${base}/api/config`)).status === 401, 'GET /api/config exige login');
    check((await fetch(`${base}/api/webhook/logs`)).status === 401, 'GET /api/webhook/logs exige login');
    check(
      (await fetch(`${base}/api/whatsapp/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"conversationId":"x","text":"oi"}' })).status === 401,
      'POST /api/whatsapp/send exige login'
    );
    check((await fetch(`${base}/api/whatsapp/instances/x/qrcode`, { method: 'POST' })).status === 401, 'POST QR Code exige login');
  } finally {
    server.close();
  }

  console.log(failed ? `\n${failed} falha(s)` : '\nTudo certo');
  process.exit(failed ? 1 : 0);
}

run();
