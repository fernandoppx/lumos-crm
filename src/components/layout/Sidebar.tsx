import React from 'react';
import {
  LayoutDashboard,
  Users,
  Kanban,
  MessageSquare,
  CheckSquare,
  BarChart3,
  QrCode,
  Settings,
  LogOut,
  X,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.tsx';
import { WhatsAppConnectionState } from '../../types/crm.ts';

export type NavTab =
  | 'dashboard'
  | 'leads'
  | 'kanban'
  | 'inbox'
  | 'tasks'
  | 'reports'
  | 'whatsapp'
  | 'settings';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  unreadCount?: number;
  whatsAppStatus: WhatsAppConnectionState['status'];
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  isOpenMobile,
  onCloseMobile,
  unreadCount = 0,
  whatsAppStatus,
}) => {
  const { profile, logout } = useAuth();

  const navItems = [
    { id: 'dashboard' as NavTab, label: 'Dashboard', icon: LayoutDashboard },
    { id: 'leads' as NavTab, label: 'Leads', icon: Users },
    { id: 'kanban' as NavTab, label: 'Kanban', icon: Kanban },
    {
      id: 'inbox' as NavTab,
      label: 'Caixa de entrada',
      icon: MessageSquare,
      badge: unreadCount > 0 ? unreadCount : undefined,
    },
    { id: 'tasks' as NavTab, label: 'Tarefas', icon: CheckSquare },
    { id: 'reports' as NavTab, label: 'Relatórios', icon: BarChart3 },
    {
      id: 'whatsapp' as NavTab,
      label: 'Integração WhatsApp',
      icon: QrCode,
      statusDot: whatsAppStatus,
    },
    { id: 'settings' as NavTab, label: 'Configurações', icon: Settings },
  ];

  const getStatusLabel = (status: WhatsAppConnectionState['status']) => {
    switch (status) {
      case 'connected':
        return { label: 'Conectado', color: 'text-emerald-700 bg-emerald-50 border-emerald-200' };
      case 'connecting':
        return { label: 'Aguardando QR', color: 'text-amber-700 bg-amber-50 border-amber-200' };
      case 'error':
        return { label: 'Erro de conexão', color: 'text-rose-700 bg-rose-50 border-rose-200' };
      default:
        return { label: 'Desconectado', color: 'text-slate-600 bg-slate-100 border-slate-200' };
    }
  };

  const statusInfo = getStatusLabel(whatsAppStatus);

  return (
    <>
      {/* Overlay para celular */}
      {isOpenMobile && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-40 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={`fixed top-0 bottom-0 left-0 z-40 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Zone */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-xs">
              L
            </div>
            <div>
              <span className="text-base font-bold text-slate-900 tracking-tight block leading-tight">
                LUMOS CRM
              </span>
              <span className="text-[11px] font-medium text-slate-400 block leading-none mt-0.5">
                Vendas & WhatsApp
              </span>
            </div>
          </div>
          <button
            onClick={onCloseMobile}
            className="lg:hidden p-1.5 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status da Conexão WhatsApp */}
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 font-medium">WhatsApp</span>
            <span className={`px-2 py-0.5 text-[10px] font-semibold border rounded ${statusInfo.color}`}>
              {statusInfo.label}
            </span>
          </div>
        </div>

        {/* Menu Navigation Links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onSelectTab(item.id);
                  onCloseMobile();
                }}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 text-xs font-medium rounded-lg transition-colors text-left ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                  <span className="truncate">{item.label}</span>
                </div>
                {item.badge !== undefined && (
                  <span className="px-1.5 py-0.5 text-[10px] font-bold bg-indigo-600 text-white rounded-full">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer com usuário e logout */}
        <div className="p-3 border-t border-slate-100 bg-white">
          <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-semibold text-xs shrink-0">
                {profile?.name?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-800 truncate leading-tight">
                  {profile?.name || 'Vendedor'}
                </p>
                <p className="text-[11px] text-slate-400 truncate leading-tight">
                  {profile?.email || 'Comercial'}
                </p>
              </div>
            </div>
            <button
              onClick={logout}
              title="Encerrar sessão"
              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
