import React, { useState } from 'react';
import {
  Settings,
  Palette,
  Database,
  Trash2,
  Plus,
  Save,
  CheckCircle2,
  AlertTriangle,
  Info,
  Server,
  Layers,
} from 'lucide-react';
import { PipelineStage } from '../../types/crm.ts';
import {
  createStage,
  updateStage,
  deleteStage,
  seedDemoData,
  clearAllDemoData,
} from '../../services/crmService.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useToast } from '../common/Toast.tsx';

interface SettingsViewProps {
  stages: PipelineStage[];
}

export const SettingsView: React.FC<SettingsViewProps> = ({ stages }) => {
  const { user, profile } = useAuth();
  const { success, error, warning } = useToast();

  const [newStageName, setNewStageName] = useState('');
  const [newStageColor, setNewStageColor] = useState('#6366f1');
  const [isSeeding, setIsSeeding] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [showSeedConfirm, setShowSeedConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Paleta de cores discretas recomendadas para CRM
  const discreteColors = [
    '#3b82f6', // azul
    '#6366f1', // indigo
    '#8b5cf6', // roxo
    '#06b6d4', // ciano
    '#eab308', // amarelo
    '#f97316', // laranja
    '#10b981', // verde esmeralda
    '#ef4444', // vermelho
    '#64748b', // ardósia
  ];

  const handleAddStage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStageName.trim()) return;

    try {
      const nextOrder = stages.length > 0 ? Math.max(...stages.map((s) => s.order)) + 1 : 1;
      await createStage({
        name: newStageName.trim(),
        order: nextOrder,
        color: newStageColor,
      });
      success('Nova etapa adicionada ao funil comercial!');
      setNewStageName('');
    } catch (err: any) {
      error('Erro ao criar etapa', err.message);
    }
  };

  const handleUpdateStageColor = async (stageId: string, color: string) => {
    try {
      await updateStage(stageId, { color });
      success('Cor da etapa atualizada.');
    } catch (err: any) {
      error('Erro ao atualizar cor', err.message);
    }
  };

  const handleDeleteStage = async (stageId: string) => {
    if (stages.length <= 2) {
      warning('O pipeline deve conter pelo menos 2 etapas.');
      return;
    }
    try {
      await deleteStage(stageId);
      success('Etapa removida.');
    } catch (err: any) {
      error('Erro ao remover etapa', err.message);
    }
  };

  const handleConfirmSeed = async () => {
    if (!user || !profile) return;
    try {
      setIsSeeding(true);
      await seedDemoData({ uid: user.uid, name: profile.name });
      success('Dados de demonstração gerados com sucesso!');
      setShowSeedConfirm(false);
    } catch (err: any) {
      error('Erro ao popular dados', err.message);
    } finally {
      setIsSeeding(false);
    }
  };

  const handleConfirmClear = async () => {
    try {
      setIsClearing(true);
      await clearAllDemoData();
      success('Banco de dados limpo com sucesso.');
      setShowClearConfirm(false);
    } catch (err: any) {
      error('Erro ao limpar banco', err.message);
    } finally {
      setIsClearing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Etapas do Funil Kanban */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Etapas do Funil de Vendas</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Personalize os nomes, cores discretas e ordens das colunas do Kanban
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400">{stages.length} etapas ativas</span>
        </div>

        {/* Lista de etapas atuais */}
        <div className="divide-y divide-slate-100">
          {stages.map((stage) => (
            <div key={stage.id} className="py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="w-5 text-center font-mono text-xs font-bold text-slate-400">
                  {stage.order}
                </span>
                <div
                  className="w-3.5 h-3.5 rounded-full shrink-0 shadow-xs"
                  style={{ backgroundColor: stage.color }}
                />
                <span className="text-xs font-bold text-slate-900">{stage.name}</span>
                {stage.isWon && (
                  <span className="px-1.5 py-0.2 text-[9px] font-bold bg-emerald-100 text-emerald-800 rounded">
                    Ganho
                  </span>
                )}
                {stage.isLost && (
                  <span className="px-1.5 py-0.2 text-[9px] font-bold bg-rose-100 text-rose-800 rounded">
                    Perdido
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {/* Seletor rápido de cores discretas */}
                <div className="flex items-center gap-1">
                  {discreteColors.slice(0, 5).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => handleUpdateStageColor(stage.id, c)}
                      className={`w-4 h-4 rounded-full transition-transform ${
                        stage.color === c ? 'ring-2 ring-offset-1 ring-slate-800 scale-110' : 'hover:scale-105'
                      }`}
                      style={{ backgroundColor: c }}
                      title={`Mudar para cor ${c}`}
                    />
                  ))}
                </div>

                <button
                  onClick={() => handleDeleteStage(stage.id)}
                  title="Excluir etapa"
                  className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md transition-colors ml-2"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Formulário para adicionar nova etapa */}
        <form onSubmit={handleAddStage} className="pt-3 border-t border-slate-100 flex items-center gap-2">
          <input
            type="text"
            required
            value={newStageName}
            onChange={(e) => setNewStageName(e.target.value)}
            placeholder="Nome da nova etapa (ex: Em Homologação)..."
            className="flex-1 text-xs px-3 py-2 border border-slate-200 rounded-lg bg-white"
          />

          <select
            value={newStageColor}
            onChange={(e) => setNewStageColor(e.target.value)}
            className="text-xs px-2.5 py-2 border border-slate-200 rounded-lg bg-white"
          >
            {discreteColors.map((color) => (
              <option key={color} value={color}>
                Cor {color}
              </option>
            ))}
          </select>

          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Adicionar Etapa</span>
          </button>
        </form>
      </div>

      {/* Gestão de Dados de Demonstração (Requisito Seção 13) */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
        <div className="pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900">Dados de Demonstração (Ambiente de Testes)</h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Conforme os requisitos do CRM, o banco de produção inicia limpo. Você pode popular ou limpar dados simulados explicitamente.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200">
          <div>
            <h4 className="text-xs font-bold text-slate-800">Popular Base de Testes</h4>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Cria 8 leads distribuídos no funil com tarefas e conversas simuladas para demonstração da equipe.
            </p>
          </div>
          <button
            onClick={() => setShowSeedConfirm(true)}
            className="px-3.5 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors shrink-0"
          >
            Gerar Dados de Demonstração
          </button>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-4 bg-rose-50/60 rounded-xl border border-rose-200">
          <div>
            <h4 className="text-xs font-bold text-rose-900">Limpar Registros</h4>
            <p className="text-[11px] text-rose-700 mt-0.5">
              Remove todos os leads, tarefas, conversas e mensagens para retornar ao estado limpo.
            </p>
          </div>
          <button
            onClick={() => setShowClearConfirm(true)}
            className="px-3.5 py-2 text-xs font-semibold text-rose-700 bg-white border border-rose-200 rounded-lg hover:bg-rose-50 transition-colors shrink-0"
          >
            Limpar Todo o Banco
          </button>
        </div>
      </div>

      {/* Modal Confirmação Seed */}
      {showSeedConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 space-y-3">
            <h4 className="text-sm font-bold text-slate-900">Gerar Dados de Teste?</h4>
            <p className="text-xs text-slate-600">
              Serão adicionados 8 leads de exemplo com diferentes estágios comerciais, tarefas e histórico de contato.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowSeedConfirm(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmSeed}
                disabled={isSeeding}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
              >
                {isSeeding ? 'Gerando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Confirmação Clear */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 space-y-3">
            <h4 className="text-sm font-bold text-rose-900">Limpar Todos os Dados?</h4>
            <p className="text-xs text-slate-600">
              Esta ação excluirá permanentemente todos os leads, tarefas, conversas e mensagens registradas.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirmClear}
                disabled={isClearing}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg disabled:opacity-50"
              >
                {isClearing ? 'Limpando...' : 'Sim, Limpar Tudo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
