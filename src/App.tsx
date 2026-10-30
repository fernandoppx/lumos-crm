/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { ToastProvider, useToast } from './components/common/Toast.tsx';
import { Sidebar, NavTab } from './components/layout/Sidebar.tsx';
import { Header } from './components/layout/Header.tsx';
import { AuthScreen } from './components/auth/AuthScreen.tsx';
import { DashboardView } from './components/dashboard/DashboardView.tsx';
import { LeadsView } from './components/leads/LeadsView.tsx';
import { KanbanView } from './components/kanban/KanbanView.tsx';
import { InboxView } from './components/inbox/InboxView.tsx';
import { TasksView } from './components/tasks/TasksView.tsx';
import { ReportsView } from './components/reports/ReportsView.tsx';
import { WhatsAppIntegrationView } from './components/whatsapp/WhatsAppIntegrationView.tsx';
import { SettingsView } from './components/settings/SettingsView.tsx';
import { LeadDrawer } from './components/leads/LeadDrawer.tsx';
import { NewLeadModal } from './components/leads/NewLeadModal.tsx';
import {
  Lead,
  PipelineStage,
  Task,
  Conversation,
  Activity,
  WhatsAppConnectionState,
} from './types/crm.ts';
import {
  subscribeStages,
  ensureDefaultStagesExist,
  subscribeLeads,
  subscribeTasks,
  subscribeConversations,
  getOrCreateConversationForLead,
} from './services/crmService.ts';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from './lib/firebase.ts';

