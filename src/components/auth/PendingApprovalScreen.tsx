import React from 'react';
import { Clock, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';

export const PendingApprovalScreen: React.FC = () => {
  const { profile, user, logout } = useAuth();
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="max-w-sm w-full bg-slate-900/80 border border-slate-800 rounded-2xl p-7 text-center space-y-4 shadow-2xl">
        <div className="w-12 h-12 mx-auto rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
          <Clock className="w-6 h-6 text-amber-400" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-base font-bold text-white">Acesso aguardando aprovação</h1>
          <p className="text-xs text-slate-400 leading-relaxed">
            Sua conta <span className="text-slate-200 font-medium">{profile?.email || user?.email}</span> foi criada.
            Um administrador do LUMOS CRM precisa liberar seu acesso em <span className="text-slate-200">Configurações → Equipe</span>.
          </p>
          <p className="text-[11px] text-slate-500">Esta tela atualiza sozinha assim que o acesso for liberado.</p>
        </div>
        <button
          onClick={logout}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-300 hover:text-white px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          Sair
        </button>
      </div>
    </div>
  );
};
