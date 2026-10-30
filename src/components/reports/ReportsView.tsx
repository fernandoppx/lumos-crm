import React, { useState, useMemo } from 'react';
import {
  BarChart3,
  TrendingUp,
  PieChart,
  Users,
  DollarSign,
  Filter,
  CheckCircle2,
  Calendar,
} from 'lucide-react';
import { Lead, PipelineStage, Task, LEAD_SOURCES } from '../../types/crm.ts';
import { formatCurrencyBRL } from '../../utils/formatters.ts';

interface ReportsViewProps {
  leads: Lead[];
  stages: PipelineStage[];
  tasks: Task[];
}

export const ReportsView: React.FC<ReportsViewProps> = ({
  leads,
  stages,
  tasks,
}) => {
  const [period, setPeriod] = useState<'30days' | '90days' | 'all'>('all');

  const filteredLeads = useMemo(() => {
    if (period === 'all') return leads;
    const now = Date.now();
    const days = period === '30days' ? 30 : 90;
    const threshold = now - days * 24 * 60 * 60 * 1000;
    return leads.filter((l) => new Date(l.createdAt).getTime() >= threshold);
  }, [leads, period]);

  // Estatísticas por etapa do funil
  const funnelStats = useMemo(() => {
    const total = filteredLeads.length;
    return stages.map((stage) => {
      const stageLeads = filteredLeads.filter((l) => l.stageId === stage.id);
      const totalVal = stageLeads.reduce((acc, l) => acc + (l.value || 0), 0);
      const pct = total > 0 ? (stageLeads.length / total) * 100 : 0;
      return {
        stage,
        count: stageLeads.length,
        totalValue: totalVal,
        percentage: pct.toFixed(1),
      };
    });
  }, [filteredLeads, stages]);

  // Estatísticas por origem
  const sourceStats = useMemo(() => {
    const map = new Map<string, { count: number; wonCount: number; value: number }>();
    const wonStageIds = new Set(
      stages.filter((s) => s.isWon || s.name.toLowerCase().includes('ganho')).map((s) => s.id)
    );

    filteredLeads.forEach((l) => {
      const s = l.source || 'Outros';
      const cur = map.get(s) || { count: 0, wonCount: 0, value: 0 };
      cur.count++;
      cur.value += l.value || 0;
      if (wonStageIds.has(l.stageId)) {
        cur.wonCount++;
      }
      map.set(s, cur);
    });

    return Array.from(map.entries())
      .map(([source, data]) => ({
        source,
        ...data,
        conversionRate: data.count > 0 ? ((data.wonCount / data.count) * 100).toFixed(1) : '0.0',
      }))
      .sort((a, b) => b.count - a.count);
  }, [filteredLeads, stages]);

  // Estatísticas por Vendedor
  const ownerStats = useMemo(() => {
    const map = new Map<string, { name: string; count: number; wonCount: number; wonValue: number }>();
    const wonStageIds = new Set(
      stages.filter((s) => s.isWon || s.name.toLowerCase().includes('ganho')).map((s) => s.id)
    );

    filteredLeads.forEach((l) => {
      const ownerId = l.ownerId || 'sem_dono';
      const cur = map.get(ownerId) || { name: l.ownerName || 'Não atribuído', count: 0, wonCount: 0, wonValue: 0 };
      cur.count++;
      if (wonStageIds.has(l.stageId)) {
        cur.wonCount++;
        cur.wonValue += l.value || 0;
      }
      map.set(ownerId, cur);
    });

    return Array.from(map.values())
      .map((d) => ({
        ...d,
        conversionRate: d.count > 0 ? ((d.wonCount / d.count) * 100).toFixed(1) : '0.0',
      }))
      .sort((a, b) => b.wonValue - a.wonValue);
  }, [filteredLeads, stages]);

  return (
    <div className="space-y-6">
      {/* Filtro de Período */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-2 text-xs text-slate-700 font-semibold">
          <BarChart3 className="w-4 h-4 text-indigo-600" />
          <span>Relatórios de Performance Comercial</span>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs font-medium">
          <button
            onClick={() => setPeriod('30days')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              period === '30days' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600'
            }`}
          >
            Últimos 30 dias
          </button>
          <button
            onClick={() => setPeriod('90days')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              period === '90days' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600'
            }`}
          >
            Últimos 90 dias
          </button>
          <button
            onClick={() => setPeriod('all')}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              period === 'all' ? 'bg-white text-slate-900 shadow-xs font-semibold' : 'text-slate-600'
            }`}
          >
            Todo o Histórico
          </button>
        </div>
      </div>

      {/* Funil Comercial por Etapa */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Distribuição do Funil de Vendas</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Volume e valor das oportunidades concentradas em cada etapa do Kanban
          </p>
        </div>

        <div className="space-y-3 pt-2">
          {funnelStats.map((item) => (
            <div key={item.stage.id} className="space-y-1">
              <div className="flex justify-between items-center text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: item.stage.color }}
                  />
                  <span className="font-semibold text-slate-800 truncate">{item.stage.name}</span>
                  <span className="text-[11px] text-slate-400 font-mono">
                    ({item.count} leads &middot; {item.percentage}%)
                  </span>
                </div>
                <span className="font-mono font-bold text-slate-900 tabular-nums">
                  {formatCurrencyBRL(item.totalValue)}
                </span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${Math.max(Number(item.percentage), 2)}%`,
                    backgroundColor: item.stage.color,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Grid: Origem dos Leads e Desempenho por Vendedor */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Origem dos Leads */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Performance por Origem do Lead</h3>
            <p className="text-xs text-slate-500 mt-0.5">Canais que mais geram vendas e volume</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] text-slate-400 font-semibold uppercase">
                  <th className="py-2">Origem</th>
                  <th className="py-2 text-center">Total</th>
                  <th className="py-2 text-center">Ganhos</th>
                  <th className="py-2 text-right">Taxa Conv.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sourceStats.map((s) => (
                  <tr key={s.source} className="hover:bg-slate-50">
                    <td className="py-2.5 font-medium text-slate-800">{s.source}</td>
                    <td className="py-2.5 text-center font-mono tabular-nums">{s.count}</td>
                    <td className="py-2.5 text-center font-mono tabular-nums text-emerald-600 font-semibold">
                      {s.wonCount}
                    </td>
                    <td className="py-2.5 text-right font-mono tabular-nums font-semibold">
                      {s.conversionRate}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Desempenho por Vendedor */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Resultado por Vendedor</h3>
            <p className="text-xs text-slate-500 mt-0.5">Fechamento e conversão individual</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-100 text-[10px] text-slate-400 font-semibold uppercase">
                  <th className="py-2">Vendedor</th>
                  <th className="py-2 text-center">Leads</th>
                  <th className="py-2 text-center">Conv.</th>
                  <th className="py-2 text-right">Receita Ganha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ownerStats.map((o, idx) => (
                  <tr key={idx} className="hover:bg-slate-50">
                    <td className="py-2.5 font-medium text-slate-800">{o.name}</td>
                    <td className="py-2.5 text-center font-mono tabular-nums">{o.count}</td>
                    <td className="py-2.5 text-center font-mono tabular-nums text-indigo-600 font-semibold">
                      {o.conversionRate}%
                    </td>
                    <td className="py-2.5 text-right font-mono tabular-nums font-semibold text-emerald-600">
                      {formatCurrencyBRL(o.wonValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
