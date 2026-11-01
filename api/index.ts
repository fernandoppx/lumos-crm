import express from 'express';

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// A API é carregada sob demanda: se algum módulo falhar ao iniciar, a função responde
// com a mensagem do erro (sem segredos) em vez de cair com FUNCTION_INVOCATION_FAILED.
let routerPromise: Promise<any> | null = null;
function loadRouter() {
  if (!routerPromise) {
    routerPromise = import('../src/server/apiRouter.ts').then((m) => m.apiRouter);
    routerPromise.catch(() => {
      routerPromise = null; // tenta de novo na próxima requisição
    });
  }
  return routerPromise;
}

app.use(async (req: any, res: any, next: any) => {
  try {
    const router = await loadRouter();
    // Compatível com a Vercel mantendo ou removendo o prefixo /api
    if ((req.url || '').startsWith('/api/') || req.url === '/api') {
      req.url = req.url.slice(4) || '/';
    }
    router(req, res, next);
  } catch (err: any) {
    console.error('[API] Falha ao carregar o servidor:', err?.message || err);
    res.status(500).json({ error: 'Falha ao iniciar a API', detail: String(err?.message || err).slice(0, 500) });
  }
});

export default app;