function CRMContent() {
  const { user, profile, loading: authLoading } = useAuth();
  const { error, success } = useToast();

  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Firestore States
  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [recentActivities, setRecentActivities] = useState<Activity[]>([]);

  // WhatsApp connection state
  const [whatsAppConnection, setWhatsAppConnection] = useState<WhatsAppConnectionState>({
    status: 'disconnected',
    updatedAt: new Date().toISOString(),
  });

  // Modal & Drawer states
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isNewLeadModalOpen, setIsNewLeadModalOpen] = useState(false);
  const [selectedLeadForChat, setSelectedLeadForChat] = useState<Lead | null>(null);

  // Consulta do estado de conexão da Evolution API
  const refreshWhatsAppStatus = async () => {
    try {
      const response = await fetch('/api/whatsapp/status');
      if (response.ok) {
        const data = await response.json();
        setWhatsAppConnection({
          status: data.state || (data.configured ? 'connecting' : 'disconnected'),
          instanceName: data.instanceName,
          connectedPhone: data.connectedPhone,
          lastConnectedAt: data.lastCheckedAt,
          errorMessage: data.message,
          updatedAt: data.lastCheckedAt || new Date().toISOString(),
        });
      }
    } catch (err) {
      console.warn('Erro ao consultar status da Evolution API:', err);
    }
  };

  useEffect(() => {
    if (!user) return;

    // Inicializa etapas padrão se vazias
    ensureDefaultStagesExist().then((initialStages) => {
      if (initialStages.length > 0) setStages(initialStages);
    });

    // Assina etapas
    const unsubStages = subscribeStages((updatedStages) => {
      setStages(updatedStages);
    });

    // Assina leads
    const unsubLeads = subscribeLeads((updatedLeads) => {
      setLeads(updatedLeads);
    });

    // Assina tarefas
    const unsubTasks = subscribeTasks((updatedTasks) => {
      setTasks(updatedTasks);
    });

    // Assina conversas
    const unsubConvs = subscribeConversations((updatedConvs) => {
      setConversations(updatedConvs);
    });

    // Assina atividades recentes globais para o dashboard
    const actQuery = query(collection(db, 'activities'), orderBy('timestamp', 'desc'), limit(25));
    const unsubActs = onSnapshot(actQuery, (snap) => {
      const acts: Activity[] = [];
      snap.forEach((d) => acts.push({ id: d.id, ...(d.data() as any) }));
      setRecentActivities(acts);
    });

    // Checa status do WhatsApp
    refreshWhatsAppStatus();
    const interval = setInterval(refreshWhatsAppStatus, 15000);

    return () => {
      if (unsubStages) unsubStages();
      if (unsubLeads) unsubLeads();
      if (unsubTasks) unsubTasks();
      if (unsubConvs) unsubConvs();
      if (unsubActs) unsubActs();
      clearInterval(interval);
    };
  }, [user]);

  // Se o usuário clicar para conversar com um lead
  const handleOpenWhatsAppFromLead = async (lead: Lead) => {
    try {
      await getOrCreateConversationForLead(lead);
      setSelectedLeadForChat(lead);
      setSelectedLead(null);
      setCurrentTab('inbox');
    } catch (err: any) {
      error('Erro ao abrir conversa', err.message);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-400 font-medium tracking-wide">Carregando LUMOS CRM...</p>
        </div>
      </div>
    );
  }

  // Login obrigatório
  if (!user) {
    return <AuthScreen />;
  }

  const unreadMessagesTotal = conversations.reduce((acc, c) => acc + (c.unreadCount || 0), 0);

  return (
    <div className="min-h-screen bg-slate-50 flex">
      {/* Sidebar de Navegação */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        unreadCount={unreadMessagesTotal}
        whatsAppStatus={whatsAppConnection.status}
      />

      {/* Área de Conteúdo Principal */}
      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen">
        <Header
          currentTab={currentTab}
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
          onOpenNewLeadModal={() => setIsNewLeadModalOpen(true)}
          onOpenQuickTaskModal={() => setCurrentTab('tasks')}
        />

        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          {currentTab === 'dashboard' && (
            <DashboardView
              leads={leads}
              tasks={tasks}
              stages={stages}
              activities={recentActivities}
              onNavigate={setCurrentTab}
              onOpenLead={(lead) => setSelectedLead(lead)}
            />
          )}

          {currentTab === 'leads' && (
            <LeadsView
              leads={leads}
              stages={stages}
              onOpenLead={(lead) => setSelectedLead(lead)}
              onOpenNewLeadModal={() => setIsNewLeadModalOpen(true)}
              onOpenWhatsApp={handleOpenWhatsAppFromLead}
            />
          )}

          {currentTab === 'kanban' && (
            <KanbanView
              leads={leads}
              stages={stages}
              onOpenLead={(lead) => setSelectedLead(lead)}
              onOpenNewLeadModal={() => setIsNewLeadModalOpen(true)}
              onOpenWhatsApp={handleOpenWhatsAppFromLead}
            />
          )}

          {currentTab === 'inbox' && (
            <InboxView
              conversations={conversations}
              leads={leads}
              stages={stages}
              whatsAppStatus={whatsAppConnection.status}
              selectedLeadForChat={selectedLeadForChat}
              onClearSelectedLead={() => setSelectedLeadForChat(null)}
              onOpenLead={(lead) => setSelectedLead(lead)}
              onNavigateToIntegration={() => setCurrentTab('whatsapp')}
            />
          )}

          {currentTab === 'tasks' && (
            <TasksView
              tasks={tasks}
              leads={leads}
              onOpenLead={(lead) => setSelectedLead(lead)}
            />
          )}

          {currentTab === 'reports' && (
            <ReportsView
              leads={leads}
              stages={stages}
              tasks={tasks}
            />
          )}

          {currentTab === 'whatsapp' && (
            <WhatsAppIntegrationView
              connectionState={whatsAppConnection}
              onRefreshStatus={refreshWhatsAppStatus}
            />
          )}

          {currentTab === 'settings' && (
            <SettingsView stages={stages} />
          )}
        </main>
      </div>

      {/* Drawer Lateral de Detalhes do Lead */}
      <LeadDrawer
        lead={selectedLead}
        stages={stages}
        tasks={tasks}
        onClose={() => setSelectedLead(null)}
        onOpenWhatsApp={handleOpenWhatsAppFromLead}
      />

      {/* Modal de Criação de Novo Lead */}
      <NewLeadModal
        isOpen={isNewLeadModalOpen}
        stages={stages}
        existingLeads={leads}
        onClose={() => setIsNewLeadModalOpen(false)}
        onLeadCreated={(leadId) => {
          const created = leads.find((l) => l.id === leadId);
          if (created) setSelectedLead(created);
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <CRMContent />
      </ToastProvider>
    </AuthProvider>
  );
}
