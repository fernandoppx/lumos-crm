/**
 * Adaptador para a Evolution API (foco na v2, com tolerância a respostas da v1).
 *
 * Diferente da versão anterior, que usava UMA instância fixa definida em
 * EVOLUTION_INSTANCE_NAME, todos os métodos recebem o nome da instância.
 * Cada número de WhatsApp conectado ao CRM é uma instância separada.
 */

import crypto from 'crypto';

export type InstanceState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface InstanceStatus {
  state: InstanceState;
  phone?: string;
  profileName?: string;
  profilePicUrl?: string;
  rawState?: string;
  error?: string;
}

export interface SendResult {
  success: boolean;
  externalId?: string;
  error?: string;
}

export type OutgoingMediaType = 'image' | 'video' | 'document' | 'audio';

export const WEBHOOK_EVENTS = [
  'MESSAGES_UPSERT',
  'MESSAGES_UPDATE',
  'SEND_MESSAGE',
  'CONNECTION_UPDATE',
  'QRCODE_UPDATED',
];

function env() {
  const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, '') || '';
  const apiKey = process.env.EVOLUTION_API_KEY?.trim() || '';
  return { apiUrl, apiKey, isConfigured: Boolean(apiUrl && apiKey) };
}

/**
 * Segredo exigido no webhook. Usa WEBHOOK_SECRET; se não estiver definido,
 * deriva um segredo estável da EVOLUTION_API_KEY (nunca expõe a chave em si).
 * Sem nenhum dos dois, o webhook fica fechado.
 */
export function getWebhookSecret(): string {
  const explicit = process.env.WEBHOOK_SECRET?.trim();
  if (explicit) return explicit;
  const { apiKey } = env();
  if (!apiKey) return '';
  return crypto.createHash('sha256').update(`lumos-webhook:${apiKey}`).digest('hex').slice(0, 40);
}

export function getAppUrl(fallbackHost?: string): string {
  const fromEnv = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProd) return `https://${vercelProd}`;
  if (fallbackHost) return `https://${fallbackHost}`;
  return '';
}

export function buildWebhookUrl(appUrl: string): string {
  const secret = getWebhookSecret();
  const base = `${appUrl}/api/webhook/evolution`;
  return secret ? `${base}?token=${encodeURIComponent(secret)}` : base;
}

export function mapRawState(raw: string | undefined | null): InstanceState {
  const s = String(raw || '').toLowerCase();
  if (s === 'open' || s === 'connected') return 'connected';
  if (s === 'connecting' || s === 'pairing' || s === 'qrcode') return 'connecting';
  return 'disconnected';
}

/** Gera um nome de instância seguro para a Evolution API a partir de um rótulo. */
export function makeInstanceName(label: string): string {
  const slug =
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'numero';
  const rand = crypto.randomBytes(3).toString('hex');
  return `lumos-${slug}-${rand}`;
}

export class EvolutionService {
  isConfigured(): boolean {
    return env().isConfigured;
  }

