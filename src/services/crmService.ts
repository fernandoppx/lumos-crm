import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  writeBatch,
  limit,
  increment,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import {
  Lead,
  PipelineStage,
  Task,
  Activity,
  Conversation,
  Message,
  DEFAULT_PIPELINE_STAGES,
  WhatsAppInstance,
  UserProfile,
  UserRole,
  QuickReply,
} from '../types/crm.ts';
import { apiFetch } from '../lib/api.ts';
import { normalizePhone } from '../utils/formatters.ts';

// Coleções
const LEADS_COL = 'leads';
const STAGES_COL = 'pipeline_stages';
const TASKS_COL = 'tasks';
const ACTIVITIES_COL = 'activities';
const CONVERSATIONS_COL = 'conversations';
const MESSAGES_COL = 'messages';

// --- PIPELINE STAGES ---

export function subscribeStages(onUpdate: (stages: PipelineStage[]) => void, onError?: (err: any) => void) {
  try {
    const q = query(collection(db, STAGES_COL), orderBy('order', 'asc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const stages: PipelineStage[] = [];
        snapshot.forEach((docSnap) => {
          stages.push({ id: docSnap.id, ...(docSnap.data() as Omit<PipelineStage, 'id'>) });
        });
        onUpdate(stages);
      },
      (error) => {
        if (onError) onError(error);
        handleFirestoreError(error, OperationType.LIST, STAGES_COL);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, STAGES_COL);
  }
}

export async function ensureDefaultStagesExist(): Promise<PipelineStage[]> {
  try {
    const snapshot = await getDocs(query(collection(db, STAGES_COL), orderBy('order', 'asc')));
    if (!snapshot.empty) {
      return snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PipelineStage, 'id'>) }));
    }

    // Inicializa as 8 etapas padrão do Lumus CRM
    const batch = writeBatch(db);
    const createdStages: PipelineStage[] = [];

    for (let i = 0; i < DEFAULT_PIPELINE_STAGES.length; i++) {
      const stageData = DEFAULT_PIPELINE_STAGES[i];
      const stageRef = doc(collection(db, STAGES_COL));
      const newStage: PipelineStage = {
        id: stageRef.id,
        ...stageData,
      };
      batch.set(stageRef, stageData);
      createdStages.push(newStage);
    }

    await batch.commit();
    return createdStages;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, STAGES_COL);
  }
}

export async function createStage(stage: Omit<PipelineStage, 'id'>): Promise<string> {
  try {
    const docRef = await addDoc(collection(db, STAGES_COL), stage);
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, STAGES_COL);
  }
}

export async function updateStage(id: string, updates: Partial<PipelineStage>): Promise<void> {
  try {
    const docRef = doc(db, STAGES_COL, id);
    await updateDoc(docRef, updates);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${STAGES_COL}/${id}`);
  }
}

export async function deleteStage(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, STAGES_COL, id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${STAGES_COL}/${id}`);
  }
}

// --- LEADS ---

export function subscribeLeads(onUpdate: (leads: Lead[]) => void, onError?: (err: any) => void) {
  try {
    const q = query(collection(db, LEADS_COL), orderBy('createdAt', 'desc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const leads: Lead[] = [];
        snapshot.forEach((docSnap) => {
          leads.push({ id: docSnap.id, ...(docSnap.data() as any) });
        });
        onUpdate(leads);
      },
      (error) => {
        if (onError) onError(error);
        handleFirestoreError(error, OperationType.LIST, LEADS_COL);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, LEADS_COL);
  }
}

export async function findLeadByPhone(phone: string): Promise<Lead | null> {
  try {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    const q = query(collection(db, LEADS_COL), where('phone', '==', normalized));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;
    return { id: snapshot.docs[0].id, ...(snapshot.docs[0].data() as any) };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, LEADS_COL);
  }
}

export async function createLead(
  leadData: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>,
  user: { uid: string; name: string }
): Promise<string> {
  try {
    const now = new Date().toISOString();
    const normalizedPhone = normalizePhone(leadData.phone);

    const docData: Omit<Lead, 'id'> = {
      ...leadData,
      phone: normalizedPhone,
      createdAt: now,
      updatedAt: now,
    };

    const docRef = await addDoc(collection(db, LEADS_COL), docData);

    // Registra atividade de criação do lead
    await addDoc(collection(db, ACTIVITIES_COL), {
      leadId: docRef.id,
      userId: user.uid,
      userName: user.name,
      type: 'lead_created',
      description: `Lead cadastrado por ${user.name}`,
      metadata: { initialStage: leadData.stageId },
      timestamp: now,
    });

    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, LEADS_COL);
  }
}

