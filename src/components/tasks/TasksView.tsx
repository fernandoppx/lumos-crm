import React, { useState, useMemo } from 'react';
import {
  CheckSquare,
  Clock,
  AlertTriangle,
  Plus,
  Trash2,
  Calendar,
  User,
  Filter,
  CheckCircle2,
  ExternalLink,
} from 'lucide-react';
import { Task, Lead } from '../../types/crm.ts';
import {
  formatDateTimeSP,
  formatDateSP,
  formatTimeSP,
} from '../../utils/formatters.ts';
import {
  createTask,
  toggleTaskCompleted,
  deleteTask,
} from '../../services/crmService.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useToast } from '../common/Toast.tsx';

interface TasksViewProps {
  tasks: Task[];
  leads: Lead[];
  onOpenLead: (lead: Lead) => void;
}

export const TasksView: React.FC<TasksViewProps> = ({
  tasks,
  leads,
  onOpenLead,
}) => {
  const { user, profile } = useAuth();
  const { success, error } = useToast();

  const [filterType, setFilterType] = useState<'pending' | 'overdue' | 'completed' | 'all'>('pending');
  const [filterLeadId, setFilterLeadId] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form states
  const [title, setTitle] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState(leads[0]?.id || '');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const nowMs = Date.now();

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      const isOverdue = !t.completed && new Date(t.dueDate).getTime() < nowMs;

      if (filterType === 'pending' && t.completed) return false;
      if (filterType === 'completed' && !t.completed) return false;
      if (filterType === 'overdue' && !isOverdue) return false;

      if (filterLeadId !== 'all' && t.leadId !== filterLeadId) return false;

      return true;
    });
  }, [tasks, filterType, filterLeadId, nowMs]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;
    if (!title.trim() || !dueDate || !selectedLeadId) {
      error('Preencha os campos obrigatórios.');
      return;
    }

    const targetLead = leads.find((l) => l.id === selectedLeadId);
    if (!targetLead) {
      error('Lead selecionado não encontrado.');
      return;
    }

    try {
      setIsSubmitting(true);
      await createTask(
        {
          leadId: targetLead.id,
          leadName: targetLead.name,
          title: title.trim(),
          description: description.trim() || undefined,
          dueDate: new Date(dueDate).toISOString(),
          assignedTo: user.uid,
          assignedToName: profile.name,
        },
        { uid: user.uid, name: profile.name }
      );
      success('Tarefa e follow-up agendados com sucesso!');
      setTitle('');
      setDueDate('');
      setDescription('');
      setIsModalOpen(false);
    } catch (err: any) {
      error('Erro ao agendar tarefa', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggle = async (task: Task, completed: boolean) => {
    if (!user || !profile) return;
    try {
      await toggleTaskCompleted(task, completed, { uid: user.uid, name: profile.name });
      success(completed ? 'Tarefa marcada como concluída!' : 'Tarefa reaberta.');
    } catch (err: any) {
      error('Erro ao atualizar tarefa', err.message);
    }
  };

  const handleDelete = async (taskId: string) => {
    try {
      await deleteTask(taskId);
      success('Tarefa excluída.');
    } catch (err: any) {
      error('Erro ao excluir tarefa', err.message);
    }
  };

  return (
    <div className="space-y-4">
      {/* Barra de Filtros e Ação */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg text-xs font-medium">
            <button
              onClick={() => setFilterType('pending')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                filterType === 'pending'
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Pendentes ({tasks.filter((t) => !t.completed).length})
            </button>
            <button
              onClick={() => setFilterType('overdue')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                filterType === 'overdue'
                  ? 'bg-white text-rose-700 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-rose-700'
              }`}
            >
              Atrasadas ({tasks.filter((t) => !t.completed && new Date(t.dueDate).getTime() < nowMs).length})
            </button>
            <button
              onClick={() => setFilterType('completed')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                filterType === 'completed'
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Concluídas ({tasks.filter((t) => t.completed).length})
            </button>
            <button
              onClick={() => setFilterType('all')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                filterType === 'all'
                  ? 'bg-white text-slate-900 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Todas ({tasks.length})
            </button>
          </div>

          {leads.length > 0 && (
            <select
              value={filterLeadId}
              onChange={(e) => setFilterLeadId(e.target.value)}
              className="text-xs px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
            >
              <option value="all">Todos os Leads</option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <button
          onClick={() => setIsModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-xs shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Agendar Nova Tarefa</span>
        </button>
      </div>

      {/* Lista de Tarefas */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs divide-y divide-slate-100">
        {filteredTasks.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            <CheckCircle2 className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="font-semibold text-slate-700">Nenhuma tarefa encontrada neste filtro</p>
            <p className="text-slate-500 mt-1">
              Agende prazos de contato comercial para não perder oportunidades no funil.
            </p>
          </div>
        ) : (
          filteredTasks.map((task) => {
            const isOverdue = !task.completed && new Date(task.dueDate).getTime() < nowMs;
            const targetLead = leads.find((l) => l.id === task.leadId);

            return (
              <div
                key={task.id}
                className={`p-4 flex items-start justify-between gap-4 transition-colors ${
                  task.completed ? 'bg-slate-50/60 opacity-60' : isOverdue ? 'bg-rose-50/20' : 'hover:bg-slate-50/50'
                }`}
              >
                <div className="flex items-start gap-3 min-w-0">
                  <input
                    type="checkbox"
                    checked={task.completed}
                    onChange={(e) => handleToggle(task, e.target.checked)}
                    className="mt-1 rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h4
                        className={`text-xs font-bold ${
                          task.completed ? 'line-through text-slate-500' : 'text-slate-900'
                        }`}
                      >
                        {task.title}
                      </h4>
                      {isOverdue && (
                        <span className="px-1.5 py-0.2 text-[10px] font-semibold bg-rose-100 text-rose-700 rounded border border-rose-200 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Atrasada</span>
                        </span>
                      )}
                    </div>

                    {task.description && (
                      <p className="text-xs text-slate-600 mt-1">{task.description}</p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 mt-2">
                      <button
                        onClick={() => targetLead && onOpenLead(targetLead)}
                        className="font-medium text-indigo-600 hover:underline flex items-center gap-1"
                      >
                        <span>Lead: {task.leadName}</span>
                        <ExternalLink className="w-3 h-3" />
                      </button>

                      <span aria-hidden="true">&middot;</span>

                      <span className="flex items-center gap-1 font-mono tabular-nums text-slate-700 font-medium">
                        <Clock className="w-3 h-3 text-slate-400" />
                        <span>Prazo: {formatDateTimeSP(task.dueDate)}</span>
                      </span>

                      <span aria-hidden="true">&middot;</span>

                      <span>Responsável: {task.assignedToName}</span>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => handleDelete(task.id)}
                  title="Excluir tarefa"
                  className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Modal de Criação de Tarefa */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <h3 className="text-base font-bold text-slate-900 pb-3 border-b border-slate-100">
              Agendar Nova Tarefa Comercial
            </h3>

            <form onSubmit={handleCreateTask} className="py-4 space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Lead Vinculado *
                </label>
                <select
                  required
                  value={selectedLeadId}
                  onChange={(e) => setSelectedLeadId(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg bg-white"
                >
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} {l.company ? `(${l.company})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Título da Tarefa / Ação *
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex: Ligar para validar proposta enviada"
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Data e Horário Limite *
                </label>
                <input
                  type="datetime-local"
                  required
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg bg-white font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Descrição / Orientações (opcional)
                </label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Detalhes relevantes para o contato..."
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg bg-white"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
                >
                  {isSubmitting ? 'Agendando...' : 'Confirmar Agendamento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
