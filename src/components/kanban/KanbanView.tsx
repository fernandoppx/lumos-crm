import React, { useState, useMemo } from 'react';
import {
  Plus,
  Filter,
  DollarSign,
  User,
  Clock,
  Phone,
  MessageSquare,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { Lead, PipelineStage, LEAD_SOURCES } from '../../types/crm.ts';
import {
  formatCurrencyBRL,
  formatPhoneDisplay,
  formatRelativeTime,
} from '../../utils/formatters.ts';
import { moveLeadStage } from '../../services/crmService.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useToast } from '../common/Toast.tsx';

interface KanbanViewProps {
  leads: Lead[];
  stages: PipelineStage[];
  onOpenLead: (lead: Lead) => void;
  onOpenNewLeadModal: () => void;
  onOpenWhatsApp: (lead: Lead) => void;
}

export const KanbanView: React.FC<KanbanViewProps> = ({
  leads,
  stages,
  onOpenLead,
  onOpenNewLeadModal,
  onOpenWhatsApp,
}) => {
  const { user, profile } = useAuth();
  const { success, error } = useToast();

  const [filterOwner, setFilterOwner] = useState<string>('all');
  const [filterSource, setFilterSource] = useState<string>('all');
  const [filterPeriod, setFilterPeriod] = useState<string>('all');
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [dragOverStageId, setDragOverStageId] = useState<string | null>(null);

  // Vendedores únicos
  const uniqueOwners = useMemo(() => {
    const map = new Map<string, string>();
    leads.forEach((l) => {
      if (l.ownerId && l.ownerName) map.set(l.ownerId, l.ownerName);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [leads]);

  // Filtragem dos leads exibidos nas colunas
  const filteredLeads = useMemo(() => {
    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    return leads.filter((lead) => {
      if (filterOwner !== 'all' && lead.ownerId !== filterOwner) return false;
      if (filterSource !== 'all' && lead.source !== filterSource) return false;

      if (filterPeriod === '7days') {
        const time = new Date(lead.createdAt).getTime();
        if (time < sevenDaysAgo) return false;
      } else if (filterPeriod === '30days') {
        const time = new Date(lead.createdAt).getTime();
        if (time < thirtyDaysAgo) return false;
      }

      return true;
    });
  }, [leads, filterOwner, filterSource, filterPeriod]);

  // Agrupamento por etapa
  const leadsByStage = useMemo(() => {
    const map = new Map<string, Lead[]>();
    stages.forEach((s) => map.set(s.id, []));

    filteredLeads.forEach((lead) => {
      const list = map.get(lead.stageId);
      if (list) {
        list.push(lead);
      } else if (stages.length > 0) {
        // Fallback caso a etapa antiga tenha sido excluída
        map.get(stages[0].id)?.push(lead);
      }
    });

    return map;
  }, [filteredLeads, stages]);

  // Totalizadores por etapa (soma de valores)
  const stageTotals = useMemo(() => {
    const totals = new Map<string, { count: number; totalValue: number }>();
    stages.forEach((s) => {
      const stageLeads = leadsByStage.get(s.id) || [];
      const totalValue = stageLeads.reduce((acc, l) => acc + (l.value || 0), 0);
      totals.set(s.id, { count: stageLeads.length, totalValue });
    });
    return totals;
  }, [stages, leadsByStage]);

  // Handlers de Drag and Drop
  const handleDragStart = (leadId: string) => {
    setDraggedLeadId(leadId);
  };

  const handleDragOver = (e: React.DragEvent, stageId: string) => {
    e.preventDefault();
    if (dragOverStageId !== stageId) {
      setDragOverStageId(stageId);
    }
  };

  const handleDragLeave = (stageId: string) => {
    if (dragOverStageId === stageId) {
      setDragOverStageId(null);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetStage: PipelineStage) => {
    e.preventDefault();
    setDragOverStageId(null);
    if (!draggedLeadId || !user || !profile) return;

    const lead = leads.find((l) => l.id === draggedLeadId);
    if (!lead || lead.stageId === targetStage.id) {
      setDraggedLeadId(null);
      return;
    }

    const fromStage = stages.find((s) => s.id === lead.stageId) || {
      id: lead.stageId,
      name: 'Etapa anterior',
    };

    try {
      await moveLeadStage(
        lead.id,
        { id: fromStage.id, name: fromStage.name },
        { id: targetStage.id, name: targetStage.name },
        { uid: user.uid, name: profile.name }
      );
      success(`Lead "${lead.name}" movido para "${targetStage.name}"`);
    } catch (err: any) {
      error('Erro ao mover lead', err.message);
    } finally {
      setDraggedLeadId(null);
    }
  };

  return (
    <div className="space-y-4 flex flex-col h-[calc(100vh-7.5rem)]">
      {/* Barra de Filtros e Total do Funil */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <span className="text-slate-500 font-semibold flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span>Filtrar Pipeline:</span>
          </span>

          {/* Vendedor */}
          <select
            value={filterOwner}
            onChange={(e) => setFilterOwner(e.target.value)}
            className="text-xs px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium"
          >
            <option value="all">Todos os Vendedores</option>
            {uniqueOwners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>

          {/* Origem */}
          <select
            value={filterSource}
            onChange={(e) => setFilterSource(e.target.value)}
            className="text-xs px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium"
          >
            <option value="all">Todas as Origens</option>
            {LEAD_SOURCES.map((src) => (
              <option key={src} value={src}>
                {src}
              </option>
            ))}
          </select>

          {/* Período */}
          <select
            value={filterPeriod}
            onChange={(e) => setFilterPeriod(e.target.value)}
            className="text-xs px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 font-medium"
          >
            <option value="all">Todo o Histórico</option>
            <option value="7days">Últimos 7 dias</option>
            <option value="30days">Últimos 30 dias</option>
          </select>

          {(filterOwner !== 'all' || filterSource !== 'all' || filterPeriod !== 'all') && (
            <button
              onClick={() => {
                setFilterOwner('all');
                setFilterSource('all');
                setFilterPeriod('all');
              }}
              className="text-xs text-indigo-600 hover:text-indigo-800 underline font-medium"
            >
              Limpar
            </button>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-semibold leading-none">
              Total no Funil
            </span>
            <span className="text-xs font-bold text-slate-900 font-mono tabular-nums leading-tight mt-0.5 block">
              {formatCurrencyBRL(filteredLeads.reduce((acc, l) => acc + (l.value || 0), 0))}
            </span>
          </div>
          <button
            onClick={onOpenNewLeadModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Adicionar Lead</span>
          </button>
        </div>
      </div>

      {/* Colunas do Kanban com Rolagem Horizontal Suave */}
      <div className="flex-1 overflow-x-auto pb-4">
        <div className="flex items-start gap-3.5 h-full min-w-max">
          {stages.map((stage) => {
            const stageLeads = leadsByStage.get(stage.id) || [];
            const totals = stageTotals.get(stage.id) || { count: 0, totalValue: 0 };
            const isDropTarget = dragOverStageId === stage.id;

            return (
              <div
                key={stage.id}
                onDragOver={(e) => handleDragOver(e, stage.id)}
                onDragLeave={() => handleDragLeave(stage.id)}
                onDrop={(e) => handleDrop(e, stage)}
                className={`w-72 bg-slate-100/80 rounded-xl p-3 flex flex-col h-full border transition-colors ${
                  isDropTarget
                    ? 'border-indigo-500 bg-indigo-50/50 ring-2 ring-indigo-500/20'
                    : 'border-slate-200/80'
                }`}
              >
                {/* Cabeçalho da Coluna */}
                <div className="pb-2.5 mb-2 border-b border-slate-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: stage.color }}
                      />
                      <h3 className="text-xs font-bold text-slate-900 truncate">
                        {stage.name}
                      </h3>
                    </div>
                    <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-white text-slate-700 rounded-md border border-slate-200 font-mono tabular-nums">
                      {totals.count}
                    </span>
                  </div>

                  {/* Valor acumulado da etapa */}
                  <div className="text-[11px] font-mono text-slate-500 mt-1 tabular-nums">
                    {formatCurrencyBRL(totals.totalValue)}
                  </div>
                </div>

                {/* Lista de Cartões de Leads */}
                <div className="flex-1 overflow-y-auto space-y-2.5 pr-0.5">
                  {stageLeads.length === 0 ? (
                    <div className="h-28 border border-dashed border-slate-200 rounded-lg flex items-center justify-center text-[11px] text-slate-400">
                      Nenhum lead nesta etapa
                    </div>
                  ) : (
                    stageLeads.map((lead) => {
                      const isDragging = draggedLeadId === lead.id;

                      return (
                        <div
                          key={lead.id}
                          draggable
                          onDragStart={() => handleDragStart(lead.id)}
                          onClick={() => onOpenLead(lead)}
                          className={`bg-white p-3 rounded-lg border border-slate-200 shadow-xs hover:border-indigo-300 hover:shadow-sm transition-all cursor-grab active:cursor-grabbing ${
                            isDragging ? 'opacity-40 scale-95' : 'opacity-100'
                          }`}
                        >
                          {/* Nome e Ação WhatsApp */}
                          <div className="flex items-start justify-between gap-2">
                            <h4 className="text-xs font-bold text-slate-900 leading-tight">
                              {lead.name}
                            </h4>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenWhatsApp(lead);
                              }}
                              title="Abrir WhatsApp"
                              className="p-1 text-slate-400 hover:text-emerald-600 rounded transition-colors"
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Empresa ou Telefone */}
                          <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                            {lead.company || formatPhoneDisplay(lead.phone)}
                          </p>

                          {/* Tags discretas */}
                          {lead.tags && lead.tags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {lead.tags.slice(0, 2).map((t) => (
                                <span
                                  key={t}
                                  className="text-[10px] text-slate-600 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200"
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Rodapé do cartão: Valor e Responsável */}
                          <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                            <span className="font-bold text-slate-900 font-mono tabular-nums">
                              {formatCurrencyBRL(lead.value)}
                            </span>
                            <span className="text-[10px] text-slate-500 font-medium truncate max-w-[90px]">
                              {lead.ownerName.split(' ')[0]}
                            </span>
                          </div>

                          {/* Indicador de Último Contato */}
                          {lead.lastContactAt && (
                            <div className="mt-1 text-[10px] text-slate-400 font-mono tabular-nums">
                              Contato: {formatRelativeTime(lead.lastContactAt)}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
