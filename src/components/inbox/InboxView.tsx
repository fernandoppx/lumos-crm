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
  Phone,
  Building,
  Tag,
  ArrowRight,
  Filter,
  MessageSquare,
  AlertTriangle,
} from 'lucide-react';
import { Conversation, Message, Lead, PipelineStage, WhatsAppConnectionState } from '../../types/crm.ts';
import {
  formatPhoneDisplay,
  formatTimeSP,
  formatDateTimeSP,
  formatRelativeTime,
  formatCurrencyBRL,
} from '../../utils/formatters.ts';
import {
  subscribeMessages,
  sendMessage,
  updateLead,
  createLead,
} from '../../services/crmService.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useToast } from '../common/Toast.tsx';

interface InboxViewProps {
  conversations: Conversation[];
  leads: Lead[];
  stages: PipelineStage[];
  whatsAppStatus: WhatsAppConnectionState['status'];
  selectedLeadForChat?: Lead | null;
  onClearSelectedLead?: () => void;
  onOpenLead: (lead: Lead) => void;
  onNavigateToIntegration: () => void;
}

export const InboxView: React.FC<InboxViewProps> = ({
  conversations,
  leads,
  stages,
  whatsAppStatus,
  selectedLeadForChat,
  onClearSelectedLead,
  onOpenLead,
  onNavigateToIntegration,
}) => {
  const { user, profile } = useAuth();
  const { success, error, warning } = useToast();

  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Se veio redirecionado de um lead, seleciona ou foca a conversa desse lead
  useEffect(() => {
    if (selectedLeadForChat) {
      const existingConv = conversations.find(
        (c) => c.leadId === selectedLeadForChat.id || c.phone === selectedLeadForChat.phone
      );
      if (existingConv) {
        setSelectedConvId(existingConv.id);
      }
    }
  }, [selectedLeadForChat, conversations]);

  // Se nenhuma conversa selecionada e houver lista, seleciona a primeira por padrão em desktop
  useEffect(() => {
    if (!selectedConvId && conversations.length > 0) {
      setSelectedConvId(conversations[0].id);
    }
  }, [conversations, selectedConvId]);

  // Assinatura em tempo real das mensagens da conversa selecionada
  useEffect(() => {
    if (!selectedConvId) {
      setMessages([]);
      return;
    }

    const unsubscribe = subscribeMessages(selectedConvId, (msgs) => {
      setMessages(msgs);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [selectedConvId]);

  // Conversa ativa selecionada
  const activeConversation = conversations.find((c) => c.id === selectedConvId) || null;

  // Lead correspondente
  const activeLead = useMemo(() => {
    if (!activeConversation) return null;
    if (activeConversation.leadId) {
      return leads.find((l) => l.id === activeConversation.leadId) || null;
    }
    return leads.find((l) => l.phone === activeConversation.phone) || null;
  }, [activeConversation, leads]);

  // Filtragem das conversas na lista lateral esquerda
  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesName = c.contactName.toLowerCase().includes(query);
        const matchesPhone = c.phone.includes(query);
        const matchesMsg = c.lastMessage.toLowerCase().includes(query);
        if (!matchesName && !matchesPhone && !matchesMsg) return false;
      }
      return true;
    });
  }, [conversations, searchQuery, statusFilter]);

  // Envio de mensagem (via botão ou Enter)
  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputMessage.trim() || !activeConversation || !user || !profile) return;

    if (whatsAppStatus !== 'connected') {
      warning(
        'WhatsApp desconectado',
        'A mensagem será gravada no sistema, mas a Evolution API está desconectada no momento.'
      );
    }

    const text = inputMessage.trim();
    setInputMessage('');
    setIsSending(true);

    try {
      const res = await sendMessage(activeConversation, text, {
        uid: user.uid,
        name: profile.name,
      });

      if (!res.success) {
        error('Falha no envio da mensagem', res.error);
      }
    } catch (err: any) {
      error('Erro ao enviar mensagem', err.message);
    } finally {
      setIsSending(false);
    }
  };

  // Atalho para mover o lead de etapa comercial no Kanban diretamente da caixa de entrada
  const handleMoveStage = async (newStageId: string) => {
    if (!activeLead || !user || !profile) return;
    try {
      await updateLead(
        activeLead.id,
        { stageId: newStageId },
        { uid: user.uid, name: profile.name }
      );
      success('Etapa do lead atualizada!');
    } catch (err: any) {
      error('Erro ao atualizar etapa', err.message);
    }
  };

  // Criar lead a partir de conversa desconhecida
  const handleCreateLeadFromContact = async () => {
    if (!activeConversation || !user || !profile) return;
    try {
      const leadId = await createLead(
        {
          name: activeConversation.contactName || 'Contato WhatsApp',
          phone: activeConversation.phone,
          source: 'WhatsApp Direto',
          stageId: stages[0]?.id || '',
          ownerId: user.uid,
          ownerName: profile.name,
          value: 0,
          notes: `Lead criado diretamente a partir de conversa na Caixa de Entrada WhatsApp.`,
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

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs flex flex-col h-[calc(100vh-7.5rem)]">
      {/* Aviso se o WhatsApp estiver desconectado */}
      {whatsAppStatus !== 'connected' && (
        <div className="bg-amber-50 px-4 py-2 border-b border-amber-200 text-xs text-amber-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              WhatsApp atualmente <strong>{whatsAppStatus === 'connecting' ? 'aguardando leitura do QR Code' : 'desconectado'}</strong>. As mensagens digitadas serão registradas no CRM.
            </span>
          </div>
          <button
            onClick={onNavigateToIntegration}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 underline"
          >
            Conectar QR Code &rarr;
          </button>
        </div>
      )}

      {/* Grid de 3 Colunas: Lista Conversas | Janela Chat | Dados do Lead */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-12 min-h-0 divide-x divide-slate-200">
        {/* COLUNA 1: Lista de Conversas (4 colunas) */}
        <div className="md:col-span-4 lg:col-span-3 flex flex-col min-h-0 bg-slate-50/50">
          {/* Busca na lista */}
          <div className="p-3 border-b border-slate-200 bg-white space-y-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar conversa..."
                className="w-full text-xs pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg bg-slate-50 focus:bg-white focus:outline-hidden focus:border-indigo-500"
              />
            </div>
            <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-2 py-0.5 rounded transition-colors ${
                  statusFilter === 'all' ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'hover:bg-slate-100'
                }`}
              >
                Todas ({conversations.length})
              </button>
              <button
                onClick={() => setStatusFilter('open')}
                className={`px-2 py-0.5 rounded transition-colors ${
                  statusFilter === 'open' ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'hover:bg-slate-100'
                }`}
              >
                Abertas
              </button>
            </div>
          </div>

          {/* Lista com scroll */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {filteredConversations.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                Nenhuma conversa encontrada.
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const isSelected = conv.id === selectedConvId;
                return (
                  <div
                    key={conv.id}
                    onClick={() => setSelectedConvId(conv.id)}
                    className={`p-3 cursor-pointer transition-colors ${
                      isSelected ? 'bg-white border-l-3 border-indigo-600 shadow-xs' : 'hover:bg-slate-100/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-xs text-slate-900 truncate">
                        {conv.contactName || formatPhoneDisplay(conv.phone)}
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono tabular-nums shrink-0">
                        {formatTimeSP(conv.lastMessageAt)}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-500 truncate mt-1">
                      {conv.lastMessage || 'Sem mensagens'}
                    </p>

                    <div className="flex items-center justify-between mt-1.5 text-[10px] text-slate-400">
                      <span className="font-mono">{formatPhoneDisplay(conv.phone)}</span>
                      {conv.unreadCount > 0 && (
                        <span className="px-1.5 py-0.2 bg-indigo-600 text-white rounded-full font-bold">
                          {conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* COLUNA 2: Janela de Chat (5 colunas em desktop médio, 6 em grande) */}
        <div className="md:col-span-8 lg:col-span-6 flex flex-col min-h-0 bg-white">
          {activeConversation ? (
            <>
              {/* Topo do Chat */}
              <div className="p-3.5 border-b border-slate-200 flex items-center justify-between bg-white shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0">
                    {activeConversation.contactName?.charAt(0).toUpperCase() || 'C'}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-xs font-bold text-slate-900 truncate">
                      {activeConversation.contactName}
                    </h3>
                    <p className="text-[11px] text-slate-500 font-mono">
                      {formatPhoneDisplay(activeConversation.phone)}
                    </p>
                  </div>
                </div>

                {activeLead && (
                  <span className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-semibold bg-indigo-50 text-indigo-700 rounded border border-indigo-200">
                    Lead Cadastrado
                  </span>
                )}
              </div>

              {/* Mensagens com histórico cronológico */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/40">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-xs text-slate-400 space-y-1">
                    <MessageSquare className="w-8 h-8 text-slate-300" />
                    <p className="font-medium">Nenhuma mensagem nesta conversa ainda.</p>
                    <p className="text-[11px] text-slate-400">Digite uma resposta abaixo para iniciar o contato comercial.</p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isFromMe = msg.fromMe;
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isFromMe ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[80%] rounded-xl px-3.5 py-2 text-xs shadow-xs ${
                            isFromMe
                              ? 'bg-indigo-600 text-white rounded-br-xs'
                              : 'bg-white text-slate-800 border border-slate-200 rounded-bl-xs'
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{msg.body}</p>

                          <div
                            className={`flex items-center justify-end gap-1 mt-1 text-[10px] font-mono tabular-nums ${
                              isFromMe ? 'text-indigo-200' : 'text-slate-400'
                            }`}
                          >
                            <span>{formatTimeSP(msg.timestamp)}</span>
                            {isFromMe && (
                              <span>
                                {msg.status === 'sending' && <Clock className="w-3 h-3 text-indigo-300" />}
                                {msg.status === 'sent' && <Check className="w-3 h-3 text-indigo-200" />}
                                {msg.status === 'delivered' && <CheckCheck className="w-3 h-3 text-indigo-200" />}
                                {msg.status === 'read' && <CheckCheck className="w-3 h-3 text-emerald-300 font-bold" />}
                                {msg.status === 'failed' && <AlertCircle className="w-3 h-3 text-rose-300" />}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input de envio (Enter para enviar e botão de envio) */}
              <form
                onSubmit={handleSendMessage}
                className="p-3 border-t border-slate-200 bg-white flex items-center gap-2 shrink-0"
              >
                <input
                  type="text"
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="Escreva sua resposta (Enter para enviar)..."
                  className="flex-1 text-xs px-3.5 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 bg-white"
                />
                <button
                  type="submit"
                  disabled={!inputMessage.trim() || isSending}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs rounded-lg transition-colors shadow-xs disabled:opacity-50 shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Enviar</span>
                </button>
              </form>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-xs text-slate-400">
              <MessageSquare className="w-10 h-10 text-slate-300 mb-2" />
              <p className="font-semibold text-slate-600">Selecione uma conversa para atender</p>
              <p className="text-slate-400 mt-1">
                Escolha um contato à esquerda ou inicie a partir do quadro Kanban.
              </p>
            </div>
          )}
        </div>

        {/* COLUNA 3: Informações do Lead (3 colunas em desktop) */}
        <div className="hidden lg:flex lg:col-span-3 flex-col min-h-0 bg-slate-50/50 p-4 overflow-y-auto space-y-4">
          {activeLead ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Ficha do Lead
                </span>
                <button
                  onClick={() => onOpenLead(activeLead)}
                  className="text-xs font-semibold text-indigo-600 hover:underline inline-flex items-center gap-1"
                >
                  <span>Abrir Ficha</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>

              <div>
                <h4 className="text-sm font-bold text-slate-900">{activeLead.name}</h4>
                <p className="text-xs text-slate-500 mt-0.5">{activeLead.company || 'Pessoa Física'}</p>
                <p className="text-xs font-mono text-slate-600 mt-1">
                  {formatPhoneDisplay(activeLead.phone)}
                </p>
              </div>

              {/* Oportunidade e Etapa */}
              <div className="p-3 bg-white rounded-lg border border-slate-200 space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">Valor Oportunidade:</span>
                  <span className="font-bold text-slate-900 font-mono tabular-nums">
                    {formatCurrencyBRL(activeLead.value)}
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-100">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                    Mover Etapa no Kanban:
                  </label>
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

              {/* Informações adicionais */}
              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-[11px] text-slate-400 block">Origem:</span>
                  <span className="font-medium text-slate-700">{activeLead.source}</span>
                </div>
                <div>
                  <span className="text-[11px] text-slate-400 block">Responsável:</span>
                  <span className="font-medium text-slate-700">{activeLead.ownerName}</span>
                </div>
                {activeLead.notes && (
                  <div>
                    <span className="text-[11px] text-slate-400 block">Observações:</span>
                    <p className="text-slate-600 text-[11px] italic mt-0.5">{activeLead.notes}</p>
                  </div>
                )}
              </div>
            </div>
          ) : activeConversation ? (
            <div className="space-y-4">
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-2">
                <p className="font-semibold">Contato não vinculado a um Lead</p>
                <p className="text-[11px]">
                  Este número de WhatsApp ainda não está cadastrado no funil comercial do LUMOS CRM.
                </p>
                <button
                  onClick={handleCreateLeadFromContact}
                  className="w-full inline-flex items-center justify-center gap-1.5 py-2 px-3 bg-amber-600 hover:bg-amber-700 text-white font-semibold text-xs rounded-lg transition-colors shadow-xs"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Criar Lead a partir desta Conversa</span>
                </button>
              </div>

              <div className="p-3 bg-white rounded-lg border border-slate-200 text-xs space-y-1 font-mono">
                <div>
                  <span className="text-slate-400">Telefone:</span> {formatPhoneDisplay(activeConversation.phone)}
                </div>
                <div>
                  <span className="text-slate-400">Nome:</span> {activeConversation.contactName}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center text-xs text-slate-400 py-10">
              Nenhum contato selecionado
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
