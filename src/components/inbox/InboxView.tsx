import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search,
  Send,
  UserPlus,
  Check,
  CheckCheck,
  Clock,
  AlertCircle,
  ExternalLink,
  MessageSquare,
  AlertTriangle,
  ArrowLeft,
  Paperclip,
  Zap,
  FileText,
  Bell,
  BellOff,
  Volume2,
  VolumeX,
  Smartphone,
  X,
  Loader2,
  MailOpen,
  CheckCircle2,
  RotateCcw,
} from 'lucide-react';
import {
  Conversation,
  Message,
  Lead,
  PipelineStage,
  WhatsAppInstance,
  UserProfile,
  QuickReply,
  isProfileActive,
} from '../../types/crm.ts';
import { formatPhoneDisplay, formatTimeSP, formatCurrencyBRL, formatDateSP } from '../../utils/formatters.ts';
import {
  subscribeMessages,
  sendMessage,
  sendMediaMessage,
  updateLead,
  createLead,
  markConversationRead,
  markConversationUnread,
  assignConversation,
  setConversationStatus,
  subscribeQuickReplies,
} from '../../services/crmService.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useToast } from '../common/Toast.tsx';
import { isAlertSoundEnabled, setAlertSoundEnabled, playAlertSound } from '../../hooks/useIncomingMessageAlerts.ts';

interface InboxViewProps {
  conversations: Conversation[];
  leads: Lead[];
  stages: PipelineStage[];
  instances: WhatsAppInstance[];
  team: UserProfile[];
  focusConversationId: string | null;
  onFocusConversation: (id: string | null) => void;
  onOpenLead: (lead: Lead) => void;
  onNavigateToIntegration: () => void;
}

type Scope = 'mine' | 'unassigned' | 'all';

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

