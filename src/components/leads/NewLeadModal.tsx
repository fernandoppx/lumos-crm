import React, { useState } from 'react';
import { X, AlertCircle, Phone, User, Building, Mail, DollarSign, Tag, Check } from 'lucide-react';
import { PipelineStage, LEAD_SOURCES, Lead } from '../../types/crm.ts';
import { normalizePhone, formatPhoneDisplay } from '../../utils/formatters.ts';
import { createLead, findLeadByPhone } from '../../services/crmService.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useToast } from '../common/Toast.tsx';

interface NewLeadModalProps {
  isOpen: boolean;
  stages: PipelineStage[];
  existingLeads: Lead[];
  onClose: () => void;
  onLeadCreated?: (leadId: string) => void;
}

export const NewLeadModal: React.FC<NewLeadModalProps> = ({
  isOpen,
  stages,
  existingLeads,
  onClose,
  onLeadCreated,
}) => {
  const { user, profile } = useAuth();
  const { success, error, warning } = useToast();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [source, setSource] = useState(LEAD_SOURCES[0]);
  const [stageId, setStageId] = useState(stages[0]?.id || '');
  const [value, setValue] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>(['Novo']);
  const [tagInput, setTagInput] = useState('');
  const [consentMessaging, setConsentMessaging] = useState(true);
  const [consentSource, setConsentSource] = useState('Cadastro Comercial Manual');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<Lead | null>(null);

  if (!isOpen) return null;

  const handlePhoneBlur = () => {
    if (!phone) {
      setDuplicateWarning(null);
      return;
    }
    const normalized = normalizePhone(phone);
    const existing = existingLeads.find((l) => l.phone === normalized);
    if (existing) {
      setDuplicateWarning(existing);
      warning('Atenção: Número de telefone duplicado!', `Já cadastrado no lead "${existing.name}"`);
    } else {
      setDuplicateWarning(null);
    }
  };

  const handleAddTag = () => {
    if (!tagInput.trim()) return;
    const clean = tagInput.trim();
    if (!tags.includes(clean)) {
      setTags([...tags, clean]);
    }
    setTagInput('');
  };

  const handleRemoveTag = (t: string) => {
    setTags(tags.filter((item) => item !== t));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) {
      error('Você precisa estar autenticado para cadastrar leads.');
      return;
    }
    if (!name.trim()) {
      error('O nome do lead é obrigatório.');
      return;
    }
    if (!phone.trim()) {
      error('O telefone é obrigatório.');
      return;
    }

    try {
      setIsSubmitting(true);
      const normalizedPhone = normalizePhone(phone);

      const targetStageId = stageId || stages[0]?.id;
      const leadId = await createLead(
        {
          name: name.trim(),
          phone: normalizedPhone,
          email: email.trim() || undefined,
          company: company.trim() || undefined,
          source,
          stageId: targetStageId,
          ownerId: user.uid,
          ownerName: profile.name,
          value: typeof value === 'number' ? value : 0,
          notes: notes.trim() || undefined,
          tags,
          consentMessaging,
          consentSource: consentMessaging ? consentSource : undefined,
          consentDate: consentMessaging ? new Date().toISOString() : undefined,
        },
        { uid: user.uid, name: profile.name }
      );

      success('Lead cadastrado com sucesso!');
      if (onLeadCreated) onLeadCreated(leadId);
      onClose();
    } catch (err: any) {
      error('Erro ao cadastrar lead', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-bold text-slate-900">Novo Lead Comercial</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Cadastre a oportunidade para acompanhamento no Kanban e WhatsApp
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Alerta de telefone duplicado */}
        {duplicateWarning && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Telefone já cadastrado no CRM!</p>
              <p className="mt-0.5">
                O contato <strong>{duplicateWarning.name}</strong> ({duplicateWarning.company || 'Sem empresa'}) já utiliza o número {formatPhoneDisplay(duplicateWarning.phone)}.
              </p>
            </div>
          </div>
        )}

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nome do Lead *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: João da Silva"
                className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Telefone com DDD (WhatsApp) *
              </label>
              <input
                type="text"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={handlePhoneBlur}
                placeholder="Ex: (11) 98765-4321 ou +5511..."
                className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 bg-white font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                E-mail Corporativo
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="joao@empresa.com.br"
                className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Empresa
              </label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder="Nome da empresa do lead"
                className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 bg-white"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Origem do Lead
              </label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 bg-white"
              >
                {LEAD_SOURCES.map((src) => (
                  <option key={src} value={src}>
                    {src}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Etapa Inicial no Funil
              </label>
              <select
                value={stageId || stages[0]?.id}
                onChange={(e) => setStageId(e.target.value)}
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
                Valor Estimado da Oportunidade (R$)
              </label>
              <input
                type="number"
                min="0"
                step="50"
                value={value}
                onChange={(e) => setValue(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="0.00"
                className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 bg-white font-mono"
              />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Etiquetas (Tags)
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-slate-100 text-slate-700 rounded-md border border-slate-200"
                >
                  <span>{t}</span>
                  <button type="button" onClick={() => handleRemoveTag(t)}>
                    <X className="w-3 h-3 hover:text-rose-600" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="Digitar etiqueta e teclar Enter..."
                className="flex-1 text-xs px-3 py-1.5 border border-slate-200 rounded-lg bg-white"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="px-3 py-1.5 text-xs text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                Adicionar
              </button>
            </div>
          </div>

          {/* Consentimento */}
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="modalConsent"
                checked={consentMessaging}
                onChange={(e) => setConsentMessaging(e.target.checked)}
                className="rounded text-indigo-600 focus:ring-indigo-500"
              />
              <label htmlFor="modalConsent" className="text-xs font-semibold text-slate-800 cursor-pointer">
                Consentimento para comunicação comercial via WhatsApp (LGPD)
              </label>
            </div>
            {consentMessaging && (
              <input
                type="text"
                value={consentSource}
                onChange={(e) => setConsentSource(e.target.value)}
                placeholder="Origem do consentimento (ex: Formulário Web)"
                className="w-full text-xs px-2.5 py-1 bg-white border border-slate-200 rounded"
              />
            )}
          </div>

          {/* Observações */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Observações Iniciais
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Detalhes sobre a demanda, necessidades ou próximos passos..."
              className="w-full text-xs px-3 py-2 border border-slate-200 rounded-lg focus:outline-hidden focus:border-indigo-500 bg-white"
            />
          </div>

          {/* Footer ações */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors shadow-xs disabled:opacity-50"
            >
              {isSubmitting ? 'Salvando...' : 'Cadastrar Lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
