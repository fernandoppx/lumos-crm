import React, { useEffect, useState } from 'react';
import { Zap, Plus, Trash2 } from 'lucide-react';
import { QuickReply } from '../../types/crm.ts';
import { subscribeQuickReplies, createQuickReply, deleteQuickReply } from '../../services/crmService.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useToast } from '../common/Toast.tsx';

export const QuickRepliesSection: React.FC = () => {
  const { user, profile, isManager } = useAuth();
  const { success, error } = useToast();
  const [replies, setReplies] = useState<QuickReply[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => subscribeQuickReplies(setReplies), []);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile || !title.trim() || !body.trim()) return;
    setSaving(true);
    try {
      await createQuickReply(title.replace(/^\//, '').replace(/\s+/g, '-').toLowerCase(), body, { uid: user.uid, name: profile.name });
      setTitle('');
      setBody('');
      success('Resposta rápida criada', 'Digite / na conversa para usar.');
    } catch (err: any) {
      error('Erro ao salvar', err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
      <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
        <Zap className="w-4 h-4 text-indigo-600" />
        <div>
          <h3 className="text-sm font-bold text-slate-900">Respostas rápidas</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Mensagens prontas para a equipe. Na conversa, digite <span className="font-mono">/</span> e escolha. Use{' '}
            <span className="font-mono">{'{nome}'}</span> para inserir o primeiro nome do cliente.
          </p>
        </div>
      </div>

      {replies.length > 0 && (
        <div className="divide-y divide-slate-100">
          {replies.map((r) => (
            <div key={r.id} className="py-2.5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-800 font-mono">/{r.title}</p>
                <p className="text-[11px] text-slate-500 whitespace-pre-wrap line-clamp-3">{r.body}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">por {r.createdByName}</p>
              </div>
              {(isManager || r.createdBy === user?.uid) && (
                <button
                  onClick={() => deleteQuickReply(r.id).catch((e) => error('Erro', e.message))}
                  className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md shrink-0"
                  title="Excluir"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <form onSubmit={add} className="space-y-2 pt-1">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={40}
            placeholder="Atalho (ex.: boas-vindas)"
            className="sm:w-48 text-xs px-3 py-2 border border-slate-200 rounded-lg font-mono"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Olá {nome}! Tudo bem? Aqui é da Lumos..."
            className="flex-1 text-xs px-3 py-2 border border-slate-200 rounded-lg resize-y"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving || !title.trim() || !body.trim()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> Adicionar resposta
          </button>
        </div>
      </form>
    </div>
  );
};