function initials(name?: string | null) {
  if (!name || !/^\p{L}/u.test(name.trim())) return '#';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date();
  y.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return 'Hoje';
  if (same(d, y)) return 'Ontem';
  return formatDateSP(iso);
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

export const InboxView: React.FC<InboxViewProps> = ({
  conversations,
  leads,
  stages,
  instances,
  team,
  focusConversationId,
  onFocusConversation,
  onOpenLead,
  onNavigateToIntegration,
}) => {
  const { user, profile, isManager } = useAuth();
  const { success, error } = useToast();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [inputMessage, setInputMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [scope, setScope] = useState<Scope>(isManager ? 'all' : 'mine');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [instanceFilter, setInstanceFilter] = useState<string>('all');
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [showQuick, setShowQuick] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [soundOn, setSoundOn] = useState(isAlertSoundEnabled());
  const [notifPermission, setNotifPermission] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  const drafts = useRef<Map<string, string>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesBoxRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const selectedConvId = focusConversationId;
  const instanceById = useMemo(() => new Map(instances.map((i) => [i.id, i])), [instances]);
  const activeTeam = useMemo(() => team.filter((u) => isProfileActive(u)), [team]);

  useEffect(() => subscribeQuickReplies(setQuickReplies), []);

  // Seleciona a primeira conversa no desktop quando nada está selecionado
  useEffect(() => {
    if (!selectedConvId && conversations.length > 0 && window.matchMedia('(min-width: 768px)').matches) {
      const first = conversations.find((c) => c.status !== 'closed' && (isManager || c.assignedTo === user?.uid || !c.assignedTo));
      if (first) onFocusConversation(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations.length]);

  // Mensagens da conversa selecionada em tempo real
  useEffect(() => {
    if (!selectedConvId) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    setMessages([]);
    const unsubscribe = subscribeMessages(selectedConvId, (msgs) => {
      setMessages(msgs);
      setLoadingMessages(false);
    });
    return () => unsubscribe();
  }, [selectedConvId]);

  // Rola só a área de mensagens (scrollIntoView rolaria a página inteira)
  useEffect(() => {
    const box = messagesBoxRef.current;
    if (box) box.scrollTo({ top: box.scrollHeight, behavior: messages.length > 40 ? 'auto' : 'smooth' });
  }, [messages.length, selectedConvId]);

  const activeConversation = conversations.find((c) => c.id === selectedConvId) || null;
  const activeInstance = activeConversation?.instanceId ? instanceById.get(activeConversation.instanceId) || null : null;

  // Marca como lida ao abrir / ao receber mensagem com a conversa aberta
  useEffect(() => {
    if (activeConversation && (activeConversation.unreadCount || 0) > 0 && document.visibilityState === 'visible') {
      markConversationRead(activeConversation.id);
    }
  }, [activeConversation?.id, activeConversation?.unreadCount]);

  // Rascunho por conversa
  useEffect(() => {
    setInputMessage(selectedConvId ? drafts.current.get(selectedConvId) || '' : '');
    setPendingFile(null);
    setShowQuick(false);
  }, [selectedConvId]);

  const activeLead = useMemo(() => {
    if (!activeConversation) return null;
    if (activeConversation.leadId) return leads.find((l) => l.id === activeConversation.leadId) || null;
    return leads.find((l) => l.phone === activeConversation.phone) || null;
  }, [activeConversation, leads]);

  const counts = useMemo(() => {
    const open = conversations.filter((c) => c.status !== 'closed');
    return {
      mine: open.filter((c) => c.assignedTo === user?.uid).length,
      unassigned: open.filter((c) => !c.assignedTo).length,
      all: open.length,
    };
  }, [conversations, user?.uid]);

  const filteredConversations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return conversations.filter((c) => {
      if (!showClosed && c.status === 'closed') return false;
      if (scope === 'mine' && c.assignedTo !== user?.uid) return false;
      if (scope === 'unassigned' && c.assignedTo) return false;
      if (instanceFilter !== 'all' && c.instanceId !== instanceFilter) return false;
      if (onlyUnread && !(c.unreadCount > 0)) return false;
      if (q) {
        const hit =
          (c.contactName || '').toLowerCase().includes(q) ||
          (c.phone || '').includes(q.replace(/\D/g, '') || q) ||
          (c.lastMessage || '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [conversations, searchQuery, scope, instanceFilter, onlyUnread, showClosed, user?.uid]);

  // Permissão de resposta (mesma regra do servidor)
  const sendBlockReason = useMemo(() => {
    if (!activeConversation || !user) return 'Selecione uma conversa.';
    if (!activeConversation.instanceId || (!activeInstance && activeConversation.instanceId !== 'demo')) {
      return 'Conversa sem número de WhatsApp vinculado.';
    }
    if (activeConversation.instanceId === 'demo') return 'Conversa de demonstração: não é possível enviar.';
    const inst = activeInstance!;
    const allowed =
      isManager ||
      inst.ownerId === user.uid ||
      activeConversation.assignedTo === user.uid ||
      (!activeConversation.assignedTo && !inst.ownerId);
    if (!allowed) {
      return `Conversa atendida por ${activeConversation.assignedToName || inst.ownerName || 'outro vendedor'}. Peça a transferência para responder.`;
    }
    if (inst.state !== 'connected') return `O número "${inst.label}" está desconectado.`;
    return null;
  }, [activeConversation, activeInstance, isManager, user]);

  const updateInput = (value: string) => {
    setInputMessage(value);
    if (selectedConvId) drafts.current.set(selectedConvId, value);
    setShowQuick(value.startsWith('/'));
  };

  const autoGrow = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };
  useEffect(autoGrow, [inputMessage]);

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!activeConversation || sendBlockReason || isSending) return;
    const text = inputMessage.trim();
    if (!text && !pendingFile) return;

    setIsSending(true);
    try {
      if (pendingFile) {
        const base64 = await fileToBase64(pendingFile);
        const res = await sendMediaMessage(activeConversation, {
          base64,
          mimetype: pendingFile.type || 'application/octet-stream',
          fileName: pendingFile.name,
          caption: text,
        });
        if (!res.success) throw new Error(res.error);
        setPendingFile(null);
      } else {
        const res = await sendMessage(activeConversation, text);
        if (!res.success) throw new Error(res.error);
      }
      updateInput('');
    } catch (err: any) {
      error('Mensagem não enviada', err.message);
    } finally {
      setIsSending(false);
      textareaRef.current?.focus();
    }
  };

  const onPickFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      error('Arquivo muito grande', 'O limite é 3 MB por arquivo.');
      return;
    }
    setPendingFile(file);
    textareaRef.current?.focus();
  };

  const handleMoveStage = async (newStageId: string) => {
    if (!activeLead || !user || !profile) return;
    try {
      await updateLead(activeLead.id, { stageId: newStageId }, { uid: user.uid, name: profile.name });
      success('Etapa do lead atualizada!');
    } catch (err: any) {
      error('Erro ao atualizar etapa', err.message);
    }
  };

  const handleCreateLeadFromContact = async () => {
    if (!activeConversation || !user || !profile) return;
    try {
      await createLead(
        {
          name: activeConversation.contactName || 'Contato WhatsApp',
          phone: activeConversation.phone,
          source: 'WhatsApp Direto',
          stageId: stages[0]?.id || '',
          ownerId: activeConversation.assignedTo || user.uid,
          ownerName: activeConversation.assignedToName || profile.name,
          value: 0,
          notes: `Lead criado a partir de conversa no WhatsApp${activeConversation.instanceLabel ? ` (${activeConversation.instanceLabel})` : ''}.`,
          tags: ['Inbound WhatsApp'],
          consentMessaging: true,
          consentSource: 'Conversa WhatsApp',
          consentDate: new Date().toISOString(),
        },
        { uid: user.uid, name: profile.name }
      );
      success('Lead criado com sucesso!');
    } catch (err: any) {
      error('Erro ao converter contato em lead', err.message);
    }
  };

  const handleAssign = async (uid: string) => {
    if (!activeConversation || !user || !profile) return;
    const target = uid ? activeTeam.find((u) => u.uid === uid) : null;
    try {
      await assignConversation(activeConversation, target ? { uid: target.uid, name: target.name } : null, {
        uid: user.uid,
        name: profile.name,
      });
      success(target ? `Conversa com ${target.name}` : 'Conversa sem responsável');
    } catch (err: any) {
      error('Erro ao transferir', err.message);
    }
  };

  const canReassign =
    !!activeConversation && (isManager || activeConversation.assignedTo === user?.uid || !activeConversation.assignedTo);

  const filteredQuick = useMemo(() => {
    const q = inputMessage.startsWith('/') ? inputMessage.slice(1).toLowerCase() : '';
    return quickReplies.filter((r) => !q || r.title.toLowerCase().includes(q) || r.body.toLowerCase().includes(q)).slice(0, 8);
  }, [quickReplies, inputMessage]);

  const applyQuickReply = (r: QuickReply) => {
    const firstName = (activeLead?.name || activeConversation?.contactName || '').split(' ')[0];
    const text = r.body.replace(/\{nome\}/gi, /^\+?\d/.test(firstName) ? '' : firstName).replace(/\s+,/g, ',');
    updateInput(text);
    setShowQuick(false);
    textareaRef.current?.focus();
  };

  const enableNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    const p = await Notification.requestPermission();
    setNotifPermission(p);
    if (p === 'granted') success('Notificações ativadas', 'Você será avisado de mensagens novas mesmo em outra aba.');
  };

  const noInstances = instances.length === 0;
  const disconnectedMine = instances.filter((i) => i.ownerId === user?.uid && i.state !== 'connected');

  // ---------------------------------------------------------------- render
  const listPane = (
    <div
      className={`${selectedConvId ? 'hidden md:flex' : 'flex'} md:col-span-4 lg:col-span-3 flex-col min-h-0 bg-slate-50/50 border-r border-slate-200`}
    >
      <div className="p-3 border-b border-slate-200 bg-white space-y-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Buscar nome, número ou mensagem..."
            className="w-full text-xs pl-8 pr-3 py-2 border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-hidden focus:border-indigo-500"
          />
        </div>
        <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
          {(
            [
              ['mine', 'Minhas', counts.mine],
              ['unassigned', 'Sem dono', counts.unassigned],
              ['all', 'Todas', counts.all],
            ] as [Scope, string, number][]
          ).map(([key, label, n]) => (
            <button
              key={key}
              onClick={() => setScope(key)}
              className={`px-2 py-1 rounded-md transition-colors ${
                scope === key ? 'bg-indigo-600 text-white font-semibold' : 'hover:bg-slate-100'
              }`}
            >
              {label} <span className="tabular-nums opacity-80">{n}</span>
            </button>
          ))}
        </div>
        {instances.length > 1 && (
          <select
            value={instanceFilter}
            onChange={(e) => setInstanceFilter(e.target.value)}
            className="w-full text-[11px] px-2 py-1 border border-slate-200 rounded-md bg-white"
            aria-label="Filtrar por número"
          >
              <option value="all">Todos os números</option>
              {instances.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        )}
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} className="accent-indigo-600" />
            Não lidas
          </label>
          <label className="inline-flex items-center gap-1 text-[11px] text-slate-600 cursor-pointer select-none">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="accent-indigo-600" />
            Encerradas
          </label>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
        {filteredConversations.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400 space-y-1">
            <MessageSquare className="w-6 h-6 mx-auto text-slate-300" />
            <p>{scope === 'mine' ? 'Nenhuma conversa com você agora.' : 'Nenhuma conversa encontrada.'}</p>
            {scope === 'mine' && counts.unassigned > 0 && (
              <button onClick={() => setScope('unassigned')} className="text-indigo-600 font-semibold hover:underline">
                Ver {counts.unassigned} sem dono
              </button>
            )}
          </div>
        ) : (
          filteredConversations.map((conv) => {
            const isSelected = conv.id === selectedConvId;
            const inst = conv.instanceId ? instanceById.get(conv.instanceId) : null;
            return (
              <button
                type="button"
                key={conv.id}
                onClick={() => onFocusConversation(conv.id)}
                className={`w-full text-left p-3 transition-colors border-l-3 ${
                  isSelected ? 'bg-white border-indigo-600' : 'border-transparent hover:bg-slate-100/60'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-600 flex items-center justify-center font-bold text-[11px] shrink-0">
                    {initials(conv.contactName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <span className={`text-xs truncate ${conv.unreadCount > 0 ? 'font-bold text-slate-900' : 'font-semibold text-slate-800'}`}>
                        {conv.contactName || formatPhoneDisplay(conv.phone)}
                      </span>
                      <span className={`text-[10px] font-mono tabular-nums shrink-0 ${conv.unreadCount > 0 ? 'text-indigo-600 font-bold' : 'text-slate-400'}`}>
                        {formatTimeSP(conv.lastMessageAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className={`text-[11px] truncate ${conv.unreadCount > 0 ? 'text-slate-700' : 'text-slate-500'}`}>
                        {conv.lastMessageFromMe && <span className="text-slate-400">Você: </span>}
                        {conv.lastMessage || 'Sem mensagens'}
                      </p>
                      {conv.unreadCount > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center bg-emerald-500 text-white text-[10px] rounded-full font-bold shrink-0">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5 text-[10px] text-slate-400">
                      {(inst || conv.instanceLabel) && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 max-w-[60%]">
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              inst?.state === 'connected' ? 'bg-emerald-500' : 'bg-slate-300'
                            }`}
                          />
                          <span className="truncate">{inst?.label || conv.instanceLabel}</span>
                        </span>
                      )}
                      <span className="truncate">
                        {conv.assignedToName ? `→ ${conv.assignedTo === user?.uid ? 'você' : conv.assignedToName}` : 'sem responsável'}
                      </span>
                      {conv.status === 'closed' && <span className="text-slate-400">· encerrada</span>}
                    </div>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  // Agrupa mensagens por dia
  const groupedMessages = useMemo(() => {
    const groups: { day: string; items: Message[] }[] = [];
    for (const m of messages) {
      const d = dayLabel(m.timestamp);
      const last = groups[groups.length - 1];
      if (last && last.day === d) last.items.push(m);
      else groups.push({ day: d, items: [m] });
    }
    return groups;
  }, [messages]);

  const chatPane = (
    <div className={`${selectedConvId ? 'flex' : 'hidden md:flex'} md:col-span-8 lg:col-span-6 flex-col min-h-0 bg-white`}>
      {activeConversation ? (
        <>
          {/* Topo */}
          <div className="px-3 py-2.5 border-b border-slate-200 flex items-center gap-2 bg-white shrink-0">
            <button
              onClick={() => onFocusConversation(null)}
              className="md:hidden p-1.5 -ml-1 text-slate-500 hover:bg-slate-100 rounded-md"
              aria-label="Voltar para a lista"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="w-9 h-9 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0">
              {initials(activeConversation.contactName)}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-slate-900 truncate">{activeConversation.contactName}</h3>
              <p className="text-[11px] text-slate-500 truncate">
                <span className="font-mono">{formatPhoneDisplay(activeConversation.phone)}</span>
                {(activeInstance || activeConversation.instanceLabel) && (
                  <>
                    {' · via '}
                    <span className="font-semibold text-slate-600">{activeInstance?.label || activeConversation.instanceLabel}</span>
                  </>
                )}
              </p>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {canReassign && (
                <select
                  value={activeConversation.assignedTo || ''}
                  onChange={(e) => handleAssign(e.target.value)}
                  className="hidden sm:block max-w-[9.5rem] text-[11px] px-2 py-1 border border-slate-200 rounded-md bg-white"
                  title="Responsável pela conversa"
                >
                  <option value="">Sem responsável</option>
                  {activeTeam.map((u) => (
                    <option key={u.uid} value={u.uid}>
                      {u.uid === user?.uid ? `${u.name} (você)` : u.name}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={() => {
                  markConversationUnread(activeConversation.id).catch(() => undefined);
                  onFocusConversation(null);
                }}
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md"
                title="Marcar como não lida"
              >
                <MailOpen className="w-4 h-4" />
              </button>
              <button
                onClick={() =>
                  setConversationStatus(activeConversation.id, activeConversation.status === 'closed' ? 'open' : 'closed')
                    .then(() => success(activeConversation.status === 'closed' ? 'Conversa reaberta' : 'Conversa encerrada'))
                    .catch((e) => error('Erro', e.message))
                }
                className="p-1.5 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-md"
                title={activeConversation.status === 'closed' ? 'Reabrir conversa' : 'Encerrar atendimento'}
              >
                {activeConversation.status === 'closed' ? <RotateCcw className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Mensagens */}
          <div ref={messagesBoxRef} className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-5 py-4 space-y-3 bg-[#f5f3ef]">
            {loadingMessages ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />
              </div>
            ) : messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-xs text-slate-500 space-y-1">
                <MessageSquare className="w-8 h-8 text-slate-300" />
                <p className="font-medium">Nenhuma mensagem nesta conversa ainda.</p>
                <p className="text-[11px] text-slate-400">Escreva abaixo para iniciar o contato.</p>
              </div>
            ) : (
              groupedMessages.map((g) => (
                <div key={g.day} className="space-y-1.5">
                  <div className="flex justify-center py-1">
                    <span className="px-2.5 py-0.5 text-[10px] font-semibold text-slate-500 bg-white/80 rounded-full shadow-xs">{g.day}</span>
                  </div>
                  {g.items.map((msg) => (
                    <MessageBubble key={msg.id} msg={msg} currentUserName={profile?.name} />
                  ))}
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Envio */}
          {sendBlockReason ? (
            <div className="p-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-600 flex items-center justify-between gap-3 shrink-0">
              <span className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                <span>{sendBlockReason}</span>
              </span>
              {activeInstance && activeInstance.state !== 'connected' && (
                <button onClick={onNavigateToIntegration} className="text-indigo-600 font-semibold hover:underline shrink-0">
                  Conectar
                </button>
              )}
              {!activeConversation.assignedTo && !sendBlockReason.includes('desconectado') && (
                <button onClick={() => handleAssign(user!.uid)} className="text-indigo-600 font-semibold hover:underline shrink-0">
                  Assumir conversa
                </button>
              )}
            </div>
          ) : (
            <form onSubmit={handleSend} className="border-t border-slate-200 bg-white shrink-0 relative">
              {showQuick && filteredQuick.length > 0 && (
                <div className="absolute bottom-full left-3 right-3 mb-2 bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto z-10">
                  <div className="px-3 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-100 flex items-center justify-between">
                    Respostas rápidas
                    <button type="button" onClick={() => setShowQuick(false)} className="text-slate-400 hover:text-slate-700" aria-label="Fechar">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {filteredQuick.map((r) => (
                    <button
                      type="button"
                      key={r.id}
                      onClick={() => applyQuickReply(r)}
                      className="w-full text-left px-3 py-2 hover:bg-indigo-50 transition-colors"
                    >
                      <p className="text-xs font-semibold text-slate-800">/{r.title}</p>
                      <p className="text-[11px] text-slate-500 line-clamp-2">{r.body}</p>
                    </button>
                  ))}
                </div>
              )}
              {showQuick && filteredQuick.length === 0 && quickReplies.length === 0 && (
                <div className="absolute bottom-full left-3 right-3 mb-2 bg-white border border-slate-200 rounded-xl shadow-lg p-3 text-[11px] text-slate-500 z-10">
                  Nenhuma resposta rápida cadastrada. Crie em <strong>Configurações → Respostas rápidas</strong>.
                </div>
              )}

              {pendingFile && (
                <div className="mx-3 mt-2 flex items-center gap-2 px-2.5 py-1.5 bg-indigo-50 border border-indigo-100 rounded-lg text-xs text-indigo-900">
                  <FileText className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate flex-1">{pendingFile.name}</span>
                  <span className="text-[10px] text-indigo-500 shrink-0">{(pendingFile.size / 1024).toFixed(0)} KB</span>
                  <button type="button" onClick={() => setPendingFile(null)} className="text-indigo-400 hover:text-indigo-700" aria-label="Remover anexo">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <div className="p-2.5 flex items-end gap-1.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*,video/mp4,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                  onChange={(e) => {
                    onPickFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg shrink-0"
                  title="Anexar arquivo (até 3 MB)"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowQuick((v) => !v)}
                  className={`p-2 rounded-lg shrink-0 ${showQuick ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`}
                  title="Respostas rápidas (ou digite /)"
                >
                  <Zap className="w-4 h-4" />
                </button>
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={inputMessage}
                  onChange={(e) => updateInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      if (showQuick && filteredQuick.length > 0 && inputMessage.startsWith('/')) {
                        applyQuickReply(filteredQuick[0]);
                      } else {
                        handleSend();
                      }
                    }
                    if (e.key === 'Escape') setShowQuick(false);
                  }}
                  onPaste={(e) => {
                    const f = (e.clipboardData?.files?.[0] as File | undefined) || undefined;
                    if (f) {
                      e.preventDefault();
                      onPickFile(f);
                    }
                  }}
                  placeholder={pendingFile ? 'Legenda (opcional)…' : 'Escreva uma mensagem'}
                  title="Enter envia · Shift+Enter quebra linha · / abre as respostas rápidas"
                  className="flex-1 resize-none text-sm px-3 py-2 border border-slate-200 rounded-xl focus:outline-hidden focus:border-indigo-500 bg-white leading-snug max-h-[140px]"
                />
                <button
                  type="submit"
                  disabled={(!inputMessage.trim() && !pendingFile) || isSending}
                  className="inline-flex items-center justify-center w-10 h-10 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors shadow-xs disabled:opacity-40 shrink-0"
                  aria-label="Enviar"
                >
                  {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </form>
          )}
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-xs text-slate-400">
          <MessageSquare className="w-10 h-10 text-slate-300 mb-2" />
          <p className="font-semibold text-slate-600">Selecione uma conversa para atender</p>
          <p className="text-slate-400 mt-1">Ou abra um lead e clique em WhatsApp para iniciar.</p>
        </div>
      )}
    </div>
  );

  const detailsPane = (
    <div className="hidden lg:flex lg:col-span-3 flex-col min-h-0 bg-slate-50/50 p-4 overflow-y-auto space-y-4 border-l border-slate-200">
      {activeLead ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Ficha do Lead</span>
            <button onClick={() => onOpenLead(activeLead)} className="text-xs font-semibold text-indigo-600 hover:underline inline-flex items-center gap-1">
              <span>Abrir ficha</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-900">{activeLead.name}</h4>
            <p className="text-xs text-slate-500 mt-0.5">{activeLead.company || 'Pessoa física'}</p>
            <p className="text-xs font-mono text-slate-600 mt-1">{formatPhoneDisplay(activeLead.phone)}</p>
          </div>
          <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-500">Valor:</span>
              <span className="font-bold text-slate-900 font-mono tabular-nums">{formatCurrencyBRL(activeLead.value)}</span>
            </div>
            <div className="pt-2 border-t border-slate-100">
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Etapa no funil</label>
              <select
                value={activeLead.stageId}
                onChange={(e) => handleMoveStage(e.target.value)}
                className="w-full text-xs px-2 py-1.5 bg-slate-50 border border-slate-200 rounded font-medium"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.order}. {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="space-y-2 text-xs">
            <div>
              <span className="text-[11px] text-slate-400 block">Origem</span>
              <span className="font-medium text-slate-700">{activeLead.source}</span>
            </div>
            <div>
              <span className="text-[11px] text-slate-400 block">Responsável pelo lead</span>
              <span className="font-medium text-slate-700">{activeLead.ownerName}</span>
            </div>
            {activeLead.tags?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {activeLead.tags.map((t) => (
                  <span key={t} className="px-1.5 py-0.5 text-[10px] bg-slate-100 text-slate-600 rounded">
                    {t}
                  </span>
                ))}
              </div>
            )}
            {activeLead.notes && (
              <div>
                <span className="text-[11px] text-slate-400 block">Observações</span>
                <p className="text-slate-600 text-[11px] mt-0.5 whitespace-pre-wrap">{activeLead.notes}</p>
              </div>
            )}
          </div>
        </div>
      ) : activeConversation ? (
        <div className="space-y-4">
          <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-2">
            <p className="font-semibold">Contato ainda não é um lead</p>
            <p className="text-[11px]">Cadastre no funil para acompanhar etapa, valor e tarefas.</p>
            <button
              onClick={handleCreateLeadFromContact}
              className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs rounded-lg transition-colors shadow-xs"
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>Criar lead desta conversa</span>
            </button>
          </div>
          <div className="p-3 bg-white rounded-lg border border-slate-200 text-xs space-y-1">
            <div>
              <span className="text-slate-400">Telefone:</span> <span className="font-mono">{formatPhoneDisplay(activeConversation.phone)}</span>
            </div>
            <div>
              <span className="text-slate-400">Nome:</span> {activeConversation.contactName}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-center text-xs text-slate-400 py-10">Nenhum contato selecionado</div>
      )}

      {/* Responsável no mobile/tablet fica no topo; aqui mostramos o canal */}
      {activeInstance && (
        <div className="p-3 bg-white rounded-lg border border-slate-200 text-xs space-y-1">
          <div className="flex items-center gap-1.5 font-semibold text-slate-700">
            <Smartphone className="w-3.5 h-3.5" /> {activeInstance.label}
          </div>
          <div className="text-slate-500">
            {activeInstance.phone ? formatPhoneDisplay(activeInstance.phone) : 'sem número pareado'} ·{' '}
            {activeInstance.state === 'connected' ? 'conectado' : 'desconectado'}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="bg-white sm:rounded-xl border-y sm:border border-slate-200 overflow-hidden shadow-xs flex flex-col h-[calc(100dvh-4rem)] sm:h-[calc(100dvh-6rem)]">
      {/* Avisos */}
      {(noInstances || disconnectedMine.length > 0) && (
        <div className="bg-amber-50 px-4 py-2 border-b border-amber-200 text-xs text-amber-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="truncate">
              {noInstances
                ? 'Nenhum número de WhatsApp conectado ao CRM ainda.'
                : `Seu número "${disconnectedMine[0].label}" está desconectado — você não recebe mensagens novas nele.`}
            </span>
          </div>
          <button onClick={onNavigateToIntegration} className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline shrink-0">
            Conectar
          </button>
        </div>
      )}
      {notifPermission === 'default' && (
        <div className="bg-indigo-50 px-4 py-1.5 border-b border-indigo-100 text-[11px] text-indigo-900 flex items-center justify-between gap-3 shrink-0">
          <span className="flex items-center gap-1.5">
            <Bell className="w-3.5 h-3.5" /> Receba aviso de mensagens novas mesmo com o CRM em outra aba.
          </span>
          <button onClick={enableNotifications} className="font-semibold underline shrink-0">
            Ativar notificações
          </button>
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 grid-rows-[minmax(0,1fr)] md:grid-cols-12 min-h-0 overflow-hidden">
        {listPane}
        {chatPane}
        {detailsPane}
      </div>

      {/* Rodapé discreto: som */}
      <div className="hidden md:flex items-center justify-end gap-3 px-3 py-1 border-t border-slate-100 text-[10px] text-slate-400 shrink-0">
        {notifPermission === 'denied' && (
          <span className="inline-flex items-center gap-1">
            <BellOff className="w-3 h-3" /> Notificações bloqueadas no navegador
          </span>
        )}
        <button
          onClick={() => {
            const next = !soundOn;
            setSoundOn(next);
            setAlertSoundEnabled(next);
            if (next) playAlertSound();
          }}
          className="inline-flex items-center gap-1 hover:text-slate-700"
        >
          {soundOn ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
          Som de nova mensagem: {soundOn ? 'ligado' : 'desligado'}
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------

const MessageBubble: React.FC<{ msg: Message; currentUserName?: string }> = React.memo(({ msg, currentUserName }) => {
  const isFromMe = msg.fromMe;
  const showSender = isFromMe && msg.senderName && msg.senderName !== currentUserName;
  const media = renderMedia(msg);
  const isPlaceholderBody = msg.mediaType !== 'text' && /^(📷|🎤|🎬|📄|Figurinha|\[)/.test(msg.body || '');

  return (
    <div className={`flex ${isFromMe ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] sm:max-w-[70%] rounded-xl px-2.5 py-1.5 text-[13px] shadow-xs ${
          isFromMe ? 'bg-[#d9fdd3] text-slate-900 rounded-tr-sm' : 'bg-white text-slate-900 rounded-tl-sm'
        } ${msg.status === 'failed' ? 'ring-1 ring-rose-300' : ''}`}
      >
        {showSender && <p className="text-[10px] font-semibold text-emerald-700 mb-0.5">{msg.senderName}</p>}
        {media}
        {msg.body && !(media && isPlaceholderBody) && <p className="whitespace-pre-wrap break-words leading-snug px-0.5">{msg.body}</p>}
        <div className="flex items-center justify-end gap-1 mt-0.5 text-[10px] text-slate-500 tabular-nums">
          <span>{formatTimeSP(msg.timestamp)}</span>
          {isFromMe && (
            <span title={msg.status === 'failed' ? msg.errorMessage || 'Falha no envio' : msg.status}>
              {msg.status === 'sending' && <Clock className="w-3 h-3" />}
              {msg.status === 'sent' && <Check className="w-3 h-3" />}
              {msg.status === 'delivered' && <CheckCheck className="w-3 h-3" />}
              {msg.status === 'read' && <CheckCheck className="w-3 h-3 text-sky-500" />}
              {msg.status === 'failed' && <AlertCircle className="w-3 h-3 text-rose-500" />}
            </span>
          )}
        </div>
        {msg.status === 'failed' && (
          <p className="text-[10px] text-rose-600 mt-0.5">Não enviada{msg.errorMessage ? `: ${msg.errorMessage.slice(0, 80)}` : ''}</p>
        )}
      </div>
    </div>
  );
});

function renderMedia(msg: Message) {
  if (msg.mediaType === 'text') return null;
  if (!msg.mediaUrl) {
    return (
      <p className="text-[12px] italic text-slate-500 px-0.5">
        {msg.mediaType === 'audio' ? '🎤 Áudio' : msg.mediaType === 'image' ? '📷 Imagem' : msg.mediaType === 'video' ? '🎬 Vídeo' : msg.mediaType === 'sticker' ? 'Figurinha' : `📄 ${msg.fileName || 'Documento'}`}
        {' (arquivo indisponível)'}
      </p>
    );
  }
  switch (msg.mediaType) {
    case 'image':
    case 'sticker':
      return (
        <a href={msg.mediaUrl} target="_blank" rel="noreferrer" className="block mb-1">
          <img
            src={msg.mediaUrl}
            alt={msg.mediaType === 'sticker' ? 'Figurinha' : 'Imagem'}
            loading="lazy"
            className={`rounded-lg ${msg.mediaType === 'sticker' ? 'w-28 h-28 object-contain' : 'max-h-72 w-auto object-cover'}`}
          />
        </a>
      );
    case 'audio':
      return <audio controls preload="none" src={msg.mediaUrl} className="w-60 max-w-full h-10 my-0.5" />;
    case 'video':
      return <video controls preload="metadata" src={msg.mediaUrl} className="rounded-lg max-h-72 max-w-full mb-1" />;
    default:
      return (
        <a
          href={msg.mediaUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-2.5 py-2 mb-1 bg-black/5 rounded-lg hover:bg-black/10 transition-colors"
        >
          <FileText className="w-5 h-5 text-slate-500 shrink-0" />
          <span className="text-xs font-medium truncate">{msg.fileName || 'Documento'}</span>
        </a>
      );
  }
}
