export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: 'admin' | 'sales_rep' | 'manager';
  avatarUrl?: string;
  createdAt: string;
}

export interface PipelineStage {
  id: string;
  name: string;
  order: number;
  color: string;
  isWon?: boolean;
  isLost?: boolean;
}

export interface Lead {
  id: string;
  name: string;
  phone: string; // Formato E.164 (ex: +5511999999999)
  email?: string;
  company?: string;
  source: string; // Indicação, Google Ads, Instagram, Site, WhatsApp, Evento, etc.
  stageId: string;
  ownerId: string;
  ownerName: string;
  value: number; // Valor estimado em BRL
  notes?: string;
  tags: string[];
  consentMessaging: boolean;
  consentSource?: string;
  consentDate?: string;
  lastContactAt?: string;
  nextFollowUpAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  leadId: string;
  leadName: string;
  title: string;
  description?: string;
  dueDate: string; // ISO String
  assignedTo: string;
  assignedToName: string;
  completed: boolean;
  completedAt?: string;
  createdAt: string;
}

export interface Activity {
  id: string;
  leadId: string;
  userId: string;
  userName: string;
  type: 'stage_change' | 'note_added' | 'task_created' | 'task_completed' | 'whatsapp_sent' | 'whatsapp_received' | 'lead_created' | 'lead_updated';
  description: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

export interface Conversation {
  id: string; // usually phone or remoteJid sanitized
  phone: string;
  contactName: string;
  leadId?: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
  assignedTo?: string;
  status: 'open' | 'closed' | 'archived';
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  leadId?: string;
  externalId?: string;
  sender: 'user' | 'contact' | 'system';
  fromMe: boolean;
  body: string;
  status: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  mediaType: 'text' | 'image' | 'audio' | 'document';
  mediaUrl?: string;
  timestamp: string;
}

export interface EvolutionConfigStatus {
  isConfigured: boolean;
  apiUrl?: string;
  instanceName?: string;
  webhookUrl?: string;
  hasWebhookSecret: boolean;
}

export interface WhatsAppConnectionState {
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  instanceName?: string;
  connectedPhone?: string;
  profilePicUrl?: string;
  qrCodeBase64?: string;
  lastConnectedAt?: string;
  errorMessage?: string;
  updatedAt: string;
}

export const DEFAULT_PIPELINE_STAGES: Omit<PipelineStage, 'id'>[] = [
  { name: 'Novo lead', order: 1, color: '#3b82f6' },
  { name: 'Tentativa de contato', order: 2, color: '#6366f1' },
  { name: 'Em atendimento', order: 3, color: '#8b5cf6' },
  { name: 'Qualificado', order: 4, color: '#06b6d4' },
  { name: 'Proposta enviada', order: 5, color: '#eab308' },
  { name: 'Negociação', order: 6, color: '#f97316' },
  { name: 'Ganho', order: 7, color: '#10b981', isWon: true },
  { name: 'Perdido', order: 8, color: '#ef4444', isLost: true },
];

export const LEAD_SOURCES = [
  'Indicação',
  'WhatsApp Direto',
  'Instagram',
  'Google Ads',
  'Site Institucional',
  'LinkedIn',
  'Evento Comercial',
  'Outros',
];
