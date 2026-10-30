import React, { useState, useMemo, useRef } from 'react';
import {
  Search,
  Filter,
  Plus,
  Download,
  Upload,
  MessageSquare,
  AlertCircle,
  MoreVertical,
  ChevronRight,
  User,
  Phone,
  Building,
  Tag,
  FileSpreadsheet,
} from 'lucide-react';
import { Lead, PipelineStage, LEAD_SOURCES } from '../../types/crm.ts';
import {
  formatCurrencyBRL,
  formatPhoneDisplay,
  formatDateTimeSP,
  formatRelativeTime,
  exportLeadsToCSV,
  parseLeadsCSV,
} from '../../utils/formatters.ts';
import { createLead } from '../../services/crmService.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useToast } from '../common/Toast.tsx';

interface LeadsViewProps {
  leads: Lead[];
  stages: PipelineStage[];
  onOpenLead: (lead: Lead) => void;
  onOpenNewLeadModal: () => void;
  onOpenWhatsApp: (lead: Lead) => void;
}

export const LeadsView: React.FC<LeadsViewProps> = ({
  leads,
  stages,
  onOpenLead,
  onOpenNewLeadModal,
  onOpenWhatsApp,
}) => {
  const { user, profile } = useAuth();
  const { success, error, warning } = useToast();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [tagFilter, setTagFilter] = useState<string>('all');

  // Modal de importação CSV
  const [csvImportModal, setCsvImportModal] = useState<{
    isOpen: boolean;
    leadsToImport: any[];
    errors: string[];
    isImporting: boolean;
  }>({ isOpen: false, leadsToImport: [], errors: [], isImporting: false });

  // Detecção de números de telefone duplicados
  const duplicatePhoneSet = useMemo(() => {
    const counts = new Map<string, number>();
    leads.forEach((l) => {
      counts.set(l.phone, (counts.get(l.phone) || 0) + 1);
    });
    const dupes = new Set<string>();
    for (const [phone, count] of counts.entries()) {
      if (count > 1) dupes.add(phone);
    }
    return dupes;
  }, [leads]);

  // Lista de tags únicas
  const allUniqueTags = useMemo(() => {
    const tagSet = new Set<string>();
    leads.forEach((l) => (l.tags || []).forEach((t) => tagSet.add(t)));
    return Array.from(tagSet);
  }, [leads]);

  // Lista de responsáveis únicos
  const allUniqueOwners = useMemo(() => {
    const ownerMap = new Map<string, string>();
    leads.forEach((l) => {
      if (l.ownerId && l.ownerName) ownerMap.set(l.ownerId, l.ownerName);
    });
    return Array.from(ownerMap.entries()).map(([id, name]) => ({ id, name }));
  }, [leads]);

  // Filtragem composta
  const filteredLeads = useMemo(() => {
    return leads.filter((lead) => {
      // Busca por nome, telefone ou empresa
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchesName = lead.name.toLowerCase().includes(query);
        const matchesPhone = lead.phone.includes(query);
        const matchesCompany = (lead.company || '').toLowerCase().includes(query);
        if (!matchesName && !matchesPhone && !matchesCompany) return false;
      }

      // Filtro de etapa
      if (stageFilter !== 'all' && lead.stageId !== stageFilter) {
        return false;
      }

      // Filtro de origem
      if (sourceFilter !== 'all' && lead.source !== sourceFilter) {
        return false;
      }

      // Filtro de responsável
      if (ownerFilter !== 'all' && lead.ownerId !== ownerFilter) {
        return false;
      }

      // Filtro de tags
      if (tagFilter !== 'all' && !(lead.tags || []).includes(tagFilter)) {
        return false;
      }

      return true;
    });
  }, [leads, searchTerm, stageFilter, sourceFilter, ownerFilter, tagFilter]);

  const handleExportCSV = () => {
    const stageMap = new Map(stages.map((s) => [s.id, s.name]));
    const leadsWithStageName = filteredLeads.map((l) => ({
      ...l,
      stageName: stageMap.get(l.stageId) || l.stageId,
    }));
    exportLeadsToCSV(leadsWithStageName);
    success('Arquivo CSV exportado com sucesso!');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const { leads: parsed, errors: parseErrors } = parseLeadsCSV(text);
      setCsvImportModal({
        isOpen: true,
        leadsToImport: parsed,
        errors: parseErrors,
        isImporting: false,
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsText(file);
  };

  const handleConfirmImport = async () => {
    if (!user || !profile || csvImportModal.leadsToImport.length === 0) return;
    setCsvImportModal((prev) => ({ ...prev, isImporting: true }));

    const defaultStageId = stages[0]?.id || '';
    let importedCount = 0;

    for (const item of csvImportModal.leadsToImport) {
      try {
        await createLead(
          {
            name: item.name,
            phone: item.phone,
            email: item.email,
            company: item.company,
            source: item.source || 'Importação CSV',
            stageId: defaultStageId,
            ownerId: user.uid,
            ownerName: profile.name,
            value: item.value || 0,
            tags: item.tags || ['Importado'],
            consentMessaging: true,
            consentSource: 'Importação CSV',
            consentDate: new Date().toISOString(),
          },
          { uid: user.uid, name: profile.name }
        );
        importedCount++;
      } catch (err) {
        console.error('Erro ao importar lead individual:', err);
      }
    }

    setCsvImportModal({ isOpen: false, leadsToImport: [], errors: [], isImporting: false });
    success(`${importedCount} leads importados com sucesso!`);
  };

  const stageColorMap = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    stages.forEach((s) => map.set(s.id, { name: s.name, color: s.color }));
    return map;
  }, [stages]);

  return (
    <div className="space-y-4">
      {/* Barra de Ações e Filtros */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Busca rápida */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nome, telefone ou empresa..."
              className="w-full text-xs pl-9 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 bg-white"
            />
          </div>

          {/* Botões Importar / Exportar / Novo Lead */}
          <div className="flex items-center gap-2 shrink-0">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".csv"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Importar contatos de arquivo CSV"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <Upload className="w-3.5 h-3.5 text-slate-500" />
              <span>Importar CSV</span>
            </button>

            <button
              onClick={handleExportCSV}
              disabled={filteredLeads.length === 0}
              title="Exportar dados filtrados para CSV"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Exportar</span>
            </button>

            <button
              onClick={onOpenNewLeadModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Novo Lead</span>
            </button>
          </div>
        </div>

        {/* Filtros em linha */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
          <span className="text-slate-400 flex items-center gap-1 font-medium">
            <Filter className="w-3.5 h-3.5" />
            <span>Filtros:</span>
          </span>

          {/* Filtro Etapa */}
          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="text-xs px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-md text-slate-700 font-medium"
          >
            <option value="all">Todas as Etapas</option>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {/* Filtro Origem */}
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="text-xs px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-md text-slate-700 font-medium"
          >
            <option value="all">Todas as Origens</option>
            {LEAD_SOURCES.map((src) => (
              <option key={src} value={src}>
                {src}
              </option>
            ))}
          </select>

          {/* Filtro Responsável */}
          <select
            value={ownerFilter}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="text-xs px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-md text-slate-700 font-medium"
          >
            <option value="all">Todos os Responsáveis</option>
            {allUniqueOwners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>

          {/* Filtro Tags */}
          {allUniqueTags.length > 0 && (
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              className="text-xs px-2.5 py-1 bg-slate-50 border border-slate-200 rounded-md text-slate-700 font-medium"
            >
              <option value="all">Todas as Tags</option>
              {allUniqueTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          )}

          {(searchTerm || stageFilter !== 'all' || sourceFilter !== 'all' || ownerFilter !== 'all' || tagFilter !== 'all') && (
            <button
              onClick={() => {
                setSearchTerm('');
                setStageFilter('all');
                setSourceFilter('all');
                setOwnerFilter('all');
                setTagFilter('all');
              }}
              className="text-xs text-indigo-600 hover:text-indigo-800 underline font-medium ml-auto"
            >
              Limpar Filtros
            </button>
          )}
        </div>
      </div>

      {/* Alerta global se houver telefones duplicados */}
      {duplicatePhoneSet.size > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              Existem <strong>{duplicatePhoneSet.size}</strong> números de telefone duplicados cadastrados na base.
            </span>
          </div>
          <span className="text-[11px] text-amber-700 font-semibold">Identificados com ícone de alerta</span>
        </div>
      )}

      {/* Tabela de Leads */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                <th className="py-3 px-4">Lead / Contato</th>
                <th className="py-3 px-4">Telefone</th>
                <th className="py-3 px-4">Etapa Comercial</th>
                <th className="py-3 px-4">Origem</th>
                <th className="py-3 px-4 text-right">Valor Estimado</th>
                <th className="py-3 px-4">Responsável</th>
                <th className="py-3 px-4">Último Contato</th>
                <th className="py-3 px-4 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <p className="text-sm font-medium">Nenhum lead encontrado</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Altere os filtros de pesquisa ou cadastre um novo lead.
                    </p>
                    <button
                      onClick={onOpenNewLeadModal}
                      className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Cadastrar Primeiro Lead</span>
                    </button>
                  </td>
                </tr>
              ) : (
                filteredLeads.map((lead) => {
                  const stageInfo = stageColorMap.get(lead.stageId);
                  const isDupe = duplicatePhoneSet.has(lead.phone);

                  return (
                    <tr
                      key={lead.id}
                      className="hover:bg-slate-50/70 transition-colors group cursor-pointer"
                      onClick={() => onOpenLead(lead)}
                    >
                      {/* Nome e Empresa */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 leading-tight">
                          {lead.name}
                        </div>
                        <div className="text-[11px] text-slate-500 leading-tight mt-0.5">
                          {lead.company || lead.email || 'Pessoa Física'}
                        </div>
                      </td>

                      {/* Telefone e Alerta Duplicado */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 font-mono tabular-nums text-slate-800">
                          <span>{formatPhoneDisplay(lead.phone)}</span>
                          {isDupe && (
                            <span
                              title="Telefone duplicado na base"
                              className="text-amber-600"
                            >
                              <AlertCircle className="w-3.5 h-3.5" />
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Etapa */}
                      <td className="py-3 px-4">
                        {stageInfo ? (
                          <span
                            className="inline-block px-2 py-0.5 text-[10px] font-semibold rounded text-white"
                            style={{ backgroundColor: stageInfo.color }}
                          >
                            {stageInfo.name}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Origem */}
                      <td className="py-3 px-4 text-slate-600 font-medium">
                        {lead.source}
                      </td>

                      {/* Valor Estimado */}
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {formatCurrencyBRL(lead.value)}
                      </td>

                      {/* Responsável */}
                      <td className="py-3 px-4 text-slate-600">
                        {lead.ownerName}
                      </td>

                      {/* Último Contato */}
                      <td className="py-3 px-4 text-slate-500 font-mono tabular-nums text-[11px]">
                        {formatRelativeTime(lead.lastContactAt || lead.createdAt)}
                      </td>

                      {/* Ações */}
                      <td
                        className="py-3 px-4 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => onOpenWhatsApp(lead)}
                            title="Conversar pelo WhatsApp"
                            className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-md transition-colors"
                          >
                            <MessageSquare className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => onOpenLead(lead)}
                            title="Ver ficha completa"
                            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer com contagem */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-500 flex justify-between items-center font-mono">
          <span>Mostrando {filteredLeads.length} de {leads.length} leads</span>
          <span className="tabular-nums">
            Total em Oportunidades: {formatCurrencyBRL(filteredLeads.reduce((acc, l) => acc + (l.value || 0), 0))}
          </span>
        </div>
      </div>

      {/* Modal de Importação CSV */}
      {csvImportModal.isOpen && (
        <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
                <h3 className="text-base font-bold text-slate-900">Importação de Leads via CSV</h3>
              </div>
              <button
                onClick={() => setCsvImportModal({ isOpen: false, leadsToImport: [], errors: [], isImporting: false })}
                className="text-slate-400 hover:text-slate-600"
              >
                &times;
              </button>
            </div>

            {csvImportModal.errors.length > 0 && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 space-y-1 max-h-32 overflow-y-auto">
                <p className="font-semibold">Problemas detectados no arquivo:</p>
                {csvImportModal.errors.map((err, idx) => (
                  <p key={idx}>&bull; {err}</p>
                ))}
              </div>
            )}

            <div className="text-xs text-slate-600 space-y-2">
              <p>
                Identificados <strong>{csvImportModal.leadsToImport.length}</strong> contatos válidos para importação imediata.
              </p>
              <p className="text-slate-500">
                Os contatos serão cadastrados na etapa inicial "{stages[0]?.name}" atribuídos ao seu usuário.
              </p>
            </div>

            {csvImportModal.leadsToImport.length > 0 && (
              <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2 text-xs divide-y divide-slate-100">
                {csvImportModal.leadsToImport.slice(0, 5).map((l, i) => (
                  <div key={i} className="py-1 flex justify-between">
                    <span className="font-semibold text-slate-800">{l.name}</span>
                    <span className="font-mono text-slate-500">{l.phone}</span>
                  </div>
                ))}
                {csvImportModal.leadsToImport.length > 5 && (
                  <div className="py-1 text-center text-slate-400 font-mono">
                    ... e mais {csvImportModal.leadsToImport.length - 5} contatos
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setCsvImportModal({ isOpen: false, leadsToImport: [], errors: [], isImporting: false })}
                className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmImport}
                disabled={csvImportModal.isImporting || csvImportModal.leadsToImport.length === 0}
                className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
              >
                {csvImportModal.isImporting ? 'Importando...' : 'Confirmar Importação'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
