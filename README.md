# LUMOS CRM — Vendas & WhatsApp

CRM comercial com funil Kanban, leads, tarefas, relatórios e **caixa de entrada com vários números de WhatsApp** (um por vendedor), conectados por QR Code via [Evolution API](https://doc.evolution-api.com/).

## Como funciona

- **Cada vendedor conecta o próprio WhatsApp** em *Números de WhatsApp* (QR Code). Não há limite fixo de números; o padrão é até 10 (`MAX_WHATSAPP_INSTANCES`).
- As conversas de cada número ficam separadas. Se o mesmo cliente falar com dois vendedores, são duas conversas, cada uma respondida pelo número certo.
- Conversas novas vão para o dono do número (ou para o dono do lead, quando o telefone já é um lead). Gestores podem transferir.
- Papéis: **Vendedor** (atende as próprias conversas), **Gestor** (vê e transfere todas, gerencia números), **Administrador** (tudo isso e aprova acessos).
- Novas contas ficam **aguardando aprovação**. O primeiro usuário a entrar depois da instalação vira administrador.

## Arquitetura

| Parte | Tecnologia |
|---|---|
| Frontend | React 19 + TypeScript + Vite + Tailwind 4 |
| Login | Firebase Authentication (Google ou e-mail/senha) |
| Banco | Cloud Firestore (tempo real), regras em `firestore.rules` |
| Arquivos (fotos, áudios, PDFs) | Firebase Storage |
| API | Express como função serverless na Vercel (`api/index.ts`) |
| WhatsApp | Evolution API v2 (uma instância por número) |

Toda rota `/api/*` exige o token de login do Firebase, exceto `/api/health` e o webhook (que exige o segredo `WEBHOOK_SECRET`).

### Coleções do Firestore

- `users` — perfis, papel (`role`) e aprovação (`active`)
- `whatsapp_instances` — números conectados (gravado só pelo servidor)
- `conversations` e `conversations/{id}/messages` — atendimento
- `leads`, `pipeline_stages`, `tasks`, `activities` — comercial
- `quick_replies` — respostas rápidas da equipe
- `idempotency_keys`, `webhook_logs` — controle interno do servidor

## Configuração (uma vez)

1. **Servidor da Evolution API** sempre ligado (VPS com ~2 GB de RAM atende vários números). Anote a URL e a chave global (`AUTHENTICATION_API_KEY`).
2. **Variáveis na Vercel** (Settings → Environment Variables), veja `.env.example`:
   - `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`
   - `WEBHOOK_SECRET` (texto longo aleatório)
   - `FIREBASE_SERVICE_ACCOUNT_KEY` (JSON da conta de serviço em uma linha)
   - `APP_URL` (opcional na Vercel)
3. **Regras do Firestore**: publique `firestore.rules` (Firebase Console → Firestore → Regras, ou `firebase deploy --only firestore:rules`).
4. **Firebase Storage** ativado no projeto (para guardar fotos, áudios e documentos).
5. Faça um novo deploy na Vercel. Entre no CRM: o primeiro acesso vira administrador.
6. Em *Números de WhatsApp*, cada vendedor clica em **Conectar meu WhatsApp** e lê o QR Code. O webhook é configurado sozinho.

## Desenvolvimento

```bash
npm install
npm run dev      # Vite + API na porta 3000
npm test         # testes do webhook e da API
npm run build
```