export async function updateLead(
  id: string,
  updates: Partial<Lead>,
  user: { uid: string; name: string }
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const docRef = doc(db, LEADS_COL, id);

    if (updates.phone) {
      updates.phone = normalizePhone(updates.phone);
    }

    await updateDoc(docRef, {
      ...updates,
      updatedAt: now,
    });

    await addDoc(collection(db, ACTIVITIES_COL), {
      leadId: id,
      userId: user.uid,
      userName: user.name,
      type: 'lead_updated',
      description: `Lead atualizado por ${user.name}`,
      timestamp: now,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${LEADS_COL}/${id}`);
  }
}

export async function moveLeadStage(
  leadId: string,
  fromStage: { id: string; name: string },
  toStage: { id: string; name: string },
  user: { uid: string; name: string }
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const docRef = doc(db, LEADS_COL, leadId);

    await updateDoc(docRef, {
      stageId: toStage.id,
      updatedAt: now,
    });

    // Registra movimentação do Kanban na linha do tempo
    await addDoc(collection(db, ACTIVITIES_COL), {
      leadId,
      userId: user.uid,
      userName: user.name,
      type: 'stage_change',
      description: `Etapa alterada de "${fromStage.name}" para "${toStage.name}" por ${user.name}`,
      metadata: {
        fromStageId: fromStage.id,
        fromStageName: fromStage.name,
        toStageId: toStage.id,
        toStageName: toStage.name,
      },
      timestamp: now,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${LEADS_COL}/${leadId}`);
  }
}

export async function checkLeadHasHistory(leadId: string): Promise<{
  hasConversations: boolean;
  hasTasks: boolean;
  conversationsCount: number;
  tasksCount: number;
}> {
  try {
    const convSnap = await getDocs(query(collection(db, CONVERSATIONS_COL), where('leadId', '==', leadId)));
    const taskSnap = await getDocs(query(collection(db, TASKS_COL), where('leadId', '==', leadId)));

    return {
      hasConversations: !convSnap.empty,
      hasTasks: !taskSnap.empty,
      conversationsCount: convSnap.size,
      tasksCount: taskSnap.size,
    };
  } catch (error) {
    return { hasConversations: false, hasTasks: false, conversationsCount: 0, tasksCount: 0 };
  }
}

