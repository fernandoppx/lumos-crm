import React, { useState, useEffect } from 'react';
import {
  X,
  Phone,
  Mail,
  Building,
  User,
  DollarSign,
  Tag,
  CheckCircle,
  Clock,
  MessageSquare,
  Trash2,
  Save,
  Calendar,
  AlertTriangle,
  History,
  CheckSquare,
  Plus,
} from 'lucide-react';
import { Lead, PipelineStage, Activity, Task } from '../../types/crm.ts';
import {
  formatCurrencyBRL,
  formatPhoneDisplay,
  formatDateTimeSP,
  formatDateSP,
  formatRelativeTime,
  normalizePhone,
} from '../../utils/formatters.ts';
import {
  updateLead,
  deleteLead,
  checkLeadHasHistory,
  subscribeLeadActivities,
  addLeadNote,
  createTask,
  toggleTaskCompleted,
  deleteTask,
} from '../../services/crmService.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useToast } from '../common/Toast.tsx';

interface LeadDrawerProps {
  lead: Lead | null;
  stages: PipelineStage[];
  tasks: Task[];
  onClose: () => void;
  onOpenWhatsApp: (lead: Lead) => void;
}

export const LeadDrawer: React.FC<LeadDrawerProps> = ({
  lead,
  stages,
  tasks,
  onClose,
  onOpenWhatsApp,
}) => {
  const { user, profile } = useAuth();
  const { success, error, warning } = useToast();

  const [activeTab, setActiveTab] = useState<'details' | 'activities' | 'tasks'>('details');
  const [activities, setActivities] = useState<Activity[]>([]);
  const [isEditing, setIsEditing] = useState(false);
  const [confirmDeleteModal, setConfirmDeleteModal] = useState<{
    isOpen: boolean;
    hasHistory: boolean;
    conversationsCount: number;
    tasksCount: number;
  }>({ isOpen: false, hasHistory: false, conversationsCount: 0, tasksCount: 0 });

  // Form states for editing
  const [formData, setFormData] = useState<Partial<Lead>>({});
  const [newTagInput, setNewTagInput] = useState('');
  const [newNoteInput, setNewNoteInput] = useState('');

  // Form state for creating a quick task
  const [showNewTaskForm, setShowNewTaskForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDueDate, setTaskDueDate] = useState('');
  const [taskDesc, setTaskDesc] = useState('');

  useEffect(() => {
    if (lead) {
      setFormData({
        name: lead.name,
        phone: lead.phone,
        email: lead.email || '',
        company: lead.company || '',
        source: lead.source,
        stageId: lead.stageId,
        value: lead.value || 0,
        notes: lead.notes || '',
        tags: [...(lead.tags || [])],
        consentMessaging: lead.consentMessaging,
        consentSource: lead.consentSource || '',
      });
      setIsEditing(false);

      // Assina atividades do lead em tempo real
      const unsubscribe = subscribeLeadActivities(lead.id, (acts) => {
        setActivities(acts);
      });
      return () => {
        if (unsubscribe) unsubscribe();
      };
    }
  }, [lead]);

  if (!lead) return null;

  const leadTasks = tasks.filter((t) => t.leadId === lead.id);
  const currentStage = stages.find((s) => s.id === (formData.stageId || lead.stageId));

  const handleSaveLead = async () => {
    if (!user || !profile) return;
    if (!formData.name?.trim()) {
      error('O nome do lead é obrigatório.');
      return;
    }
    if (!formData.phone?.trim()) {
      error('O telefone é obrigatório.');
      return;
    }

    try {
      await updateLead(
        lead.id,
        {
          name: formData.name.trim(),
          phone: normalizePhone(formData.phone),
          email: formData.email?.trim() || undefined,
          company: formData.company?.trim() || undefined,
          source: formData.source || lead.source,
          stageId: formData.stageId || lead.stageId,
          value: Number(formData.value) || 0,
          notes: formData.notes?.trim() || undefined,
          tags: formData.tags || [],
          consentMessaging: Boolean(formData.consentMessaging),
          consentSource: formData.consentSource?.trim() || undefined,
        },
        { uid: user.uid, name: profile.name }
      );
      success('Lead atualizado com sucesso!');
      setIsEditing(false);
    } catch (err: any) {
      error('Erro ao atualizar lead', err.message);
    }
  };

  const handleAddTag = () => {
    if (!newTagInput.trim()) return;
    const cleanTag = newTagInput.trim();
    const currentTags = formData.tags || [];
    if (!currentTags.includes(cleanTag)) {
      setFormData((prev) => ({ ...prev, tags: [...currentTags, cleanTag] }));
    }
    setNewTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setFormData((prev) => ({
      ...prev,
      tags: (prev.tags || []).filter((t) => t !== tagToRemove),
    }));
  };

  const handleAddNote = async () => {
    if (!newNoteInput.trim() || !user || !profile) return;
    try {
      await addLeadNote(lead.id, newNoteInput.trim(), { uid: user.uid, name: profile.name });
      success('Anotação registrada com sucesso!');
      setNewNoteInput('');
    } catch (err: any) {
      error('Erro ao salvar anotação', err.message);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim() || !taskDueDate || !user || !profile) {
      error('Preencha o título e a data da tarefa.');
      return;
    }
    try {
      await createTask(
        {
          leadId: lead.id,
          leadName: lead.name,
          title: taskTitle.trim(),
          description: taskDesc.trim() || undefined,
          dueDate: new Date(taskDueDate).toISOString(),
          assignedTo: user.uid,
          assignedToName: profile.name,
        },
        { uid: user.uid, name: profile.name }
      );
      success('Tarefa agendada!');
      setTaskTitle('');
      setTaskDueDate('');
      setTaskDesc('');
      setShowNewTaskForm(false);
    } catch (err: any) {
      error('Erro ao agendar tarefa', err.message);
    }
  };

  const handleDeleteClick = async () => {
    const historyCheck = await checkLeadHasHistory(lead.id);
    setConfirmDeleteModal({
      isOpen: true,
      hasHistory: historyCheck.hasConversations || historyCheck.hasTasks,
      conversationsCount: historyCheck.conversationsCount,
      tasksCount: historyCheck.tasksCount,
    });
  };

  const handleConfirmDelete = async () => {
    try {
      await deleteLead(lead.id);
      success('Lead excluído.');
      setConfirmDeleteModal({ isOpen: false, hasHistory: false, conversationsCount: 0, tasksCount: 0 });
      onClose();
    } catch (err: any) {
      error('Erro ao excluir lead', err.message);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 transition-opacity"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xl bg-white shadow-2xl flex flex-col border-l border-slate-200">
        {/* Drawer Header */}
        <div className="p-5 border-b border-slate-200 flex items-start justify-between gap-4 bg-slate-50/50">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 truncate">{lead.name}</h2>
              {currentStage && (
                <span
                  className="px-2 py-0.5 text-[10px] font-semibold rounded text-white shrink-0"
                  style={{ backgroundColor: currentStage.color }}
                >
                  {currentStage.name}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
              <span>{lead.company || 'Sem empresa'}</span>
              <span aria-hidden="true">&middot;</span>
              <span className="font-mono tabular-nums">{formatPhoneDisplay(lead.phone)}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => onOpenWhatsApp(lead)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              <span>WhatsApp</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 px-5 border-b border-slate-200 bg-white text-xs font-medium">
          <button
            onClick={() => setActiveTab('details')}
            className={`py-3 px-3 border-b-2 font-semibold transition-colors ${
              activeTab === 'details'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            Ficha Completa
          </button>
          <button
            onClick={() => setActiveTab('activities')}
            className={`py-3 px-3 border-b-2 font-semibold transition-colors flex items-center gap-1.5 ${
              activeTab === 'activities'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Histórico ({activities.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('tasks')}
            className={`py-3 px-3 border-b-2 font-semibold transition-colors flex items-center gap-1.5 ${
              activeTab === 'tasks'
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <CheckSquare className="w-3.5 h-3.5" />
            <span>Tarefas ({leadTasks.length})</span>
          </button>
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {activeTab === 'details' && (
            <div className="space-y-4">
              {/* Seção Dados Comerciais */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Nome Completo *
                  </label>
                  <input
                    type="text"
                    value={formData.name || ''}
                    onChange={(e) => {
                      setFormData({ ...formData, name: e.target.value });
                      setIsEditing(true);
                    }}
                    className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Telefone (WhatsApp) *
                  </label>
                  <input
                    type="text"
                    value={formData.phone || ''}
                    onChange={(e) => {
                      setFormData({ ...formData, phone: e.target.value });
                      setIsEditing(true);
                    }}
                    placeholder="+55 11 99999-9999"
                    className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 bg-white font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    E-mail
                  </label>
                  <input
                    type="email"
                    value={formData.email || ''}
                    onChange={(e) => {
                      setFormData({ ...formData, email: e.target.value });
                      setIsEditing(true);
                    }}
                    placeholder="contato@empresa.com"
                    className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Empresa / Organização
                  </label>
                  <input
                    type="text"
                    value={formData.company || ''}
                    onChange={(e) => {
                      setFormData({ ...formData, company: e.target.value });
                      setIsEditing(true);
                    }}
                    placeholder="Nome da empresa"
                    className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Etapa no Funil
                  </label>
                  <select
                    value={formData.stageId || lead.stageId}
                    onChange={(e) => {
                      setFormData({ ...formData, stageId: e.target.value });
                      setIsEditing(true);
                    }}
                    className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 bg-white"
                  >
                    {stages.map((stg) => (
                      <option key={stg.id} value={stg.id}>
                        {stg.order}. {stg.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Valor Oportunidade (R$)
                  </label>
                  <input
                    type="number"
                    value={formData.value || 0}
                    onChange={(e) => {
                      setFormData({ ...formData, value: Number(e.target.value) });
                      setIsEditing(true);
                    }}
                    className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 bg-white font-mono"
                  />
                </div>
              </div>

              {/* Tags / Etiquetas */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Etiquetas (Tags)
                </label>
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  {(formData.tags || []).map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-slate-100 text-slate-700 rounded-md border border-slate-200"
                    >
                      <span>{tag}</span>
                      <button
                        type="button"
                        onClick={() => {
                          handleRemoveTag(tag);
                          setIsEditing(true);
                        }}
                        className="hover:text-rose-600"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddTag();
                        setIsEditing(true);
                      }
                    }}
                    placeholder="Adicionar tag e pressionar Enter"
                    className="flex-1 text-xs px-3 py-1.5 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      handleAddTag();
                      setIsEditing(true);
                    }}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                  >
                    Adicionar
                  </button>
                </div>
              </div>

              {/* Consentimento para Mensagens */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="consentCheck"
                    checked={formData.consentMessaging || false}
                    onChange={(e) => {
                      setFormData({ ...formData, consentMessaging: e.target.checked });
                      setIsEditing(true);
                    }}
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor="consentCheck" className="text-xs font-semibold text-slate-800 cursor-pointer">
                    Consentimento para receber mensagens via WhatsApp (LGPD)
                  </label>
                </div>
                {formData.consentMessaging && (
                  <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                    <div>
                      <span className="text-[11px] text-slate-500 block">Origem do Consentimento:</span>
                      <input
                        type="text"
                        value={formData.consentSource || ''}
                        onChange={(e) => {
                          setFormData({ ...formData, consentSource: e.target.value });
                          setIsEditing(true);
                        }}
                        placeholder="Ex: Landing Page, WhatsApp"
                        className="w-full text-xs px-2 py-1 bg-white border border-slate-200 rounded mt-0.5"
                      />
                    </div>
                    <div>
                      <span className="text-[11px] text-slate-500 block">Data do Consentimento:</span>
                      <span className="text-xs font-mono text-slate-700 block mt-1">
                        {lead.consentDate ? formatDateSP(lead.consentDate) : 'Hoje'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Observações Gerais */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Observações Gerais
                </label>
                <textarea
                  rows={3}
                  value={formData.notes || ''}
                  onChange={(e) => {
                    setFormData({ ...formData, notes: e.target.value });
                    setIsEditing(true);
                  }}
                  placeholder="Informações adicionais sobre o perfil do cliente, preferências ou acordos..."
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 bg-white"
                />
              </div>

              {/* Metadados do Registro */}
              <div className="p-3 bg-slate-50 rounded-lg text-[11px] text-slate-500 space-y-1">
                <div className="flex justify-between">
                  <span>Responsável:</span>
                  <span className="font-medium text-slate-800">{lead.ownerName}</span>
                </div>
                <div className="flex justify-between">
                  <span>Data de Cadastro:</span>
                  <span className="font-mono">{formatDateTimeSP(lead.createdAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Último Contato:</span>
                  <span className="font-mono">{lead.lastContactAt ? formatDateTimeSP(lead.lastContactAt) : 'Nenhum'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Próximo Follow-up:</span>
                  <span className="font-mono">{lead.nextFollowUpAt ? formatDateTimeSP(lead.nextFollowUpAt) : 'Não agendado'}</span>
                </div>
              </div>

              {/* Ações Salvar / Excluir */}
              <div className="pt-3 border-t border-slate-200 flex items-center justify-between">
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Excluir Lead</span>
                </button>

                <button
                  type="button"
                  onClick={handleSaveLead}
                  disabled={!isEditing}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Salvar Alterações</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'activities' && (
            <div className="space-y-4">
              {/* Adicionar nova anotação rápida */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <label className="block text-xs font-semibold text-slate-800 mb-1.5">
                  Registrar Nova Anotação / Histórico de Contato
                </label>
                <textarea
                  rows={2}
                  value={newNoteInput}
                  onChange={(e) => setNewNoteInput(e.target.value)}
                  placeholder="Ex: Realizada ligação de alinhamento com o decisor financeiro..."
                  className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 bg-white"
                />
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={handleAddNote}
                    disabled={!newNoteInput.trim()}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                  >
                    Salvar no Histórico
                  </button>
                </div>
              </div>

              {/* Linha do tempo de atividades */}
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-semibold text-slate-700">Linha do Tempo e Auditoria</h4>
                {activities.length === 0 ? (
                  <p className="text-xs text-slate-400 py-6 text-center">
                    Nenhuma atividade registrada ainda para este lead.
                  </p>
                ) : (
                  activities.map((act) => (
                    <div
                      key={act.id}
                      className="p-3 bg-white border border-slate-200 rounded-lg text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span className="font-semibold text-slate-800">{act.userName}</span>
                        <span className="font-mono tabular-nums">{formatDateTimeSP(act.timestamp)}</span>
                      </div>
                      <p className="text-slate-800 font-normal">{act.description}</p>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-slate-800">Tarefas Vinculadas</h4>
                <button
                  type="button"
                  onClick={() => setShowNewTaskForm(!showNewTaskForm)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Agendar Tarefa</span>
                </button>
              </div>

              {showNewTaskForm && (
                <form
                  onSubmit={handleCreateTask}
                  className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3"
                >
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Título da Tarefa *
                    </label>
                    <input
                      type="text"
                      required
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                      placeholder="Ex: Enviar proposta comercial revisada"
                      className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Data e Horário Limite *
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={taskDueDate}
                      onChange={(e) => setTaskDueDate(e.target.value)}
                      className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-lg bg-white font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1">
                      Detalhes (opcional)
                    </label>
                    <input
                      type="text"
                      value={taskDesc}
                      onChange={(e) => setTaskDesc(e.target.value)}
                      placeholder="Observações ou instruções"
                      className="w-full text-xs px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowNewTaskForm(false)}
                      className="px-3 py-1 text-xs text-slate-600 hover:text-slate-800"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1 text-xs font-semibold text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
                    >
                      Confirmar
                    </button>
                  </div>
                </form>
              )}

              <div className="space-y-2">
                {leadTasks.length === 0 ? (
                  <p className="text-xs text-slate-400 py-6 text-center">
                    Nenhuma tarefa pendente para este lead.
                  </p>
                ) : (
                  leadTasks.map((t) => (
                    <div
                      key={t.id}
                      className={`p-3 rounded-lg border flex items-start justify-between gap-3 ${
                        t.completed
                          ? 'bg-slate-50 border-slate-200 opacity-60'
                          : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={t.completed}
                          onChange={(e) =>
                            user &&
                            profile &&
                            toggleTaskCompleted(t, e.target.checked, { uid: user.uid, name: profile.name })
                          }
                          className="mt-0.5 rounded text-indigo-600 focus:ring-indigo-500"
                        />
                        <div>
                          <p
                            className={`text-xs font-semibold ${
                              t.completed ? 'line-through text-slate-500' : 'text-slate-900'
                            }`}
                          >
                            {t.title}
                          </p>
                          {t.description && (
                            <p className="text-[11px] text-slate-500 mt-0.5">{t.description}</p>
                          )}
                          <div className="flex items-center gap-2 text-[10px] text-slate-400 font-mono mt-1">
                            <Clock className="w-3 h-3" />
                            <span>Vence: {formatDateTimeSP(t.dueDate)}</span>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => deleteTask(t.id)}
                        className="text-slate-400 hover:text-rose-600 p-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal de Confirmação de Exclusão com Histórico (Requisito Seção 4) */}
      {confirmDeleteModal.isOpen && (
        <div className="fixed inset-0 z-60 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>

            <div>
              <h3 className="text-base font-bold text-slate-900">
                Confirmar Exclusão de Lead
              </h3>
              {confirmDeleteModal.hasHistory ? (
                <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 space-y-1">
                  <p className="font-semibold">Atenção: Este lead possui histórico registrado!</p>
                  <p>
                    Conversas vinculadas: <strong>{confirmDeleteModal.conversationsCount}</strong>
                    <br />
                    Tarefas cadastradas: <strong>{confirmDeleteModal.tasksCount}</strong>
                  </p>
                  <p>A exclusão do lead manterá o histórico auditável desvinculado.</p>
                </div>
              ) : (
                <p className="text-xs text-slate-600 mt-1">
                  Tem certeza de que deseja excluir o lead <strong>{lead.name}</strong>? Esta ação é irreversível.
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() =>
                  setConfirmDeleteModal({ isOpen: false, hasHistory: false, conversationsCount: 0, tasksCount: 0 })
                }
                className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors shadow-xs"
              >
                Sim, Excluir Lead
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
