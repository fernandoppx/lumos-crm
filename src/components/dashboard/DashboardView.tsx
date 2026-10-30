import React, { useState, useMemo } from 'react';
import {
  Users,
  TrendingUp,
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
  DollarSign,
  Calendar,
  ArrowUpRight,
  Filter,
  MessageCircle,
} from 'lucide-react';
import { Lead, Task, PipelineStage, Activity } from '../../types/crm.ts';
import {
  formatCurrencyBRL,
  formatDateTimeSP,
  formatRelativeTime,
} from '../../utils/formatters.ts';
import { NavTab } from '../layout/Sidebar.tsx';

interface DashboardViewProps {
  leads: Lead[];
  tasks: Task[];
  stages: PipelineStage[];
  activities: Activity[];
  onNavigate: (tab: NavTab) => void;
  onOpenLead: (lead: Lead) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  leads,
  tasks,
  stages,
  activities,
  onNavigate,
  onOpenLead,
}) => {
  const [periodFilter, setPeriodFilter] = useState<'all' | 'today' | '7days' | '30days' | 'this_month'>('all');

  // Filtragem por período baseada no createdAt do lead
  const filteredLeads = useMemo(() => {
    if (periodFilter === 'all') return leads;

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sevenDaysAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();

    return leads.filter((lead) => {
      const createdTime = new Date(lead.createdAt).getTime();
      if (isNaN(createdTime)) return true;

      switch (periodFilter) {
        case 'today':
          return createdTime >= startOfToday;
        case '7days':
          return createdTime >= sevenDaysAgo;
        case '30days':
          return createdTime >= thirtyDaysAgo;
        case 'this_month':
          return createdTime >= startOfMonth;
        default:
          return true;
      }
    });
  }, [leads, periodFilter]);

  // Cálculo dos indicadores a partir dos dados reais
  const metrics = useMemo(() => {
    const total = filteredLeads.length;

    // Identificação de estágios por tipo ou nome
    const wonStageIds = new Set(
      stages.filter((s) => s.isWon || s.name.toLowerCase().includes('ganho')).map((s) => s.id)
    );
    const lostStageIds = new Set(
      stages.filter((s) => s.isLost || s.name.toLowerCase().includes('perdid')).map((s) => s.id)
    );
    const newStageIds = new Set(
      stages.filter((s) => s.order === 1 || s.name.toLowerCase().includes('novo')).map((s) => s.id)
    );
    const negotiationStageIds = new Set(
      stages
        .filter(
          (s) =>
            s.name.toLowerCase().includes('negocia') ||
            s.name.toLowerCase().includes('proposta') ||
            s.name.toLowerCase().includes('atendimento')
        )
        .map((s) => s.id)
    );

    let novos = 0;
    let emNegociacao = 0;
    let ganhos = 0;
    let perdidos = 0;
    let valorTotalPipeline = 0;
    let valorTotalGanho = 0;

    filteredLeads.forEach((l) => {
      if (wonStageIds.has(l.stageId)) {
        ganhos++;
        valorTotalGanho += l.value || 0;
      } else if (lostStageIds.has(l.stageId)) {
        perdidos++;
      } else if (newStageIds.has(l.stageId)) {
        novos++;
        valorTotalPipeline += l.value || 0;
      } else {
        valorTotalPipeline += l.value || 0;
        if (negotiationStageIds.has(l.stageId)) {
          emNegociacao++;
        }
      }
    });

    const taxaConversao = total > 0 ? ((ganhos / total) * 100).toFixed(1) : '0.0';

    // Tarefas atrasadas (dueDate < agora e não concluídas)
    const nowMs = Date.now();
    const tarefasAtrasadas = tasks.filter(
      (t) => !t.completed && new Date(t.dueDate).getTime() < nowMs
    ).length;

    // Leads sem contato recente (> 7 dias sem lastContactAt ou lastContactAt > 7 dias)
    const seteDiasAtras = nowMs - 7 * 24 * 60 * 60 * 1000;
    const leadsSemContato = filteredLeads.filter((l) => {
      if (wonStageIds.has(l.stageId) || lostStageIds.has(l.stageId)) return false;
      if (!l.lastContactAt) {
        return new Date(l.createdAt).getTime() < seteDiasAtras;
      }
      return new Date(l.lastContactAt).getTime() < seteDiasAtras;
    });

    return {
      total,
      novos,
      emNegociacao,
      ganhos,
      perdidos,
      taxaConversao,
      valorTotalPipeline,
      valorTotalGanho,
      tarefasAtrasadas,
      leadsSemContato,
    };
  }, [filteredLeads, stages, tasks]);

  return (
    <div className="space-y-6">
      {/* Barra superior de filtro por período */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200">
        <div className="flex items-center gap-2 text-xs text-slate-600 font-medium">
          <Filter className="w-4 h-4 text-slate-400" />
          <span>Período de Análise:</span>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs font-medium w-full sm:w-auto overflow-x-auto">
          {[
            { id: 'all', label: 'Todo o Período' },
            { id: 'today', label: 'Hoje' },
            { id: '7days', label: 'Últimos 7 dias' },
            { id: '30days', label: 'Últimos 30 dias' },
            { id: 'this_month', label: 'Este Mês' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setPeriodFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-md transition-colors whitespace-nowrap shrink-0 ${
                periodFilter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid de Métricas Principais (60-30-10 discipline) */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>Total de Leads</span>
            <Users className="w-4 h-4 text-slate-400" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono tabular-nums">
            {metrics.total}
          </p>
          <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
            <span>Pipeline:</span>
            <span className="font-semibold text-slate-800 font-mono tabular-nums">
              {formatCurrencyBRL(metrics.valorTotalPipeline)}
            </span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>Leads Novos</span>
            <Clock className="w-4 h-4 text-indigo-500" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono tabular-nums">
            {metrics.novos}
          </p>
          <p className="text-xs text-slate-500 mt-1">Aguardando atendimento inicial</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>Em Negociação</span>
            <TrendingUp className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2 font-mono tabular-nums">
            {metrics.emNegociacao}
          </p>
          <p className="text-xs text-slate-500 mt-1">Propostas e reuniões ativas</p>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200">
          <div className="flex items-center justify-between text-slate-500 text-xs font-medium">
            <span>Vendas Ganhas</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-emerald-600 mt-2 font-mono tabular-nums">
            {metrics.ganhos}
          </p>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
            <span>Receita:</span>
            <span className="font-semibold text-emerald-700 font-mono tabular-nums">
              {formatCurrencyBRL(metrics.valorTotalGanho)}
            </span>
          </div>
        </div>
      </div>

      {/* Linha Secundária de Indicadores Operacionais */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-slate-500">Taxa de Conversão</span>
            <p className="text-xl font-bold text-slate-900 mt-1 font-mono tabular-nums">
              {metrics.taxaConversao}%
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">Leads fechados / total de cadastros</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 font-bold text-xs">
            %
          </div>
        </div>

        <div
          onClick={() => onNavigate('tasks')}
          className="bg-white p-4 rounded-xl border border-slate-200 hover:border-rose-300 transition-colors cursor-pointer flex items-center justify-between group"
        >
          <div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-rose-600">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>Tarefas Atrasadas</span>
            </div>
            <p className="text-xl font-bold text-rose-600 mt-1 font-mono tabular-nums">
              {metrics.tarefasAtrasadas}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5 group-hover:text-rose-500 transition-colors">
              Clique para gerenciar tarefas pendentes &rarr;
            </p>
          </div>
          <ArrowUpRight className="w-4 h-4 text-slate-300 group-hover:text-rose-500 transition-colors" />
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-amber-600">
              <Clock className="w-3.5 h-3.5" />
              <span>Sem Contato Recente</span>
            </div>
            <p className="text-xl font-bold text-amber-600 mt-1 font-mono tabular-nums">
              {metrics.leadsSemContato.length}
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">Sem interação há mais de 7 dias</p>
          </div>
          <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600 font-bold text-xs">
            7d+
          </div>
        </div>
      </div>

      {/* Seção Dupla: Leads Sem Contato Recente e Atividades Recentes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Bloco 1: Leads que precisam de atenção */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Leads que Precisam de Contato</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Contatos estagnados no pipeline sem follow-up recente
              </p>
            </div>
            <button
              onClick={() => onNavigate('leads')}
              className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:underline"
            >
              Ver todos ({metrics.total})
            </button>
          </div>

          <div className="divide-y divide-slate-100 flex-1 overflow-y-auto max-h-80">
            {metrics.leadsSemContato.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                Nenhum lead estagnado no período. Todos com contato em dia!
              </div>
            ) : (
              metrics.leadsSemContato.slice(0, 5).map((lead) => (
                <div
                  key={lead.id}
                  onClick={() => onOpenLead(lead)}
                  className="py-3 flex items-center justify-between hover:bg-slate-50 px-2 rounded-lg cursor-pointer transition-colors"
                >
                  <div className="min-w-0 pr-3">
                    <p className="text-xs font-semibold text-slate-900 truncate">{lead.name}</p>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                      <span>{lead.company || lead.phone}</span>
                      <span aria-hidden="true">&middot;</span>
                      <span className="text-amber-700">
                        Último contato: {formatRelativeTime(lead.lastContactAt || lead.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs font-semibold text-slate-800 font-mono tabular-nums block">
                      {formatCurrencyBRL(lead.value)}
                    </span>
                    <span className="text-[10px] text-indigo-600 hover:underline">
                      Abrir Ficha &rarr;
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Bloco 2: Linha do Tempo de Atividades Comerciais Recentes */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 flex flex-col">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Atividades Comerciais Recentes</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Histórico em tempo real de movimentações, tarefas e mensagens
              </p>
            </div>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {activities.length} registradas
            </span>
          </div>

          <div className="divide-y divide-slate-100 flex-1 overflow-y-auto max-h-80">
            {activities.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                Nenhuma atividade comercial registrada ainda.
              </div>
            ) : (
              activities.slice(0, 6).map((activity) => (
                <div key={activity.id} className="py-3 px-1 flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 mt-0.5 text-xs font-semibold">
                    {activity.userName?.charAt(0).toUpperCase() || 'S'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-800 leading-tight">
                      <span className="font-semibold text-slate-900">{activity.userName}:</span>{' '}
                      {activity.description}
                    </p>
                    <span className="text-[11px] text-slate-400 font-mono mt-0.5 block tabular-nums">
                      {formatRelativeTime(activity.timestamp)} &middot; {formatDateTimeSP(activity.timestamp)}
                    </span>
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