export async function deleteLead(leadId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, LEADS_COL, leadId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${LEADS_COL}/${leadId}`);
  }
}

// --- TAREFAS ---

export function subscribeTasks(onUpdate: (tasks: Task[]) => void, onError?: (err: any) => void) {
  try {
    const q = query(collection(db, TASKS_COL), orderBy('dueDate', 'asc'));
    return onSnapshot(
      q,
      (snapshot) => {
        const tasks: Task[] = [];
        snapshot.forEach((docSnap) => {
          tasks.push({ id: docSnap.id, ...(docSnap.data() as any) });
        });
        onUpdate(tasks);
      },
      (error) => {
        if (onError) onError(error);
        handleFirestoreError(error, OperationType.LIST, TASKS_COL);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, TASKS_COL);
  }
}

export async function createTask(
  taskData: Omit<Task, 'id' | 'createdAt' | 'completed'>,
  user: { uid: string; name: string }
): Promise<string> {
  try {
    const now = new Date().toISOString();
    const docData = {
      ...taskData,
      completed: false,
      createdAt: now,
    };

    const docRef = await addDoc(collection(db, TASKS_COL), docData);

    // Atualiza próximo follow-up no Lead
    const leadRef = doc(db, LEADS_COL, taskData.leadId);
    await updateDoc(leadRef, {
      nextFollowUpAt: taskData.dueDate,
      updatedAt: now,
    });

    // Registra atividade
    await addDoc(collection(db, ACTIVITIES_COL), {
      leadId: taskData.leadId,
      userId: user.uid,
      userName: user.name,
      type: 'task_created',
      description: `Tarefa agendada: "${taskData.title}" para ${new Date(taskData.dueDate).toLocaleDateString('pt-BR')}`,
      metadata: { taskId: docRef.id, dueDate: taskData.dueDate },
      timestamp: now,
    });

    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, TASKS_COL);
  }
}

export async function toggleTaskCompleted(
  task: Task,
  completed: boolean,
  user: { uid: string; name: string }
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const docRef = doc(db, TASKS_COL, task.id);

    await updateDoc(docRef, {
      completed,
      completedAt: completed ? now : null,
    });

    if (completed) {
      await addDoc(collection(db, ACTIVITIES_COL), {
        leadId: task.leadId,
        userId: user.uid,
        userName: user.name,
        type: 'task_completed',
        description: `Tarefa concluída: "${task.title}"`,
        metadata: { taskId: task.id },
        timestamp: now,
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `${TASKS_COL}/${task.id}`);
  }
}

export async function deleteTask(taskId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, TASKS_COL, taskId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `${TASKS_COL}/${taskId}`);
  }
}

// --- ATIVIDADES E NOTAS ---

export function subscribeLeadActivities(
  leadId: string,
  onUpdate: (activities: Activity[]) => void
) {
  try {
    // Sem orderBy na consulta para não depender de índice composto; ordena no navegador
    const q = query(collection(db, ACTIVITIES_COL), where('leadId', '==', leadId));
    return onSnapshot(
      q,
      (snapshot) => {
        const activities: Activity[] = [];
        snapshot.forEach((docSnap) => {
          activities.push({ id: docSnap.id, ...(docSnap.data() as any) });
        });
        activities.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
        onUpdate(activities);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, ACTIVITIES_COL);
      }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, ACTIVITIES_COL);
  }
}

export async function addLeadNote(
  leadId: string,
  note: string,
  user: { uid: string; name: string }
): Promise<void> {
  try {
    const now = new Date().toISOString();
    await addDoc(collection(db, ACTIVITIES_COL), {
      leadId,
      userId: user.uid,
      userName: user.name,
      type: 'note_added',
      description: note,
      timestamp: now,
    });

    // Atualiza data do lead
    await updateDoc(doc(db, LEADS_COL, leadId), {
      updatedAt: now,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, ACTIVITIES_COL);
  }
}

// --- CONVERSAS E MENSAGENS WHATSAPP ---

export function conversationIdFor(instanceId: string, phone: string): string {
  const digits = phone.replace(/\D/g, '');
  const safeInstance = instanceId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `conv_${safeInstance}_${digits}`;
}

export function subscribeConversations(
  onUpdate: (conversations: Conversation[]) => void,
  onError?: (err: any) => void
) {
  const q = query(collection(db, CONVERSATIONS_COL), orderBy('lastMessageAt', 'desc'), limit(500));
  return onSnapshot(
    q,
    (snapshot) => {
      const convs: Conversation[] = [];
      snapshot.forEach((docSnap) => {
        convs.push({ id: docSnap.id, ...(docSnap.data() as any) });
      });
      onUpdate(convs);
    },
    (error) => {
      console.error('Erro ao carregar conversas:', error);
      if (onError) onError(error);
    }
  );
}

/**
 * Mensagens de uma conversa (últimas 300), em ordem cronológica.
 * Lê também a coleção antiga `messages` para conversas criadas pela versão anterior.
 */
export function subscribeMessages(conversationId: string, onUpdate: (messages: Message[]) => void) {
  let current: Message[] = [];
  let legacy: Message[] = [];
  const emit = () => {
    const all = [...legacy, ...current];
    all.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
    onUpdate(all);
  };

  const unsubNew = onSnapshot(
    query(collection(db, CONVERSATIONS_COL, conversationId, 'messages'), orderBy('timestamp', 'desc'), limit(300)),
    (snap) => {
      current = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      emit();
    },
    (err) => console.error('Erro ao carregar mensagens:', err)
  );
  const unsubLegacy = onSnapshot(
    query(collection(db, MESSAGES_COL), where('conversationId', '==', conversationId)),
    (snap) => {
      legacy = snap.docs.map((d) => ({ id: `legacy_${d.id}`, ...(d.data() as any) }));
      emit();
    },
    () => {
      legacy = [];
    }
  );
  return () => {
    unsubNew();
    unsubLegacy();
  };
}

/** Abre (ou cria) a conversa de um lead em um número específico. */
export async function getOrCreateConversationForLead(
  lead: Lead,
  instance: Pick<WhatsAppInstance, 'id' | 'label' | 'ownerId' | 'ownerName'>,
  currentUser: { uid: string; name: string }
): Promise<Conversation> {
  const normalizedPhone = normalizePhone(lead.phone);
  if (!normalizedPhone) throw new Error('Este lead não tem um telefone válido.');
  const convId = conversationIdFor(instance.id, normalizedPhone);
  const ref = doc(db, CONVERSATIONS_COL, convId);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const existing = { id: snap.id, ...(snap.data() as any) } as Conversation;
    if (!existing.leadId) {
      await updateDoc(ref, { leadId: lead.id, contactName: lead.name });
    }
    return existing;
  }

  const now = new Date().toISOString();
  const newConvData: Omit<Conversation, 'id'> = {
    phone: normalizedPhone,
    contactName: lead.name,
    leadId: lead.id,
    instanceId: instance.id,
    instanceLabel: instance.label,
    lastMessage: 'Conversa iniciada pelo CRM',
    lastMessageAt: now,
    unreadCount: 0,
    assignedTo: lead.ownerId || currentUser.uid,
    assignedToName: lead.ownerName || currentUser.name,
    status: 'open',
    updatedAt: now,
  };
  await setDoc(ref, { ...newConvData, createdAt: now });
  return { id: convId, ...newConvData };
}

export async function sendMessage(conversation: Conversation, body: string): Promise<{ success: boolean; error?: string }> {
  try {
    await apiFetch('/api/whatsapp/send', { body: { conversationId: conversation.id, text: body } });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function sendMediaMessage(
  conversation: Conversation,
  file: { base64: string; mimetype: string; fileName: string; caption?: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    await apiFetch('/api/whatsapp/send-media', { body: { conversationId: conversation.id, ...file } });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function markConversationRead(conversationId: string): Promise<void> {
  try {
    await updateDoc(doc(db, CONVERSATIONS_COL, conversationId), { unreadCount: 0 });
  } catch (err) {
    console.warn('Não foi possível marcar como lida:', err);
  }
}

export async function markConversationUnread(conversationId: string): Promise<void> {
  await updateDoc(doc(db, CONVERSATIONS_COL, conversationId), { unreadCount: increment(1) });
}

export async function assignConversation(
  conversation: Conversation,
  assignee: { uid: string; name: string } | null,
  by: { uid: string; name: string }
): Promise<void> {
  await updateDoc(doc(db, CONVERSATIONS_COL, conversation.id), {
    assignedTo: assignee?.uid || null,
    assignedToName: assignee?.name || null,
    updatedAt: new Date().toISOString(),
  });
  if (conversation.leadId) {
    await addDoc(collection(db, ACTIVITIES_COL), {
      leadId: conversation.leadId,
      userId: by.uid,
      userName: by.name,
      type: 'lead_updated',
      description: assignee
        ? `Conversa de WhatsApp transferida para ${assignee.name}`
        : 'Conversa de WhatsApp liberada (sem responsável)',
      timestamp: new Date().toISOString(),
    });
  }
}

export async function setConversationStatus(conversationId: string, status: Conversation['status']): Promise<void> {
  await updateDoc(doc(db, CONVERSATIONS_COL, conversationId), { status, updatedAt: new Date().toISOString() });
}

// --- NÚMEROS DE WHATSAPP (instâncias) ---

export function subscribeInstances(onUpdate: (instances: WhatsAppInstance[]) => void) {
  return onSnapshot(
    collection(db, 'whatsapp_instances'),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as WhatsAppInstance);
      list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      onUpdate(list);
    },
    (err) => {
      console.error('Erro ao carregar números de WhatsApp:', err);
      onUpdate([]);
    }
  );
}

export const instanceApi = {
  create: (label: string, ownerId?: string | null) =>
    apiFetch<WhatsAppInstance>('/api/whatsapp/instances', { body: { label, ownerId } }),
  importExisting: (instanceName: string, label: string, ownerId?: string | null) =>
    apiFetch<WhatsAppInstance>('/api/whatsapp/instances/import', { body: { instanceName, label, ownerId } }),
  update: (id: string, updates: { label?: string; ownerId?: string | null }) =>
    apiFetch(`/api/whatsapp/instances/${encodeURIComponent(id)}`, { method: 'PATCH', body: updates }),
  qrcode: (id: string) =>
    apiFetch<{ qrCodeBase64?: string; pairingCode?: string; state: string }>(
      `/api/whatsapp/instances/${encodeURIComponent(id)}/qrcode`,
      { method: 'POST' }
    ),
  refresh: (id: string) => apiFetch(`/api/whatsapp/instances/${encodeURIComponent(id)}/refresh`, { method: 'POST' }),
  reapplyWebhook: (id: string) =>
    apiFetch(`/api/whatsapp/instances/${encodeURIComponent(id)}/webhook`, { method: 'POST' }),
  logout: (id: string) => apiFetch(`/api/whatsapp/instances/${encodeURIComponent(id)}/logout`, { method: 'POST' }),
  remove: (id: string, force = false) =>
    apiFetch(`/api/whatsapp/instances/${encodeURIComponent(id)}${force ? '?force=1' : ''}`, { method: 'DELETE' }),
};

// --- EQUIPE ---

export function subscribeUsers(onUpdate: (users: UserProfile[]) => void) {
  return onSnapshot(
    collection(db, 'users'),
    (snap) => {
      const list = snap.docs.map((d) => d.data() as UserProfile);
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      onUpdate(list);
    },
    () => onUpdate([])
  );
}

export async function updateUserAccess(
  uid: string,
  updates: { active?: boolean; role?: UserRole },
  by: { uid: string }
): Promise<void> {
  const data: Record<string, any> = { ...updates };
  if (updates.active !== undefined) {
    // registra a decisão (aprovar, recusar ou bloquear) para tirar a conta da fila de pendentes
    data.approvedBy = by.uid;
    data.approvedAt = new Date().toISOString();
  }
  await updateDoc(doc(db, 'users', uid), data);
}

// --- RESPOSTAS RÁPIDAS ---

export function subscribeQuickReplies(onUpdate: (replies: QuickReply[]) => void) {
  return onSnapshot(
    collection(db, 'quick_replies'),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as QuickReply);
      list.sort((a, b) => a.title.localeCompare(b.title));
      onUpdate(list);
    },
    () => onUpdate([])
  );
}

export async function createQuickReply(title: string, body: string, user: { uid: string; name: string }) {
  await addDoc(collection(db, 'quick_replies'), {
    title: title.trim().slice(0, 60),
    body: body.trim().slice(0, 2000),
    createdBy: user.uid,
    createdByName: user.name,
    createdAt: new Date().toISOString(),
  });
}

export async function deleteQuickReply(id: string) {
  await deleteDoc(doc(db, 'quick_replies', id));
}

// --- DADOS DE DEMONSTRAÇÃO ---

export async function seedDemoData(user: { uid: string; name: string }): Promise<void> {
  const stages = await ensureDefaultStagesExist();
  const stageMap = new Map(stages.map((s) => [s.order, s.id]));

  const now = new Date();
  const isoAgo = (days: number, hours = 0) => {
    const d = new Date(now.getTime() - (days * 24 + hours) * 60 * 60 * 1000);
    return d.toISOString();
  };
  const isoFuture = (days: number, hours = 0) => {
    const d = new Date(now.getTime() + (days * 24 + hours) * 60 * 60 * 1000);
    return d.toISOString();
  };

  const demoLeads = [
    {
      name: 'Mariana Duarte',
      phone: '+5511987654321',
      email: 'mariana.duarte@nexuscorp.com.br',
      company: 'Nexus Corp Logística',
      source: 'Google Ads',
      stageId: stageMap.get(1) || stages[0].id,
      ownerId: user.uid,
      ownerName: user.name,
      value: 18500,
      notes: 'Interessada no plano empresarial com integração ERP.',
      tags: ['Enterprise', 'Prioridade Alta'],
      consentMessaging: true,
      consentSource: 'Formulário Landing Page',
      consentDate: isoAgo(2),
      createdAt: isoAgo(2),
      updatedAt: isoAgo(2),
    },
    {
      name: 'Rodrigo Santoro',
      phone: '+5511976543210',
      email: 'rodrigo@santorotech.com',
      company: 'Santoro Tech Solutions',
      source: 'WhatsApp Direto',
      stageId: stageMap.get(2) || stages[1].id,
      ownerId: user.uid,
      ownerName: user.name,
      value: 9200,
      notes: 'Enviada mensagem no WhatsApp para agendamento de call inicial.',
      tags: ['Inbound', 'PME'],
      consentMessaging: true,
      consentSource: 'Conversa WhatsApp',
      consentDate: isoAgo(3),
      lastContactAt: isoAgo(1, 2),
      nextFollowUpAt: isoFuture(1, 4),
      createdAt: isoAgo(3),
      updatedAt: isoAgo(1),
    },
    {
      name: 'Camila Fernandes',
      phone: '+5521998877665',
      email: 'camila@grupofernandes.com.br',
      company: 'Grupo Fernandes Alimentos',
      source: 'Indicação',
      stageId: stageMap.get(3) || stages[2].id,
      ownerId: user.uid,
      ownerName: user.name,
      value: 34000,
      notes: 'Reunião de alinhamento com a diretoria comercial realizada.',
      tags: ['Indicação VIP', 'Contrato Anual'],
      consentMessaging: true,
      consentSource: 'Indicação Comercial',
      consentDate: isoAgo(7),
      lastContactAt: isoAgo(0, 3),
      nextFollowUpAt: isoFuture(2),
      createdAt: isoAgo(7),
      updatedAt: isoAgo(0, 3),
    },
    {
      name: 'Felipe Albuquerque',
      phone: '+5531988112233',
      email: 'felipe@albuquerque.adv.br',
      company: 'Albuquerque Advocacia',
      source: 'Site Institucional',
      stageId: stageMap.get(4) || stages[3].id,
      ownerId: user.uid,
      ownerName: user.name,
      value: 12000,
      notes: 'Qualificado com orçamento disponível. Precisa de 8 licenças de atendimento.',
      tags: ['Jurídico', 'Qualificado'],
      consentMessaging: true,
      consentSource: 'Site',
      consentDate: isoAgo(10),
      lastContactAt: isoAgo(2),
      nextFollowUpAt: isoFuture(1),
      createdAt: isoAgo(10),
      updatedAt: isoAgo(2),
    },
    {
      name: 'Beatriz Lima',
      phone: '+5541991234567',
      email: 'beatriz.lima@climasaude.com.br',
      company: 'Clínica Clima Saúde',
      source: 'Instagram',
      stageId: stageMap.get(5) || stages[4].id,
      ownerId: user.uid,
      ownerName: user.name,
      value: 26500,
      notes: 'Proposta comercial enviada em PDF. Aguardando validação do setor financeiro.',
      tags: ['Saúde', 'Proposta Enviada'],
      consentMessaging: true,
      consentSource: 'Instagram Direct',
      consentDate: isoAgo(14),
      lastContactAt: isoAgo(1),
      nextFollowUpAt: isoFuture(3),
      createdAt: isoAgo(14),
      updatedAt: isoAgo(1),
    },
    {
      name: 'Eduardo Castro',
      phone: '+5551982345678',
      email: 'eduardo@castroimoveis.com.br',
      company: 'Castro Imóveis e Incorporações',
      source: 'Evento Comercial',
      stageId: stageMap.get(6) || stages[5].id,
      ownerId: user.uid,
      ownerName: user.name,
      value: 48000,
      notes: 'Ajuste de cláusulas contratuais de SLA. Fechamento previsto para o fim do mês.',
      tags: ['Imobiliário', 'Negociação Final'],
      consentMessaging: true,
      consentSource: 'Evento Expo Vendas',
      consentDate: isoAgo(20),
      lastContactAt: isoAgo(0, 5),
      nextFollowUpAt: isoFuture(1),
      createdAt: isoAgo(20),
      updatedAt: isoAgo(0, 5),
    },
    {
      name: 'Larissa Vasconcelos',
      phone: '+5571993456789',
      email: 'larissa@vasconcelosdist.com.br',
      company: 'Vasconcelos Distribuidora',
      source: 'Google Ads',
      stageId: stageMap.get(7) || stages[6].id,
      ownerId: user.uid,
      ownerName: user.name,
      value: 52000,
      notes: 'Contrato assinado! Pagamento efetuado e onboard agendado.',
      tags: ['Ganho', 'Cliente Ativo'],
      consentMessaging: true,
      consentSource: 'Google Ads',
      consentDate: isoAgo(30),
      lastContactAt: isoAgo(4),
      createdAt: isoAgo(30),
      updatedAt: isoAgo(4),
    },
    {
      name: 'Otávio Mendonça',
      phone: '+5585987123456',
      email: 'otavio@mendoncaauto.com.br',
      company: 'Mendonça Autopeças',
      source: 'LinkedIn',
      stageId: stageMap.get(8) || stages[7].id,
      ownerId: user.uid,
      ownerName: user.name,
      value: 7500,
      notes: 'Optou por adiar a compra devido a corte de orçamento temporário.',
      tags: ['Perdido', 'Recontatar Q3'],
      consentMessaging: true,
      consentSource: 'LinkedIn InMail',
      consentDate: isoAgo(25),
      lastContactAt: isoAgo(10),
      createdAt: isoAgo(25),
      updatedAt: isoAgo(10),
    },
  ];

  for (const leadData of demoLeads) {
    const leadRef = doc(collection(db, LEADS_COL));
    await setDoc(leadRef, leadData);

    // Cria atividade
    await addDoc(collection(db, ACTIVITIES_COL), {
      leadId: leadRef.id,
      userId: user.uid,
      userName: user.name,
      type: 'lead_created',
      description: `Lead demonstrativo cadastrado (${leadData.name})`,
      timestamp: leadData.createdAt,
    });

    // Cria tarefas vinculadas
    if (leadData.nextFollowUpAt) {
      await addDoc(collection(db, TASKS_COL), {
        leadId: leadRef.id,
        leadName: leadData.name,
        title: `Follow-up comercial com ${leadData.name}`,
        description: leadData.notes,
        dueDate: leadData.nextFollowUpAt,
        assignedTo: user.uid,
        assignedToName: user.name,
        completed: false,
        createdAt: leadData.createdAt,
      });
    }

    // Cria conversa de exemplo para Mariane e Rodrigo
    if (leadData.name === 'Rodrigo Santoro' || leadData.name === 'Mariana Duarte') {
      const convRef = doc(db, CONVERSATIONS_COL, conversationIdFor('demo', leadData.phone));
      const convData: Omit<Conversation, 'id'> = {
        instanceId: 'demo',
        instanceLabel: 'Demonstração',
        assignedToName: user.name,
        phone: leadData.phone,
        contactName: leadData.name,
        leadId: leadRef.id,
        lastMessage: leadData.name === 'Rodrigo Santoro' ? 'Olá! Gostaria de entender os planos para 5 atendentes.' : 'Recebi o contato de vocês, podemos conversar hoje?',
        lastMessageAt: leadData.lastContactAt || leadData.createdAt,
        unreadCount: leadData.name === 'Rodrigo Santoro' ? 1 : 0,
        assignedTo: user.uid,
        status: 'open',
        updatedAt: leadData.lastContactAt || leadData.createdAt,
      };
      await setDoc(convRef, convData);

      // Adiciona mensagem
      await addDoc(collection(db, CONVERSATIONS_COL, convRef.id, 'messages'), {
        conversationId: convRef.id,
        leadId: leadRef.id,
        sender: 'contact',
        fromMe: false,
        body: convData.lastMessage,
        status: 'delivered',
        mediaType: 'text',
        timestamp: convData.lastMessageAt,
      });
    }
  }
}

/** Apaga em lotes de até 400 (o Firestore aceita no máximo 500 operações por lote). */
async function deleteInChunks(refs: { path: string }[]): Promise<void> {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach((r: any) => batch.delete(r));
    await batch.commit();
  }
}

export async function clearAllDemoData(): Promise<void> {
  const convs = await getDocs(collection(db, CONVERSATIONS_COL));
  for (const c of convs.docs) {
    const msgs = await getDocs(collection(db, CONVERSATIONS_COL, c.id, 'messages'));
    await deleteInChunks(msgs.docs.map((d) => d.ref));
  }
  for (const colName of [LEADS_COL, TASKS_COL, ACTIVITIES_COL, CONVERSATIONS_COL, MESSAGES_COL]) {
    const snap = await getDocs(collection(db, colName));
    await deleteInChunks(snap.docs.map((d) => d.ref));
  }
}
