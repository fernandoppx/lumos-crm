/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.tsx';
import { ToastProvider, useToast } from './components/common/Toast.tsx';
import { Sidebar, NavTab } from './components/layout/Sidebar.tsx';
import { Header } from './components/layout/Header.tsx';
import { AuthScreen } from './components/auth/AuthScreen.tsx';
import { PendingApprovalScreen } from './components/auth/PendingApprovalScreen.tsx';
import { DashboardView } from './components/dashboard/DashboardView.tsx';
import { LeadsView } from './components/leads/LeadsView.tsx';
import { KanbanView } from './components/kanban/KanbanView.tsx';
import { InboxView } from './components/inbox/InboxView.tsx';
import { TasksView } from './components/tasks/TasksView.tsx';
import { ReportsView } from './components/reports/ReportsView.tsx';
import { WhatsAppIntegrationView } from './components/whatsapp/WhatsAppIntegrationView.tsx';
import { InstancePickerModal } from './components/whatsapp/InstancePickerModal.tsx';
import { SettingsView } from './components/settings/SettingsView.tsx';
import { LeadDrawer } from './components/leads/LeadDrawer.tsx';
import { NewLeadModal } from './components/leads/NewLeadModal.tsx';
import {
  Lead,
  PipelineStage,
  Task,
  Conversation,
  Activity,
  WhatsAppInstance,
  UserProfile,
} from './types/crm.ts';
import {
  subscribeStages,
  ensureDefaultStagesExist,
  subscribeLeads,
  subscribeTasks,
  subscribeConversations,
  subscribeInstances,
  subscribeUsers,
  getOrCreateConversationForLead,
} from './services/crmService.ts';
import { useIncomingMessageAlerts } from './hooks/useIncomingMessageAlerts.ts';
import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from './lib/firebase.ts';

function CRMContent() {
  const { user, profile, loading: authLoading, isActive } = useAuth();
  const { error } = useToast();

  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const [stages, setStages] = useState<PipelineStage[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [recentActivities, setRecentActivities] = useState<Activity[]>([]);
  const [instances, setInstances] = useState<WhatsAppInstance[]>([]);
  const [team, setTeam] = useState<UserProfile[]>([]);

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isNewLeadModalOpen, setIsNewLeadModalOpen] = useState(false);
  const [focusConversationId, setFocusConversationId] = useState<string | null>(null);
  const [leadAwaitingInstance, setLeadAwaitingInstance] = useState<Lead | null>(null);

  useEffect(() => {
    if (!user || !isActive) return;

    ensureDefaultStagesExist().then((initialStages) => {
      if (initialStages.length > 0) setStages(initialStages);
    });

    const unsubs = [
      subscribeStages(setStages),
      subscribeLeads(setLeads),
      subscribeTasks(setTasks),
      subscribeConversations(setConversations),
      subscribeInstances(setInstances),
      subscribeUsers(setTeam),
      onSnapshot(query(collection(db, 'activities'), orderBy('timestamp', 'desc'), limit(25)), (snap) => {
        setRecentActivities(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
      }),
    ];

    return () => unsubs.forEach((u) => u && u());
  }, [user, isActive]);

  useIncomingMessageAlerts({
    conversations,
    userId: user?.uid || null,
    viewingConversationId: currentTab === 'inbox' ? focusConversationId : null,
    onOpen: (id) => {
      setFocusConversationId(id);
      setCurrentTab('inbox');
    },
  });

  const openConversationForLead = async (lead: Lead, instance: WhatsAppInstance) => {
    if (!user || !profile) return;
    try {
      const conv = await getOrCreateConversationForLead(lead, instance, { uid: user.uid, name: profile.name });
      setFocusConversationId(conv.id);
      setSelectedLead(null);
      setCurrentTab('inbox');
    } catch (err: any) {
      error('Erro ao abrir conversa', err.message);
    }
  };

  /** Ao clicar em "WhatsApp" num lead: reaproveita a conversa existente ou escolhe o número certo. */
  const handleOpenWhatsAppFromLead = async (lead: Lead) => {
    if (!user) return;
    const existing = conversations
      .filter((c) => c.leadId === lead.id)
      .sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || ''));
    if (existing.length > 0) {
      setFocusConversationId(existing[0].id);
      setSelectedLead(null);
      setCurrentTab('inbox');
      return;
    }

    if (instances.length === 0) {
      error('Nenhum número de WhatsApp cadastrado', 'Adicione e conecte um número em Integração WhatsApp.');
      setCurrentTab('whatsapp');
      return;
    }

    const connected = instances.filter((i) => i.state === 'connected');
    const mine = connected.filter((i) => i.ownerId === user.uid);
    const leadOwners = connected.filter((i) => i.ownerId && i.ownerId === lead.ownerId);
    const choice =
      mine.length === 1 ? mine[0] : mine.length === 0 && leadOwners.length === 1 ? leadOwners[0] : connected.length === 1 && mine.length === 0 ? connected[0] : null;

    if (choice) {
      await openConversationForLead(lead, choice);
    } else {
      setLeadAwaitingInstance(lead);
    }
  };

  const unreadMessagesTotal = useMemo(
    () =>
      conversations
        .filter((c) => !c.assignedTo || c.assignedTo === user?.uid)
        .reduce((acc, c) => acc + (c.unreadCount || 0), 0),
    [conversations, user?.uid]
  );

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

  if (!user) return <AuthScreen />;
  if (!isActive) return <PendingApprovalScreen />;

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar
        currentTab={currentTab}
        onSelectTab={setCurrentTab}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        unreadCount={unreadMessagesTotal}
        instances={instances}
        pendingUsers={team.filter((u) => u.active === false).length}
      />

      <div className="flex-1 lg:pl-64 flex flex-col min-h-screen min-w-0">
        <Header
          currentTab={currentTab}
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
          onOpenNewLeadModal={() => setIsNewLeadModalOpen(true)}
          onOpenQuickTaskModal={() => setCurrentTab('tasks')}
        />

        <main className={`flex-1 w-full mx-auto ${currentTab === 'inbox' ? 'p-0 sm:p-4 max-w-[1600px]' : 'p-4 sm:p-6 max-w-7xl'}`}>
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
              instances={instances}
              team={team}
              focusConversationId={focusConversationId}
              onFocusConversation={setFocusConversationId}
              onOpenLead={(lead) => setSelectedLead(lead)}
              onNavigateToIntegration={() => setCurrentTab('whatsapp')}
            />
          )}

          {currentTab === 'tasks' && (
            <TasksView tasks={tasks} leads={leads} onOpenLead={(lead) => setSelectedLead(lead)} />
          )}

          {currentTab === 'reports' && <ReportsView leads={leads} stages={stages} tasks={tasks} />}

          {currentTab === 'whatsapp' && <WhatsAppIntegrationView instances={instances} team={team} />}

          {currentTab === 'settings' && <SettingsView stages={stages} team={team} />}
        </main>
      </div>

      <LeadDrawer
        lead={selectedLead}
        stages={stages}
        tasks={tasks}
        onClose={() => setSelectedLead(null)}
        onOpenWhatsApp={handleOpenWhatsAppFromLead}
      />

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

      <InstancePickerModal
        lead={leadAwaitingInstance}
        instances={instances}
        currentUserId={user.uid}
        onClose={() => setLeadAwaitingInstance(null)}
        onPick={(inst) => {
          const lead = leadAwaitingInstance;
          setLeadAwaitingInstance(null);
          if (lead) openConversationForLead(lead, inst);
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
