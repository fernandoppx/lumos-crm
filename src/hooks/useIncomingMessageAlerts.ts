import { useEffect, useRef } from 'react';
import { Conversation } from '../types/crm.ts';

const SOUND_KEY = 'lumos.alerts.sound';

export function isAlertSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAlertSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    /* sem armazenamento local */
  }
}

let audioCtx: AudioContext | null = null;

/** Bip curto gerado no navegador (sem arquivo de áudio). */
export function playAlertSound() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    const ctx = audioCtx;
    const now = ctx.currentTime;
    [0, 0.14].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === 0 ? 880 : 1175;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.15, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.13);
    });
  } catch {
    /* navegador bloqueou o áudio */
  }
}

/**
 * Avisa (som + notificação do navegador + contador na aba) quando chega mensagem nova
 * em uma conversa do usuário ou sem responsável.
 */
export function useIncomingMessageAlerts(opts: {
  conversations: Conversation[];
  userId: string | null;
  viewingConversationId: string | null;
  onOpen: (conversationId: string) => void;
}) {
  const { conversations, userId, viewingConversationId, onOpen } = opts;
  const lastSeen = useRef<Map<string, string> | null>(null);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (!userId) return;
    const relevant = conversations.filter((c) => !c.assignedTo || c.assignedTo === userId);

    // Contador no título da aba
    const unread = relevant.reduce((acc, c) => acc + (c.unreadCount || 0), 0);
    document.title = unread > 0 ? `(${unread}) LUMOS CRM` : 'LUMOS CRM';

    // Primeira carga: só memoriza o estado
    if (!lastSeen.current) {
      lastSeen.current = new Map(conversations.map((c) => [c.id, c.lastMessageAt]));
      return;
    }

    const fresh = relevant.filter((c) => {
      const prev = lastSeen.current!.get(c.id);
      return !c.lastMessageFromMe && (c.unreadCount || 0) > 0 && (!prev || c.lastMessageAt > prev);
    });
    lastSeen.current = new Map(conversations.map((c) => [c.id, c.lastMessageAt]));

    const toAlert = fresh.filter((c) => !(c.id === viewingConversationId && document.visibilityState === 'visible'));
    if (toAlert.length === 0) return;

    if (isAlertSoundEnabled()) playAlertSound();

    if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      const c = toAlert[0];
      try {
        const n = new Notification(`${c.contactName}${c.instanceLabel ? ` · ${c.instanceLabel}` : ''}`, {
          body: c.lastMessage?.slice(0, 120) || 'Nova mensagem',
          tag: c.id,
        });
        n.onclick = () => {
          window.focus();
          onOpenRef.current(c.id);
          n.close();
        };
      } catch {
        /* alguns navegadores móveis não suportam new Notification */
      }
    }
  }, [conversations, userId, viewingConversationId]);
}
