# Lumus CRM - Plataforma Comercial & Atendimento WhatsApp

Lumus CRM é uma aplicação web full-stack desenvolvida para a gestão comercial interna de equipes de vendas. A aplicação combina pipeline visual no estilo Kanban, cadastro e acompanhamento detalhado de leads, controle de tarefas/follow-ups e uma caixa de entrada para atendimento individual via WhatsApp integrada com a **Evolution API** via QR Code e Webhooks.

---

## 1. Visão Geral da Arquitetura

- **Frontend**: React 19 com TypeScript, Tailwind CSS v4, Lucide Icons e design minimalista para SaaS com foco em legibilidade, `tabular-nums` para valores financeiros e zero elementos poluentes.
- **Autenticação**: Firebase Authentication com suporte a login com Conta Google e e-mail/senha corporativo.
- **Banco de Dados**: Cloud Firestore com regras de segurança ativas (`firestore.rules`), subscrições em tempo real (`onSnapshot`) e coleções normalizadas.
- **Backend / API**: Servidor Express em Node.js integrado ao Vite e empacotado para produção, gerenciando rotas `/api/*`.
- **Integração WhatsApp**: Adaptador dedicado para **Evolution API** (`src/server/evolutionService.ts`), permitindo checagem de status, solicitação/atualização de QR Code, desconexão, envio de mensagens e endpoint receptor de Webhook idempotente.

---

## 2. Variáveis de Ambiente (.env)

Configure as seguintes variáveis de ambiente no arquivo `.env` (ou no painel de segredos do ambiente):

```env
# Porta da aplicação (padrão 3000)
PORT=3000

# URL pública da sua aplicação (usada para autogerar a URL de Webhook)
APP_URL="https://seu-crm.run.app"

# Evolution API - Integração WhatsApp
# URL base onde sua Evolution API está hospedada (ex: https://evolution.suaempresa.com ou http://localhost:8080)
EVOLUTION_API_URL="https://evolution.suaempresa.com"

# Chave Global ou de Instância da Evolution API (header apikey)
EVOLUTION_API_KEY="sua_chave_secreta_aqui"

# Nome exato da instância criada na Evolution API
EVOLUTION_INSTANCE_NAME="lumus-comercial"

# Segredo compartilhado do Webhook (opcional, para validação extra)
WEBHOOK_SECRET="seu_segredo_webhook"
```

---

## 3. Configuração da Evolution API e Webhook

Para conectar o WhatsApp da sua empresa:

1. **Criação da Instância na Evolution API**:
   - Crie uma instância com o mesmo nome informado em `EVOLUTION_INSTANCE_NAME`.
2. **Configuração do Webhook**:
   - No painel da sua Evolution API (ou via API REST `POST /webhook/set/:instance`), configure a URL:
     ```
     https://seu-crm.run.app/api/webhook/evolution
     ```
   - Habilite os eventos:
     - `MESSAGES_UPSERT` (para receber novas mensagens e respostas de clientes)
     - `CONNECTION_UPDATE` (para atualizar o status de conectado/desconectado em tempo real)
     - `QRCODE_UPDATED` (para atualizar o QR code se gerado remotamente)
3. **Validação e Idempotência**:
   - O backend do Lumus CRM valida os identificadores externos das mensagens (`key.id`) para evitar duplicações de mensagens processadas.
   - Mensagens enviadas pelo próprio CRM são registradas com status `sent` e ID externo.

---

## 4. Banco de Dados e Coleções do Firestore

O Firestore foi provisionado com as seguintes coleções estruturadas:

- `users`: Perfis dos vendedores e administradores.
- `leads`: Cadastro dos clientes em potencial, contatos, valores, consentimento LGPD e tags.
- `pipeline_stages`: Etapas do Kanban com ordenação e cores personalizáveis.
- `conversations`: Linhas de atendimento no WhatsApp associadas a leads ou contatos desconhecidos.
- `messages`: Mensagens individuais com carimbo de tempo, remetente e status real.
- `tasks`: Tarefas e follow-ups comerciais com detecção de prazos vencidos.
- `activities`: Registro cronológico e auditoria de cada movimentação de funil, anotação e mensagem.
- `integration_settings`: Metadados de conexão do WhatsApp.

---

## 5. Como Executar Localmente

### Pré-requisitos
- Node.js 20+ ou 22+
- NPM ou Yarn

### Instalação e Execução
```bash
# 1. Instalar dependências
npm install

# 2. Executar em modo desenvolvimento (Vite + Express API na porta 3000)
npm run dev

# 3. Compilar projeto para produção
npm run build

# 4. Iniciar servidor de produção
npm start
```

---

## 6. Dados de Demonstração

Por padrão, a aplicação inicia com banco de produção limpo (sem dados fictícios poluindo seu funil). Para testar as funcionalidades comerciais:
1. Acesse o menu **Configurações**.
2. Na seção **Dados de Demonstração**, clique em **Gerar Dados de Demonstração**.
3. O sistema criará 8 leads reais distribuídos nas 8 etapas padrão do funil, com tarefas, histórico e conversas para testes da equipe.
4. Você pode limpar a base de testes a qualquer momento clicando em **Limpar Todo o Banco**.
