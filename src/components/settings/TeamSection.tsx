import React, { useState } from 'react';
import { Users, Check, Ban, RotateCcw } from 'lucide-react';
import { UserProfile, UserRole, ROLE_LABELS } from '../../types/crm.ts';
import { updateUserAccess } from '../../services/crmService.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import { useToast } from '../common/Toast.tsx';
import { formatDateSP } from '../../utils/formatters.ts';

export const TeamSection: React.FC<{ team: UserProfile[] }> = ({ team }) => {
  const { user } = useAuth();
  const { success, error } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const pending = team.filter((u) => u.active === false && !u.approvedAt);
  const others = team.filter((u) => !(u.active === false && !u.approvedAt));

  const change = async (u: UserProfile, updates: { active?: boolean; role?: UserRole }, msg: string) => {
    if (!user) return;
    setBusy(u.uid);
    try {
      await updateUserAccess(u.uid, updates, { uid: user.uid });
      success(msg);
    } catch (e: any) {
      error('Não foi possível alterar', e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-indigo-600" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">Equipe e acessos</h3>
            <p className="text-xs text-slate-500 mt-0.5">Novas contas só entram depois da sua aprovação.</p>
          </div>
        </div>
        <span className="text-xs font-mono text-slate-400">{team.length} pessoas</span>
      </div>

      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">Aguardando aprovação</p>
          {pending.map((u) => (
            <div key={u.uid} className="flex items-center justify-between gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-900 truncate">{u.name}</p>
                <p className="text-[11px] text-slate-500 truncate">
                  {u.email} · pediu em {formatDateSP(u.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  disabled={busy === u.uid}
                  onClick={() => change(u, { active: true, role: 'sales_rep' }, `${u.name} liberado(a) como vendedor(a).`)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" /> Aprovar
                </button>
                <button
                  disabled={busy === u.uid}
                  onClick={() => change(u, { active: false }, 'Pedido recusado.')}
                  className="px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-white rounded-md disabled:opacity-50"
                  title="Mantém a conta bloqueada"
                >
                  Recusar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="divide-y divide-slate-100">
        {others.map((u) => {
          const isMe = u.uid === user?.uid;
          const blocked = u.active === false;
          return (
            <div key={u.uid} className="py-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${blocked ? 'bg-slate-100 text-slate-300' : 'bg-indigo-50 text-indigo-700'}`}>
                  {u.name?.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className={`text-xs font-semibold truncate ${blocked ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                    {u.name} {isMe && <span className="text-[10px] font-medium text-indigo-600 no-underline">(você)</span>}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">{u.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <select
                  value={u.role}
                  disabled={isMe || busy === u.uid || blocked}
                  onChange={(e) => change(u, { role: e.target.value as UserRole }, `Papel de ${u.name} atualizado.`)}
                  className="text-[11px] px-2 py-1 border border-slate-200 rounded-md bg-white disabled:bg-slate-50 disabled:text-slate-400"
                >
                  {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
                {!isMe &&
                  (blocked ? (
                    <button
                      disabled={busy === u.uid}
                      onClick={() => change(u, { active: true }, `${u.name} reativado(a).`)}
                      className="p-1.5 text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-md"
                      title="Reativar acesso"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      disabled={busy === u.uid}
                      onClick={() => {
                        if (window.confirm(`Bloquear o acesso de ${u.name}? A pessoa não consegue mais entrar no CRM.`)) {
                          change(u, { active: false }, `Acesso de ${u.name} bloqueado.`);
                        }
                      }}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md"
                      title="Bloquear acesso"
                    >
                      <Ban className="w-3.5 h-3.5" />
                    </button>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-slate-400">
        <strong>Vendedor</strong>: atende as próprias conversas. <strong>Gestor</strong>: vê e transfere todas as conversas e
        gerencia os números. <strong>Administrador</strong>: tudo isso e aprova acessos.
      </p>
    </div>
  );
};