  private async request(
    path: string,
    init: { method?: string; body?: any } = {},
    timeoutMs = 20000
  ): Promise<{ ok: boolean; status: number; data: any; text: string }> {
    const { apiUrl, apiKey, isConfigured } = env();
    if (!isConfigured) {
      throw new Error('Evolution API não configurada (EVOLUTION_API_URL e EVOLUTION_API_KEY).');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${apiUrl}${path}`, {
        method: init.method || 'GET',
        headers: { apikey: apiKey, 'Content-Type': 'application/json' },
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      return { ok: res.ok, status: res.status, data, text };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error(
          `A Evolution API não respondeu em ${timeoutMs / 1000}s. Verifique se o servidor está ligado.`
        );
      }
      throw new Error(`Não foi possível falar com a Evolution API: ${err?.message || err}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private errorFrom(r: { status: number; data: any; text: string }, prefix: string): string {
    const msg =
      r.data?.response?.message ||
      r.data?.message ||
      r.data?.error ||
      r.text?.slice(0, 200) ||
      'sem detalhes';
    return `${prefix} (${r.status}): ${Array.isArray(msg) ? msg.join('; ') : typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 200)}`;
  }

  /** Cria a instância e configura o webhook apontando para o CRM. */
  async createInstance(instanceName: string, webhookUrl: string): Promise<void> {
    const secret = getWebhookSecret();
    const webhook = {
      url: webhookUrl,
      byEvents: false,
      base64: true,
      headers: secret ? { 'x-webhook-secret': secret } : undefined,
      events: WEBHOOK_EVENTS,
    };

    let r = await this.request('/instance/create', {
      method: 'POST',
      body: {
        instanceName,
        integration: 'WHATSAPP-BAILEYS',
        qrcode: true,
        groupsIgnore: true,
        webhook,
      },
    });

    // Algumas versões rejeitam o bloco webhook na criação: tenta sem ele.
    if (!r.ok && r.status === 400) {
      r = await this.request('/instance/create', {
        method: 'POST',
        body: { instanceName, integration: 'WHATSAPP-BAILEYS', qrcode: true },
      });
    }
    if (!r.ok) {
      throw new Error(this.errorFrom(r, 'Falha ao criar o número na Evolution API'));
    }

    await this.setWebhook(instanceName, webhookUrl);
  }

  async setWebhook(instanceName: string, webhookUrl: string): Promise<void> {
    const secret = getWebhookSecret();
    // Formato v2
    let r = await this.request(`/webhook/set/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      body: {
        webhook: {
          enabled: true,
          url: webhookUrl,
          headers: secret ? { 'x-webhook-secret': secret } : undefined,
          byEvents: false,
          base64: true,
          events: WEBHOOK_EVENTS,
        },
      },
    });
    // Formato v1
    if (!r.ok && r.status === 400) {
      r = await this.request(`/webhook/set/${encodeURIComponent(instanceName)}`, {
        method: 'POST',
        body: {
          enabled: true,
          url: webhookUrl,
          webhook_by_events: false,
          webhook_base64: true,
          events: WEBHOOK_EVENTS,
        },
      });
    }
    if (!r.ok) {
      throw new Error(this.errorFrom(r, 'Falha ao configurar o webhook'));
    }
  }

  async getQrCode(instanceName: string): Promise<{ qrCodeBase64?: string; pairingCode?: string; state: InstanceState }> {
    const r = await this.request(`/instance/connect/${encodeURIComponent(instanceName)}`);
    if (!r.ok) {
      throw new Error(this.errorFrom(r, 'Falha ao gerar QR Code'));
    }
    const d = r.data || {};
    let qr: string | undefined = d.base64 || d.qrcode?.base64 || d.qrCode;
    if (qr && !qr.startsWith('data:image')) qr = `data:image/png;base64,${qr}`;
    const rawState = d.instance?.state || d.state;
    return {
      qrCodeBase64: qr,
      pairingCode: d.pairingCode || d.qrcode?.pairingCode || undefined,
      state: qr ? 'connecting' : mapRawState(rawState || 'open'),
    };
  }

  async getStatus(instanceName: string): Promise<InstanceStatus> {
    const r = await this.request(`/instance/connectionState/${encodeURIComponent(instanceName)}`);
    if (r.status === 404) {
      return { state: 'error', error: 'Este número não existe mais na Evolution API.' };
    }
    if (!r.ok) {
      return { state: 'error', error: this.errorFrom(r, 'Falha ao consultar status') };
    }
    const d = r.data || {};
    const rawState = d.instance?.state || d.state || d.connectionStatus || 'close';
    const status: InstanceStatus = { state: mapRawState(rawState), rawState };

    // Dados do perfil conectado (número, nome, foto)
    try {
      const info = await this.request(`/instance/fetchInstances?instanceName=${encodeURIComponent(instanceName)}`);
      if (info.ok) {
        const list = Array.isArray(info.data) ? info.data : [info.data];
        const item = list.find((x: any) => (x?.name || x?.instance?.instanceName) === instanceName) || list[0];
        const inst = item?.instance || item || {};
        const owner = inst.ownerJid || inst.owner || inst.wuid;
        if (owner) status.phone = String(owner).replace(/@.+$/, '').replace(/:\d+$/, '');
        status.profileName = inst.profileName || undefined;
        status.profilePicUrl = inst.profilePicUrl || inst.profilePictureUrl || undefined;
      }
    } catch {
      // detalhes de perfil são opcionais
    }
    return status;
  }

  async logout(instanceName: string): Promise<void> {
    const r = await this.request(`/instance/logout/${encodeURIComponent(instanceName)}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 404 && r.status !== 400) {
      throw new Error(this.errorFrom(r, 'Falha ao desconectar'));
    }
  }

  async deleteInstance(instanceName: string): Promise<void> {
    const r = await this.request(`/instance/delete/${encodeURIComponent(instanceName)}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 404) {
      throw new Error(this.errorFrom(r, 'Falha ao remover o número na Evolution API'));
    }
  }

  async sendText(instanceName: string, phone: string, text: string): Promise<SendResult> {
    const number = phone.replace(/\D/g, '');
    if (number.length < 10) return { success: false, error: 'Número de telefone inválido.' };

    let r = await this.request(`/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      body: { number, text, delay: 800 },
    });
    // Fallback para o formato da v1
    if (!r.ok && r.status === 400 && /textMessage/i.test(r.text)) {
      r = await this.request(`/message/sendText/${encodeURIComponent(instanceName)}`, {
        method: 'POST',
        body: { number, options: { delay: 800 }, textMessage: { text } },
      });
    }
    if (!r.ok) return { success: false, error: this.errorFrom(r, 'Falha no envio') };
    return { success: true, externalId: r.data?.key?.id || r.data?.id };
  }

  async sendMedia(
    instanceName: string,
    phone: string,
    media: { type: OutgoingMediaType; base64: string; mimetype: string; fileName?: string; caption?: string }
  ): Promise<SendResult> {
    const number = phone.replace(/\D/g, '');
    if (number.length < 10) return { success: false, error: 'Número de telefone inválido.' };
    const pureBase64 = media.base64.replace(/^data:[^;]+;base64,/, '');

    const r =
      media.type === 'audio'
        ? await this.request(
            `/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`,
            { method: 'POST', body: { number, audio: pureBase64, delay: 500 } },
            60000
          )
        : await this.request(
            `/message/sendMedia/${encodeURIComponent(instanceName)}`,
            {
              method: 'POST',
              body: {
                number,
                mediatype: media.type,
                mimetype: media.mimetype,
                caption: media.caption || '',
                media: pureBase64,
                fileName: media.fileName || 'arquivo',
                delay: 500,
              },
            },
            60000
          );
    if (!r.ok) return { success: false, error: this.errorFrom(r, 'Falha no envio do arquivo') };
    return { success: true, externalId: r.data?.key?.id || r.data?.id };
  }

  /** Baixa a mídia de uma mensagem recebida (quando o webhook não trouxe o base64). */
  async getMediaBase64(instanceName: string, messageData: any): Promise<{ base64: string; mimetype?: string } | null> {
    try {
      const r = await this.request(
        `/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`,
        { method: 'POST', body: { message: { key: messageData.key, message: messageData.message }, convertToMp4: false } },
        30000
      );
      if (!r.ok || !r.data?.base64) return null;
      return { base64: r.data.base64, mimetype: r.data.mimetype };
    } catch {
      return null;
    }
  }

  /** Valida o segredo do webhook (header x-webhook-secret ou ?token=). */
  validateWebhookRequest(headers: Record<string, any>, query: Record<string, any>): boolean {
    const secret = getWebhookSecret();
    if (!secret) return false; // sem segredo configurado o webhook fica fechado
    const provided = String(
      headers['x-webhook-secret'] || headers['webhook-secret'] || query['token'] || query['secret'] || ''
    );
    if (!provided || provided.length !== secret.length) return false;
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  }
}

export const evolutionService = new EvolutionService();
