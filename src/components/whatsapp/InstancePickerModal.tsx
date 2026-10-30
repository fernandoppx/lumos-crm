import React from 'react';
import { X, Smartphone } from 'lucide-react';
import { Lead, WhatsAppInstance } from '../../types/crm.ts';
import { formatPhoneDisplay } from '../../utils/formatters.ts';

interface Props {
  lead: Lead | null;
  instances: WhatsAppInstance[];
  currentUserId: string;
  onClose: () => void;
  onPick: (instance: WhatsAppInstance) => void;
}

/** Pergunta por qual número de WhatsApp iniciar a conversa com um lead. */
export const InstancePickerModal: React.FC<Props> = ({ lead, instances, currentUserId, onClose, onPick }) => {
  if (!lead) return null;
  const sorted = [...instances].sort((a, b) => {
    const score = (i: WhatsAppInstance) => (i.state === 'connected' ? 0 : 2) + (i.ownerId === currentUserId ? 0 : 1);
    return score(a) - score(b);
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl max-w-sm w-full shadow-2xl border border-slate-200"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Escolher número de WhatsApp"
      >
        <div className="flex items-start justify-between p-4 border-b border-slate-100">
          <div>
            <h4 className="text-sm font-bold text-slate-900">Conversar por qual número?</h4>
            <p className="text-xs text-slate-500 mt-0.5">
              {lead.name} · {formatPhoneDisplay(lead.phone)}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700 rounded" aria-label="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-2 max-h-80 overflow-y-auto">
          {sorted.map((inst) => {
            const connected = inst.state === 'connected';
            return (
              <button
                key={inst.id}
                onClick={() => onPick(inst)}
                className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 text-left transition-colors"
              >
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                    connected ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  <Smartphone className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-900 truncate">
                    {inst.label}
                    {inst.ownerId === currentUserId && <span className="ml-1.5 text-[10px] font-medium text-indigo-600">(seu)</span>}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {inst.phone ? formatPhoneDisplay(inst.phone) : 'Número ainda não pareado'}
                    {inst.ownerName ? ` · ${inst.ownerName}` : ''}
                  </div>
                </div>
                <span
                  className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                    connected ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : 'text-slate-500 bg-slate-50 border-slate-200'
                  }`}
                >
                  {connected ? 'Conectado' : 'Desconectado'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
