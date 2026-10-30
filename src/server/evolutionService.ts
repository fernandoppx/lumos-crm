/**
 * Adaptador de integração oficial para Evolution API (v1 e v2)
 * Responsável pela comunicação segura entre o backend do Lumus CRM e a instância do WhatsApp.
 */

export interface EvolutionStatusResponse {
  configured: boolean;
  state: 'disconnected' | 'connecting' | 'connected' | 'error';
  instanceName?: string;
  connectedPhone?: string;
  profileName?: string;
  profilePicUrl?: string;
  lastCheckedAt: string;
  message?: string;
  details?: any;
}

export interface SendMessageResult {
  success: boolean;
  externalId?: string;
  status: 'sent' | 'failed';
  error?: string;
}

// Conjunto para controle de idempotência e desduplicação de mensagens recebidas
const processedExternalIds = new Map<string, number>();

// Limpeza periódica de IDs processados após 24 horas
const cleanupTimer = setInterval(() => {
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, timestamp] of processedExternalIds.entries()) {
    if (timestamp < oneDayAgo) {
      processedExternalIds.delete(id);
    }
  }
}, 60 * 60 * 1000);
if (typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

export class EvolutionService {
  private getEnvConfig() {
    const apiUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, '') || '';
    const apiKey = process.env.EVOLUTION_API_KEY?.trim() || '';
    const instanceName = process.env.EVOLUTION_INSTANCE_NAME?.trim() || '';
    const webhookSecret = process.env.WEBHOOK_SECRET?.trim() || '';

    return {
      apiUrl,
      apiKey,
      instanceName,
      webhookSecret,
      isConfigured: Boolean(apiUrl && apiKey && instanceName),
    };
  }

  /**
   * Executa requisição HTTP com timeout explícito para resiliência serverless
   */
  private async fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 15000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err.name === 'AbortError' || err.message?.includes('aborted')) {
        throw new Error(
          `Tempo limite excedido (${timeoutMs / 1000}s) ao comunicar com a Evolution API. Caso ela esteja hospedada no Render, a instância pode estar em processo de ativação (spin-up). Tente novamente em instantes.`
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  public getConfig() {
    const env = this.getEnvConfig();
    const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
    const webhookUrl = appUrl ? `${appUrl}/api/webhook/evolution` : '/api/webhook/evolution';

    return {
      isConfigured: env.isConfigured,
      apiUrl: env.apiUrl ? `${env.apiUrl.slice(0, 15)}...` : undefined,
      instanceName: env.instanceName || undefined,
      webhookUrl,
      hasWebhookSecret: Boolean(env.webhookSecret),
    };
  }

  /**
   * Consulta o estado de conexão real da instância na Evolution API
   */
  public async getStatus(): Promise<EvolutionStatusResponse> {
    const env = this.getEnvConfig();
    const now = new Date().toISOString();

    if (!env.isConfigured) {
      return {
        configured: false,
        state: 'disconnected',
        lastCheckedAt: now,
        message: 'Variáveis EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE_NAME não configuradas no ambiente.',
      };
    }

    try {
      const response = await this.fetchWithTimeout(`${env.apiUrl}/instance/connectionState/${env.instanceName}`, {
        method: 'GET',
        headers: {
          'apikey': env.apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          configured: true,
          state: 'error',
          instanceName: env.instanceName,
          lastCheckedAt: now,
          message: `Falha ao consultar Evolution API (${response.status}): ${errorText.slice(0, 200)}`,
        };
      }

      const data = await response.json();
      // Trata diferentes formatos retornados pelas versões v1 / v2 da Evolution API
      const rawState = (
        data?.instance?.state ||
        data?.state ||
        data?.connectionStatus ||
        data?.status ||
        'close'
      ).toLowerCase();

      let mappedState: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
      if (rawState === 'open' || rawState === 'connected') {
        mappedState = 'connected';
      } else if (rawState === 'connecting' || rawState === 'pairing') {
        mappedState = 'connecting';
      } else {
        mappedState = 'disconnected';
      }

      // Se conectado, extrai número de telefone associado
      let connectedPhone: string | undefined = undefined;
      const ownerJid = data?.instance?.ownerJid || data?.ownerJid || data?.instance?.phone;
      if (ownerJid) {
        connectedPhone = String(ownerJid).replace(/@.+$/, '');
      }

      return {
        configured: true,
        state: mappedState,
        instanceName: env.instanceName,
        connectedPhone,
        profileName: data?.instance?.profileName || data?.profileName,
        lastCheckedAt: now,
        details: { rawState },
      };
    } catch (err: any) {
      return {
        configured: true,
        state: 'error',
        instanceName: env.instanceName,
        lastCheckedAt: now,
        message: `Não foi possível conectar ao servidor da Evolution API: ${err.message || String(err)}`,
      };
    }
  }

  /**
   * Solicita ou atualiza o QR Code para pareamento
   */
  public async getQrCode(): Promise<{
    success: boolean;
    qrCodeBase64?: string;
    pairingCode?: string;
    state?: string;
    error?: string;
  }> {
    const env = this.getEnvConfig();
    if (!env.isConfigured) {
      return {
        success: false,
        error: 'Configuração da Evolution API incompleta (.env). Verifique a página de integração.',
      };
    }

    try {
      const response = await this.fetchWithTimeout(`${env.apiUrl}/instance/connect/${env.instanceName}`, {
        method: 'GET',
        headers: {
          'apikey': env.apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Erro ao solicitar QR Code (${response.status}): ${errorText.slice(0, 200)}`,
        };
      }

      const data = await response.json();
      
      // Evolution API pode retornar base64 no formato data:image/png;base64,... ou puro base64
      let qrCodeBase64 = data?.base64 || data?.qrcode?.base64 || data?.qrCode;
      if (qrCodeBase64 && !qrCodeBase64.startsWith('data:image')) {
        qrCodeBase64 = `data:image/png;base64,${qrCodeBase64}`;
      }

      return {
        success: Boolean(qrCodeBase64 || data?.code),
        qrCodeBase64,
        pairingCode: data?.pairingCode,
        state: data?.state || (qrCodeBase64 ? 'waiting_qr' : 'open'),
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Erro de comunicação ao obter QR Code: ${err.message}`,
      };
    }
  }

  /**
   * Desconecta a instância do WhatsApp (logout)
   */
  public async disconnect(): Promise<{ success: boolean; error?: string }> {
    const env = this.getEnvConfig();
    if (!env.isConfigured) {
      return { success: false, error: 'Evolution API não configurada.' };
    }

    try {
      const response = await this.fetchWithTimeout(`${env.apiUrl}/instance/logout/${env.instanceName}`, {
        method: 'DELETE',
        headers: {
          'apikey': env.apiKey,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok && response.status !== 404) {
        const errText = await response.text();
        return { success: false, error: `Falha ao desconectar: ${errText.slice(0, 200)}` };
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Envia mensagem de texto via Evolution API
   */
  public async sendTextMessage(phone: string, text: string): Promise<SendMessageResult> {
    const env = this.getEnvConfig();
    if (!env.isConfigured) {
      return {
        success: false,
        status: 'failed',
        error: 'Evolution API não configurada. Configure as variáveis de ambiente para envio real.',
      };
    }

    // Normalização do número para envio (apenas dígitos)
    const cleanNumber = phone.replace(/\D/g, '');
    if (!cleanNumber || cleanNumber.length < 10) {
      return {
        success: false,
        status: 'failed',
        error: 'Número de telefone inválido para envio via WhatsApp.',
      };
    }

    try {
      const response = await this.fetchWithTimeout(`${env.apiUrl}/message/sendText/${env.instanceName}`, {
        method: 'POST',
        headers: {
          'apikey': env.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          number: cleanNumber,
          text: text,
          delay: 1000,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          status: 'failed',
          error: `Falha no envio Evolution API (${response.status}): ${errorText.slice(0, 250)}`,
        };
      }

      const result = await response.json();
      const externalId = result?.key?.id || result?.id || `msg_${Date.now()}`;

      // Registra no mapa de idempotência para não reprocessar via webhook caso retorne
      processedExternalIds.set(externalId, Date.now());

      return {
        success: true,
        status: 'sent',
        externalId,
      };
    } catch (err: any) {
      return {
        success: false,
        status: 'failed',
        error: `Erro ao enviar mensagem: ${err.message}`,
      };
    }
  }

  /**
   * Valida a autenticidade da requisição do Webhook
   */
  public validateWebhookRequest(headers: Record<string, any>, query: Record<string, any>): boolean {
    const env = this.getEnvConfig();
    // Se o webhookSecret estiver definido, valida com rigor
    if (env.webhookSecret) {
      const headerSecret = headers['x-webhook-secret'] || headers['webhook-secret'] || headers['apikey'] || query['secret'];
      if (headerSecret !== env.webhookSecret && headerSecret !== env.apiKey) {
        return false;
      }
    }
    return true;
  }

  /**
   * Verifica se mensagem já foi processada (idempotência)
   */
  public isMessageAlreadyProcessed(externalId: string): boolean {
    if (!externalId) return false;
    if (processedExternalIds.has(externalId)) {
      return true;
    }
    processedExternalIds.set(externalId, Date.now());
    return false;
  }
}

export const evolutionService = new EvolutionService();
