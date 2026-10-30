import React, { useState, useEffect } from 'react';
import {
  QrCode,
  RefreshCw,
  Power,
  PowerOff,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  Check,
  ShieldAlert,
  Server,
  Activity,
  Radio,
  ExternalLink,
  Info,
} from 'lucide-react';
import { WhatsAppConnectionState, EvolutionConfigStatus } from '../../types/crm.ts';
import { formatDateTimeSP, formatPhoneDisplay } from '../../utils/formatters.ts';
import { useToast } from '../common/Toast.tsx';

interface WhatsAppIntegrationViewProps {
  connectionState: WhatsAppConnectionState;
  onRefreshStatus: () => Promise<void>;
}

export const WhatsAppIntegrationView: React.FC<WhatsAppIntegrationViewProps> = ({
  connectionState,
  onRefreshStatus,
}) => {
  const { success, error, info } = useToast();

  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [qrCodeBase64, setQrCodeBase64] = useState<string | null>(connectionState.qrCodeBase64 || null);
  const [configStatus, setConfigStatus] = useState<EvolutionConfigStatus | null>(null);
  const [webhookLogs, setWebhookLogs] = useState<any[]>([]);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  // Busca configurações e logs recentes do webhook
  const fetchConfigAndLogs = async () => {
    try {
      const [confRes, logsRes] = await Promise.all([
        fetch('/api/config'),
        fetch('/api/webhook/logs'),
      ]);
      if (confRes.ok) {
        const confData = await confRes.json();
        setConfigStatus(confData);
      }
      if (logsRes.ok) {
        const logsData = await logsRes.json();
        setWebhookLogs(logsData.logs || []);
      }
    } catch (err) {
      console.warn('Falha ao consultar config/logs da API:', err);
    }
  };

  useEffect(() => {
    fetchConfigAndLogs();
    const interval = setInterval(fetchConfigAndLogs, 10000);
    return () => clearInterval(interval);
  }, []);

  // Solicitar QR Code
  const handleGetQrCode = async () => {
    try {
      setLoadingAction('qrcode');
      const response = await fetch('/api/whatsapp/qrcode');
      const data = await response.json();

      if (data.success && data.qrCodeBase64) {
        setQrCodeBase64(data.qrCodeBase64);
        success('QR Code gerado com sucesso!', 'Abra seu WhatsApp e aponte a câmera para conectar.');
      } else {
        error('Não foi possível obter o QR Code', data.error || 'Verifique se a Evolution API está em execução.');
      }
      await onRefreshStatus();
    } catch (err: any) {
      error('Erro ao conectar', err.message);
    } finally {
      setLoadingAction(null);
    }
  };

  // Desconectar instância
  const handleDisconnect = async () => {
    try {
      setLoadingAction('disconnect');
      const response = await fetch('/api/whatsapp/disconnect', { method: 'POST' });
      const data = await response.json();

      if (data.success) {
        setQrCodeBase64(null);
        success('Instância desconectada com sucesso.');
      } else {
        error('Falha ao desconectar', data.error);
      }
      await onRefreshStatus();
    } catch (err: any) {
      error('Erro ao desconectar', err.message);
    } finally {
      setLoadingAction(null);
    }
  };

  // Copiar URL do webhook
  const handleCopyWebhookUrl = () => {
    if (!configStatus?.webhookUrl) return;
    const fullUrl = configStatus.webhookUrl.startsWith('http')
      ? configStatus.webhookUrl
      : `${window.location.origin}${configStatus.webhookUrl}`;
    navigator.clipboard.writeText(fullUrl);
    setCopiedWebhook(true);
    success('URL do Webhook copiada para a área de transferência!');
    setTimeout(() => setCopiedWebhook(false), 3000);
  };

  const getStatusBadge = () => {
    switch (connectionState.status) {
      case 'connected':
        return (
          <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span className="font-semibold text-xs">WhatsApp Conectado e Operacional</span>
          </div>
        );
      case 'connecting':
        return (
          <div className="flex items-center gap-2 text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">
            <RefreshCw className="w-4 h-4 text-amber-600 animate-spin" />
            <span className="font-semibold text-xs">Aguardando Leitura do QR Code</span>
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center gap-2 text-rose-700 bg-rose-50 px-3 py-1.5 rounded-lg border border-rose-200">
            <XCircle className="w-4 h-4 text-rose-600" />
            <span className="font-semibold text-xs">Falha de Conexão com a Evolution API</span>
          </div>
        );
      default:
        return (
          <div className="flex items-center gap-2 text-slate-700 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
            <PowerOff className="w-4 h-4 text-slate-500" />
            <span className="font-semibold text-xs">Desconectado</span>
          </div>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Aviso Oficial de Conexão e Responsabilidade Comercial (Requisito Seção 12) */}
      <div className="p-4 bg-amber-50/90 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-3">
        <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-bold">Aviso Importante sobre a Integração do WhatsApp:</p>
          <p className="text-amber-800 leading-relaxed">
            A conexão por QR Code utiliza uma integração com a Evolution API. Este CRM é desenhado exclusivamente para{' '}
            <strong>atendimento comercial individual e direto</strong> com seus clientes e leads. Não utilize para disparos em massa, mensagens não solicitadas ou automações abusivas, sob risco de bloqueio definitivo do número pela Meta.
          </p>
        </div>
      </div>

      {/* Painel Principal de Estado da Conexão */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Card de Pareamento e QR Code (7 colunas) */}
        <div className="lg:col-span-7 bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Pareamento WhatsApp via QR Code</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Escaneie o código com seu aplicativo do WhatsApp em Aparelhos Conectados
              </p>
            </div>
            <div>{getStatusBadge()}</div>
          </div>

          {/* Área do QR Code ou Estado Conectado */}
          <div className="flex flex-col items-center justify-center p-6 bg-slate-50 border border-slate-200 rounded-xl min-h-[300px]">
            {connectionState.status === 'connected' ? (
              <div className="text-center space-y-3">
                <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-xs">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Instância Pareada com Sucesso</h3>
                  {connectionState.connectedPhone && (
                    <p className="text-xs font-mono text-slate-600 mt-1 font-semibold">
                      Número Conectado: {formatPhoneDisplay(connectionState.connectedPhone)}
                    </p>
                  )}
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Última verificação: {formatDateTimeSP(connectionState.lastConnectedAt || connectionState.updatedAt)}
                  </p>
                </div>
                <div className="pt-2">
                  <button
                    onClick={handleDisconnect}
                    disabled={loadingAction === 'disconnect'}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors disabled:opacity-50"
                  >
                    <PowerOff className="w-3.5 h-3.5" />
                    <span>Desconectar Instância</span>
                  </button>
                </div>
              </div>
            ) : qrCodeBase64 ? (
              <div className="text-center space-y-4">
                <div className="p-3 bg-white border border-slate-200 rounded-xl shadow-xs inline-block">
                  <img
                    src={qrCodeBase64}
                    alt="QR Code WhatsApp Evolution API"
                    className="w-56 h-56 object-contain"
                  />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-800">
                    Abra o WhatsApp &gt; Configurações &gt; Aparelhos Conectados &gt; Conectar Aparelho
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    O QR Code atualiza periodicamente. Caso expire, clique no botão abaixo.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={handleGetQrCode}
                    disabled={loadingAction === 'qrcode'}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingAction === 'qrcode' ? 'animate-spin' : ''}`} />
                    <span>Atualizar QR Code</span>
                  </button>
                  <button
                    onClick={handleDisconnect}
                    className="px-3 py-2 text-xs text-slate-500 hover:text-slate-800"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center space-y-4 max-w-sm">
                <div className="w-14 h-14 rounded-full bg-slate-200/70 text-slate-500 flex items-center justify-center mx-auto">
                  <QrCode className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Nenhum QR Code ativo no momento</h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Clique no botão abaixo para requisitar um novo QR Code à sua instância Evolution API.
                  </p>
                </div>
                <button
                  onClick={handleGetQrCode}
                  disabled={loadingAction === 'qrcode'}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-xs disabled:opacity-50"
                >
                  <Power className="w-4 h-4" />
                  <span>{loadingAction === 'qrcode' ? 'Gerando QR Code...' : 'Conectar WhatsApp'}</span>
                </button>
              </div>
            )}
          </div>

          {/* Erro retornado */}
          {connectionState.errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Diagnóstico da Conexão:</p>
                <p className="mt-0.5">{connectionState.errorMessage}</p>
              </div>
            </div>
          )}
        </div>

        {/* Card de Configuração das Variáveis de Ambiente e Webhook (5 colunas) */}
        <div className="lg:col-span-5 space-y-5">
          {/* Status das Variáveis */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-indigo-600" />
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Variáveis de Ambiente
                </h3>
              </div>
              <button
                onClick={onRefreshStatus}
                title="Checar status novamente"
                className="text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1 font-semibold"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Testar</span>
              </button>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between items-center p-2 rounded bg-slate-50">
                <span className="font-mono text-[11px] text-slate-600">EVOLUTION_API_URL</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${configStatus?.apiUrl ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                  {configStatus?.apiUrl ? 'Configurado' : 'Pendente'}
                </span>
              </div>

              <div className="flex justify-between items-center p-2 rounded bg-slate-50">
                <span className="font-mono text-[11px] text-slate-600">EVOLUTION_API_KEY</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${configStatus?.isConfigured ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                  {configStatus?.isConfigured ? 'Protegida no Backend' : 'Pendente'}
                </span>
              </div>

              <div className="flex justify-between items-center p-2 rounded bg-slate-50">
                <span className="font-mono text-[11px] text-slate-600">EVOLUTION_INSTANCE_NAME</span>
                <span className="font-mono text-[11px] text-slate-800 font-semibold">
                  {configStatus?.instanceName || 'Não definida'}
                </span>
              </div>

              <div className="flex justify-between items-center p-2 rounded bg-slate-50">
                <span className="font-mono text-[11px] text-slate-600">WEBHOOK_SECRET</span>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${configStatus?.hasWebhookSecret ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                  {configStatus?.hasWebhookSecret ? 'Ativo' : 'Opcional'}
                </span>
              </div>
            </div>

            {/* URL do Webhook para copiar */}
            <div className="pt-3 border-t border-slate-100">
              <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                URL Pública do Webhook do CRM:
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={
                    configStatus?.webhookUrl?.startsWith('http')
                      ? configStatus.webhookUrl
                      : `${window.location.origin}${configStatus?.webhookUrl || '/api/webhook/evolution'}`
                  }
                  className="w-full text-xs px-2.5 py-1.5 bg-slate-100 border border-slate-200 rounded-lg font-mono text-slate-700 select-all"
                />
                <button
                  type="button"
                  onClick={handleCopyWebhookUrl}
                  title="Copiar URL para configurar na Evolution API"
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shrink-0 flex items-center gap-1"
                >
                  {copiedWebhook ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedWebhook ? 'Copiado' : 'Copiar'}</span>
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">
                Cole esta URL na configuração de Webhook da sua instância Evolution API para receber mensagens recebidas e eventos de conexão.
              </p>
            </div>
          </div>

          {/* Histórico Recente de Webhooks Recebidos */}
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-indigo-600" />
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Eventos do Webhook Recebidos
                </h3>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">
                {webhookLogs.length} eventos
              </span>
            </div>

            <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 text-xs">
              {webhookLogs.length === 0 ? (
                <p className="text-slate-400 py-4 text-center text-[11px]">
                  Nenhum evento de webhook recebido ainda.
                </p>
              ) : (
                webhookLogs.map((log) => (
                  <div key={log.id} className="py-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-slate-800 text-[11px]">{log.event}</span>
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded font-semibold ${
                            log.status === 'processed'
                              ? 'bg-emerald-100 text-emerald-800'
                              : log.status === 'duplicate'
                              ? 'bg-slate-100 text-slate-600'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {log.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 truncate mt-0.5">{log.summary}</p>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString('pt-BR')}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Guia Prático Passo a Passo: Onde pegar os dados da Evolution API */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <Info className="w-5 h-5 text-indigo-600" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Onde pegar esses dados da Evolution API?
            </h3>
            <p className="text-xs text-slate-500">
              Guia rápido para conectar seu WhatsApp próprio ao LUMOS CRM
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-600">
          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
            <span className="font-bold text-slate-900 font-mono text-[11px] block text-indigo-700">
              1. EVOLUTION_API_URL
            </span>
            <p>
              É o endereço web onde a sua Evolution API está rodando.
            </p>
            <p className="text-slate-500 text-[11px]">
              <strong>Exemplos:</strong> <code className="bg-white px-1 py-0.5 rounded border border-slate-200">https://evolution.suaempresa.com.br</code> ou se estiver rodando no seu computador via Docker: <code className="bg-white px-1 py-0.5 rounded border border-slate-200">http://localhost:8080</code>.
            </p>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
            <span className="font-bold text-slate-900 font-mono text-[11px] block text-indigo-700">
              2. EVOLUTION_API_KEY
            </span>
            <p>
              É a chave de segurança (API Token) que protege a sua Evolution API contra acessos não autorizados.
            </p>
            <p className="text-slate-500 text-[11px]">
              <strong>Onde fica:</strong> Fica no arquivo <code className="bg-white px-1 py-0.5 rounded border border-slate-200">.env</code> do servidor onde a Evolution API foi instalada, no campo <code className="bg-white px-1 py-0.5 rounded border border-slate-200">AUTHENTICATION_API_KEY</code>.
            </p>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
            <span className="font-bold text-slate-900 font-mono text-[11px] block text-indigo-700">
              3. EVOLUTION_INSTANCE_NAME
            </span>
            <p>
              É o identificador/nome da conexão que você criou dentro da Evolution API.
            </p>
            <p className="text-slate-500 text-[11px]">
              <strong>Exemplos:</strong> <code className="bg-white px-1 py-0.5 rounded border border-slate-200">lumus-comercial</code> ou <code className="bg-white px-1 py-0.5 rounded border border-slate-200">whatsapp-vendas</code>. Você define esse nome ao criar a instância.
            </p>
          </div>

          <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1.5">
            <span className="font-bold text-slate-900 font-mono text-[11px] block text-indigo-700">
              4. WEBHOOK_SECRET (Opcional)
            </span>
            <p>
              Uma senha ou chave secreta qualquer criada por você para garantir que apenas sua Evolution API envie eventos ao CRM.
            </p>
            <p className="text-slate-500 text-[11px]">
              Se não quiser validar segredo no webhook, basta deixar em branco.
            </p>
          </div>
        </div>

        <div className="p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-lg text-xs text-indigo-900 space-y-1">
          <p className="font-bold">Ainda não tem a Evolution API instalada?</p>
          <p className="leading-relaxed">
            Não se preocupe: <strong>todo o restante do LUMOS CRM funciona normalmente sem ela!</strong> Você pode cadastrar leads, arrastar cards no Kanban, agendar tarefas e ver relatórios.
            Para testar todo o CRM imediatamente com dados prontos, vá em <strong>Configurações</strong> e clique em <strong>"Gerar Dados de Demonstração"</strong>.
          </p>
        </div>
      </div>
    </div>
  );
};
