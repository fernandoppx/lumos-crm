import React from 'react';
import { Menu, Plus, PhoneCall } from 'lucide-react';
import { NavTab } from './Sidebar.tsx';

interface HeaderProps {
  currentTab: NavTab;
  onOpenMobileSidebar: () => void;
  onOpenNewLeadModal: () => void;
  onOpenQuickTaskModal: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onOpenMobileSidebar,
  onOpenNewLeadModal,
  onOpenQuickTaskModal,
}) => {
  const getTabTitle = (tab: NavTab) => {
    switch (tab) {
      case 'dashboard':
        return { title: 'Dashboard Comercial', subtitle: 'Métricas gerais e indicadores de desempenho' };
      case 'leads':
        return { title: 'Gestão de Leads', subtitle: 'Cadastro, segmentação e histórico de contatos' };
      case 'kanban':
        return { title: 'Quadro Kanban', subtitle: 'Pipeline de vendas e evolução de oportunidades' };
      case 'inbox':
        return { title: 'Caixa de Entrada WhatsApp', subtitle: 'Atendimento comercial individual e conversas' };
      case 'tasks':
        return { title: 'Tarefas e Follow-ups', subtitle: 'Lembretes de contato e compromissos comerciais' };
      case 'reports':
        return { title: 'Relatórios de Desempenho', subtitle: 'Análise de funil, origens e conversão' };
      case 'whatsapp':
        return { title: 'Integração WhatsApp (QR Code)', subtitle: 'Conexão via Evolution API e webhooks' };
      case 'settings':
        return { title: 'Configurações do CRM', subtitle: 'Etapas de funil, ambiente e dados' };
    }
  };

  const { title, subtitle } = getTabTitle(currentTab);

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-4 sticky top-0 z-30">
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileSidebar}
          className="lg:hidden p-2 text-slate-500 hover:text-slate-800 rounded-md hover:bg-slate-100"
          aria-label="Abrir menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-sm sm:text-base font-bold text-slate-900 leading-tight">
            {title}
          </h1>
          <p className="hidden sm:block text-[11px] text-slate-500 leading-none mt-0.5">
            {subtitle}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={onOpenQuickTaskModal}
          className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-xs"
        >
          <PhoneCall className="w-3.5 h-3.5 text-slate-500" />
          <span>Agendar Follow-up</span>
        </button>

        <button
          onClick={onOpenNewLeadModal}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Lead</span>
        </button>
      </div>
    </header>
  );
};
