import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  QrCode,
  RefreshCw,
  Power,
  Trash2,
  Smartphone,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  X,
  Pencil,
  Activity,
  ShieldCheck,
  Link2,
  Loader2,
} from 'lucide-react';
import { WhatsAppInstance, UserProfile, isProfileActive } from '../../types/crm.ts';
import { instanceApi } from '../../services/crmService.ts';
import { apiFetch } from '../../lib/api.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useToast } from '../common/Toast.tsx';
import { formatPhoneDisplay, formatRelativeTime, formatDateTimeSP } from '../../utils/formatters.ts';

interface Props {
  instances: WhatsAppInstance[];
  team: UserProfile[];
}

interface ConfigInfo {
  evolutionConfigured: boolean;
  evolutionUrlHint: string | null;
  hasServiceAccount: boolean;
  credentialMode?: 'workload_identity' | 'service_account_key' | 'application_default' | 'none';
  webhookSecretSource: string;
  appUrl: string | null;
  appUrlFromEnv: boolean;
  webhookUrl: string | null;
  legacyInstanceName: string | null;
  maxInstances: number;
}

const STATE_UI: Record<WhatsAppInstance['state'], { label: string; cls: string; dot: string }> = {
  connected: { label: 'Conectado', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', dot: 'bg-emerald-500' },
  connecting: { label: 'Aguardando QR Code', cls: 'text-amber-700 bg-amber-50 border-amber-200', dot: 'bg-amber-400' },
  disconnected: { label: 'Desconectado', cls: 'text-slate-600 bg-slate-100 border-slate-200', dot: 'bg-rose-400' },
  error: { label: 'Erro', cls: 'text-rose-700 bg-rose-50 border-rose-200', dot: 'bg-rose-500' },
};

export const WhatsAppIntegrationView: React.FC<Props> = ({ instances, team }) => {
  const { user, profile, isManager } = useAuth();
  const { success, error } = useToast();

  const [showAdd, setShowAdd] = useState(false);
  const [qrFor, setQrFor] = useState<string | null>(null);
  const [editFor, setEditFor] = useState<WhatsAppInstance | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [config, setConfig] = useState<ConfigInfo | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const activeTeam = useMemo(() => team.filter((u) => isProfileActive(u)), [team]);
  const connectedCount = instances.filter((i) => i.state === 'connected').length;
  const myInstance = instances.find((i) => i.ownerId === user?.uid);

  useEffect(() => {
    if (!isManager) return;
    apiFetch<ConfigInfo>('/api/config')
      .then(setConfig)
      .catch((e) => setConfigError(e.message));
  }, [isManager]);

  const canManage = (inst: WhatsAppInstance) => isManager || inst.ownerId === user?.uid;

  const run = async (key: string, fn: () => Promise<any>, okMsg?: string) => {
    setBusy(key);
    try {
      await fn();
      if (okMsg) success(okMsg);
    } catch (e: any) {
      error('Não foi possível concluir', e.message);
    } finally {
      setBusy(null);
    }
  };

  const handleRemove = async (inst: WhatsAppInstance) => {
    if (!window.confirm(`Remover o número "${inst.label}"? As conversas já registradas continuam no CRM.`)) return;
    setBusy(`rm:${inst.id}`);
    try {
      await instanceApi.remove(inst.id);
      success('Número removido.');
    } catch (e: any) {
      if (e.data?.canForce && window.confirm(`${e.message}\n\nRemover apenas do CRM mesmo assim?`)) {
        await instanceApi.remove(inst.id, true).catch((err) => error('Erro', err.message));
      } else {
        error('Erro ao remover', e.message);
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Números de WhatsApp</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Cada vendedor conecta o próprio WhatsApp. As conversas de cada número ficam separadas na Caixa de entrada.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {instances.length > 0 && (
            <span className="text-xs text-slate-500">
              <strong className="text-slate-800 tabular-nums">{connectedCount}</strong> de{' '}
              <strong className="text-slate-800 tabular-nums">{instances.length}</strong> conectados
            </span>
          )}
          {(isManager || !myInstance) && (
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg shadow-xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              {isManager ? 'Adicionar número' : 'Conectar meu WhatsApp'}
            </button>
          )}
        </div>
      </div>

      {/* Lista de números */}
      {instances.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-8 text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-full bg-indigo-50 flex items-center justify-center">
            <Smartphone className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Nenhum número conectado ainda</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              Clique em <strong>{isManager ? 'Adicionar número' : 'Conectar meu WhatsApp'}</strong>, dê um nome (ex.: "Vendas
              Ana") e escaneie o QR Code com o celular. Leva menos de um minuto.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {instances.map((inst) => {
            const ui = STATE_UI[inst.state] || STATE_UI.disconnected;
            const manage = canManage(inst);
            return (
              <div key={inst.id} className="bg-white rounded-xl border border-slate-200 shadow-xs p-4 flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <div className="relative shrink-0">
                    {inst.profilePicUrl ? (
                      <img src={inst.profilePicUrl} alt="" className="w-11 h-11 rounded-full object-cover bg-slate-100" />
                    ) : (
                      <div className="w-11 h-11 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-sm">
                        {inst.label.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${ui.dot}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-bold text-slate-900 truncate">{inst.label}</h3>
                      {isManager && (
                        <button
                          onClick={() => setEditFor(inst)}
                          className="p-0.5 text-slate-300 hover:text-slate-600"
                          title="Renomear / trocar responsável"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 font-mono truncate">
                      {inst.phone ? formatPhoneDisplay(inst.phone) : '— ainda não pareado —'}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate">
                      {inst.ownerName ? `Responsável: ${inst.ownerName}` : 'Compartilhado (sem responsável)'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className={`px-2 py-0.5 text-[10px] font-semibold border rounded ${ui.cls}`}>{ui.label}</span>
                  <span className="text-[10px] text-slate-400" title={inst.updatedAt ? formatDateTimeSP(inst.updatedAt) : ''}>
                    {inst.lastEventAt || inst.updatedAt ? `atualizado ${formatRelativeTime(inst.lastEventAt || inst.updatedAt).toLowerCase()}` : ''}
                  </span>
                </div>

                {inst.lastError && inst.state !== 'connected' && (
                  <p className="text-[11px] text-rose-700 bg-rose-50 border border-rose-100 rounded-md px-2 py-1.5">{inst.lastError}</p>
                )}

                {manage ? (
                  <div className="flex flex-wrap gap-1.5 pt-1 border-t border-slate-100">
                    {inst.state !== 'connected' && (
                      <button
                        onClick={() => setQrFor(inst.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md"
                      >
                        <QrCode className="w-3.5 h-3.5" /> Conectar
                      </button>
                    )}
                    <button
                      onClick={() => run(`rf:${inst.id}`, () => instanceApi.refresh(inst.id))}
                      disabled={busy === `rf:${inst.id}`}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md disabled:opacity-50"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${busy === `rf:${inst.id}` ? 'animate-spin' : ''}`} /> Verificar
                    </button>
                    {inst.state === 'connected' && (
                      <button
                        onClick={() => {
                          if (window.confirm(`Desconectar "${inst.label}"? Será preciso escanear o QR Code de novo.`)) {
                            run(`lo:${inst.id}`, () => instanceApi.logout(inst.id), 'Número desconectado.');
                          }
                        }}
                        disabled={busy === `lo:${inst.id}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 rounded-md disabled:opacity-50"
                      >
                        <Power className="w-3.5 h-3.5" /> Desconectar
                      </button>
                    )}
                    <button
                      onClick={() => handleRemove(inst)}
                      disabled={busy === `rm:${inst.id}`}
                      className="ml-auto inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-semibold text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md disabled:opacity-50"
                      title="Remover número"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400 pt-1 border-t border-slate-100">
                    Só {inst.ownerName || 'o responsável'} ou um gestor pode conectar este número.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Aviso de uso */}
      <div className="flex items-start gap-2.5 p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <p>
          A conexão por QR Code usa a Evolution API (não oficial). Use para atendimento individual: evite disparos em massa e
          mensagens não solicitadas, para não arriscar o bloqueio do número pelo WhatsApp.
        </p>
      </div>

      {/* Diagnóstico (gestores) */}
      {isManager && <DiagnosticsPanel config={config} configError={configError} instances={instances} team={activeTeam} />}

      {showAdd && profile && user && (
        <AddInstanceModal
          isManager={isManager}
          team={activeTeam}
          currentUser={{ uid: user.uid, name: profile.name }}
          onClose={() => setShowAdd(false)}
          onCreated={(inst) => {
            setShowAdd(false);
            setQrFor(inst.id);
          }}
        />
      )}

      {qrFor && <QrModal instance={instances.find((i) => i.id === qrFor) || null} instanceId={qrFor} onClose={() => setQrFor(null)} />}

      {editFor && <EditInstanceModal instance={editFor} team={activeTeam} onClose={() => setEditFor(null)} />}
    </div>
  );
};

// ---------------------------------------------------------------------------

const AddInstanceModal: React.FC<{
  isManager: boolean;
  team: UserProfile[];
  currentUser: { uid: string; name: string };
  onClose: () => void;
  onCreated: (inst: WhatsAppInstance) => void;
}> = ({ isManager, team, currentUser, onClose, onCreated }) => {
  const { error, success } = useToast();
  const [label, setLabel] = useState(isManager ? '' : `Vendas ${currentUser.name.split(' ')[0]}`);
  const [ownerId, setOwnerId] = useState<string>(currentUser.uid);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label.trim()) return;
    setSaving(true);
    try {
      const inst = await instanceApi.create(label.trim(), ownerId === '__shared' ? null : ownerId);
      success('Número criado!', 'Agora escaneie o QR Code com o celular.');
      onCreated(inst);
    } catch (err: any) {
      error('Não foi possível adicionar o número', err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isManager ? 'Adicionar número de WhatsApp' : 'Conectar meu WhatsApp'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Nome do número</label>
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={40}
            placeholder='Ex.: "Vendas Ana" ou "Comercial 2"'
            className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500"
          />
          <p className="text-[11px] text-slate-400 mt-1">Aparece na Caixa de entrada para identificar por onde a conversa chegou.</p>
        </div>
        {isManager && (
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">Responsável</label>
            <select
              value={ownerId}
              onChange={(e) => setOwnerId(e.target.value)}
              className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg bg-white"
            >
              {team.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.name}
                  {u.uid === currentUser.uid ? ' (você)' : ''}
                </option>
              ))}
              <option value="__shared">Compartilhado (toda a equipe atende)</option>
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              As conversas novas deste número vão para o responsável. O QR Code deve ser lido no celular dele.
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving || !label.trim()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
          >
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {saving ? 'Criando…' : 'Criar e gerar QR Code'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

const QrModal: React.FC<{ instance: WhatsAppInstance | null; instanceId: string; onClose: () => void }> = ({
  instance,
  instanceId,
  onClose,
}) => {
  const { success } = useToast();
  const [qr, setQr] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const announced = useRef(false);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await instanceApi.qrcode(instanceId);
      setQr(r.qrCodeBase64 || null);
      setPairingCode(r.pairingCode || null);
      if (!r.qrCodeBase64 && r.state === 'connected') {
        instanceApi.refresh(instanceId).catch(() => undefined);
      }
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // O QR Code do WhatsApp expira em ~30–40 s: renova sozinho enquanto o modal está aberto
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  // Fecha sozinho quando o webhook avisar que conectou
  useEffect(() => {
    if (instance?.state === 'connected' && !announced.current) {
      announced.current = true;
      success('WhatsApp conectado!', instance.phone ? formatPhoneDisplay(instance.phone) : instance.label);
      onClose();
    }
  }, [instance?.state, instance?.phone, instance?.label, onClose, success]);

  return (
    <Modal title={`Conectar "${instance?.label || instanceId}"`} onClose={onClose}>
      <div className="grid sm:grid-cols-2 gap-5 items-center">
        <div className="aspect-square w-full max-w-[240px] mx-auto rounded-xl border border-slate-200 bg-white flex items-center justify-center overflow-hidden">
          {loading && !qr ? (
            <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
          ) : qr ? (
            <img src={qr} alt="QR Code do WhatsApp" className="w-full h-full object-contain p-2" />
          ) : (
            <div className="p-4 text-center text-xs text-slate-500 space-y-2">
              <XCircle className="w-6 h-6 text-rose-400 mx-auto" />
              <p>{err || 'QR Code indisponível no momento.'}</p>
            </div>
          )}
        </div>
        <div className="space-y-3 text-xs text-slate-600">
          <ol className="space-y-2 list-decimal pl-4">
            <li>Abra o WhatsApp no celular deste número.</li>
            <li>
              Toque em <strong>Configurações</strong> (ou ⋮) → <strong>Aparelhos conectados</strong>.
            </li>
            <li>
              Toque em <strong>Conectar aparelho</strong> e aponte para o QR Code.
            </li>
          </ol>
          {pairingCode && (
            <p className="p-2 bg-slate-50 rounded-lg border border-slate-200">
              Ou use o código: <span className="font-mono font-bold text-slate-900 tracking-wider">{pairingCode}</span>
            </p>
          )}
          <p className="text-[11px] text-slate-400">O código renova sozinho. Esta janela fecha quando a conexão for confirmada.</p>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Gerar novo código
          </button>
        </div>
      </div>
    </Modal>
  );
};

const EditInstanceModal: React.FC<{ instance: WhatsAppInstance; team: UserProfile[]; onClose: () => void }> = ({
  instance,
  team,
  onClose,
}) => {
  const { success, error } = useToast();
  const [label, setLabel] = useState(instance.label);
  const [ownerId, setOwnerId] = useState(instance.ownerId || '__shared');
  const [saving, setSaving] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await instanceApi.update(instance.id, { label: label.trim(), ownerId: ownerId === '__shared' ? null : ownerId });
      success('Número atualizado.');
      onClose();
    } catch (err: any) {
      error('Erro ao salvar', err.message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title="Editar número" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Nome</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            maxLength={40}
            className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Responsável</label>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg bg-white">
            {team.map((u) => (
              <option key={u.uid} value={u.uid}>
                {u.name}
              </option>
            ))}
            <option value="__shared">Compartilhado (sem responsável)</option>
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50">
            Salvar
          </button>
        </div>
      </form>
    </Modal>
  );
};

const DiagnosticsPanel: React.FC<{
  config: ConfigInfo | null;
  configError: string | null;
  instances: WhatsAppInstance[];
  team: UserProfile[];
}> = ({ config, configError, instances, team }) => {
  const { success, error } = useToast();
  const { isAdmin: isAdminUser } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [importName, setImportName] = useState('');
  const [importing, setImporting] = useState(false);

  const loadLogs = async () => {
    setLoadingLogs(true);
    try {
      const r = await apiFetch<{ logs: any[] }>('/api/webhook/logs');
      setLogs(r.logs || []);
    } catch {
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const [authCheck, setAuthCheck] = useState<any | null>(null);
  const [checking, setChecking] = useState(false);
  const runAuthCheck = async () => {
    setChecking(true);
    try {
      setAuthCheck(await apiFetch('/api/admin/gcp-auth-check', { method: 'POST' }));
    } catch (e: any) {
      setAuthCheck({ ok: false, steps: [{ step: 'Chamada ao servidor', ok: false, detail: e.message }] });
    } finally {
      setChecking(false);
    }
  };

  const checks = config
    ? [
        {
          ok: config.evolutionConfigured,
          label: 'Servidor da Evolution API',
          detail: config.evolutionConfigured ? config.evolutionUrlHint || 'Configurado' : 'Defina EVOLUTION_API_URL e EVOLUTION_API_KEY na Vercel',
        },
        {
          ok: config.credentialMode === 'workload_identity',
          label: 'Acesso do servidor ao banco',
          detail:
            config.credentialMode === 'workload_identity'
              ? 'Workload Identity Federation (sem chave permanente)'
              : config.credentialMode === 'service_account_key'
                ? 'Usando chave JSON — troque por Workload Identity Federation'
                : 'Configure as variáveis GCP_* do Workload Identity Federation na Vercel',
        },
        {
          ok: config.webhookSecretSource !== 'nenhum',
          label: 'Proteção do webhook',
          detail: config.webhookSecretSource === 'nenhum' ? 'Sem segredo: webhook fechado' : `Segredo: ${config.webhookSecretSource}`,
        },
        {
          ok: Boolean(config.appUrl),
          label: 'Endereço público do CRM',
          detail: config.appUrl ? `${config.appUrl}${config.appUrlFromEnv ? '' : ' (automático)'}` : 'Defina APP_URL na Vercel',
        },
      ]
    : [];

  const legacyMissing =
    config?.legacyInstanceName && !instances.some((i) => i.id === config.legacyInstanceName) ? config.legacyInstanceName : null;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-indigo-600" />
        <h3 className="text-sm font-bold text-slate-900">Diagnóstico da integração</h3>
        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider ml-auto">só gestores</span>
      </div>
      <div className="p-5 grid lg:grid-cols-2 gap-6">
        <div className="space-y-2.5">
          {configError && <p className="text-xs text-rose-700">{configError}</p>}
          {!config && !configError && <p className="text-xs text-slate-400">Carregando…</p>}
          {checks.map((c) => (
            <div key={c.label} className="flex items-start gap-2.5">
              {c.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              )}
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800">{c.label}</p>
                <p className="text-[11px] text-slate-500 break-all">{c.detail}</p>
              </div>
            </div>
          ))}

          {config?.webhookUrl && (
            <div className="pt-2 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                <Link2 className="w-3 h-3" /> Webhook
              </span>
              <p className="font-mono break-all mt-0.5">{config.webhookUrl}</p>
              <p className="mt-1">Configurado automaticamente em cada número criado por aqui.</p>
            </div>
          )}

          {isAdminUser && (
            <div className="pt-3 border-t border-slate-100 space-y-2">
              <button
                onClick={runAuthCheck}
                disabled={checking}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} /> Testar conexão segura com o banco
              </button>
              {authCheck && (
                <div className={`p-2.5 rounded-lg border text-[11px] space-y-1 ${authCheck.ok ? 'bg-emerald-50 border-emerald-100 text-emerald-900' : 'bg-rose-50 border-rose-100 text-rose-900'}`}>
                  <p className="font-semibold">{authCheck.ok ? 'Conexão segura funcionando' : 'Falha na conexão'}</p>
                  {authCheck.vercelIdentity && (
                    <p className="font-mono break-all">
                      {authCheck.vercelIdentity.owner} / {authCheck.vercelIdentity.project} / {authCheck.vercelIdentity.environment}
                    </p>
                  )}
                  {(authCheck.steps || []).map((s: any) => (
                    <p key={s.step}>
                      {s.ok ? '✓' : '✗'} {s.step}
                      {s.detail && s.detail !== 'ok' ? ` — ${s.detail}` : ''}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {legacyMissing && (
            <div className="mt-3 p-3 rounded-lg bg-indigo-50 border border-indigo-100 text-xs text-indigo-900">
              Existe a instância antiga <strong>{legacyMissing}</strong> (EVOLUTION_INSTANCE_NAME). Ela aparece aqui sozinha assim
              que chegar a primeira mensagem, ou você pode trazê-la agora.
              <button
                onClick={() => setImportName(legacyMissing)}
                className="block mt-1.5 font-semibold underline"
              >
                Trazer para o CRM
              </button>
            </div>
          )}

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!importName.trim()) return;
              setImporting(true);
              try {
                await instanceApi.importExisting(importName.trim(), importName.trim());
                success('Número adicionado ao CRM', 'O webhook foi configurado.');
                setImportName('');
              } catch (err: any) {
                error('Erro ao importar', err.message);
              } finally {
                setImporting(false);
              }
            }}
            className="pt-3 border-t border-slate-100 flex items-center gap-2"
          >
            <input
              value={importName}
              onChange={(e) => setImportName(e.target.value)}
              placeholder="Nome de instância já existente na Evolution"
              className="flex-1 min-w-0 text-xs px-2.5 py-1.5 border border-slate-200 rounded-md"
            />
            <button
              type="submit"
              disabled={importing || !importName.trim()}
              className="px-2.5 py-1.5 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md disabled:opacity-50"
            >
              Importar
            </button>
          </form>
          {team.length > 0 && <p className="text-[10px] text-slate-400">Depois de importar, defina o responsável pelo ícone de lápis.</p>}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <Activity className="w-3.5 h-3.5" /> Últimos eventos recebidos
            </span>
            <button onClick={loadLogs} className="text-[11px] text-indigo-600 hover:underline inline-flex items-center gap-1">
              <RefreshCw className={`w-3 h-3 ${loadingLogs ? 'animate-spin' : ''}`} /> Atualizar
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 border border-slate-100 rounded-lg">
            {logs.length === 0 ? (
              <p className="p-4 text-center text-[11px] text-slate-400">Nenhum evento ainda.</p>
            ) : (
              logs.map((l) => (
                <div key={l.id} className="px-3 py-2 text-[11px] flex items-start gap-2">
                  <span
                    className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${
                      l.status === 'processed' ? 'bg-emerald-500' : l.status === 'ignored' || l.status === 'duplicate' ? 'bg-slate-300' : 'bg-rose-500'
                    }`}
                  />
                  <div className="min-w-0">
                    <p className="text-slate-700 break-words">{l.summary}</p>
                    <p className="text-slate-400 font-mono">
                      {l.event} · {formatDateTimeSP(l.timestamp)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4" onClick={onClose}>
    <div
      className="bg-white rounded-xl w-full max-w-lg shadow-2xl border border-slate-200"
      onClick={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={title}
    >
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
        <h4 className="text-sm font-bold text-slate-900">{title}</h4>
        <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded" aria-label="Fechar">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>
);
