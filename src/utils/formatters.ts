/**
 * Formata valores monetários em Real (BRL)
 */
export function formatCurrencyBRL(value: number | undefined | null): string {
  const num = typeof value === 'number' && !isNaN(value) ? value : 0;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(num);
}

/**
 * Normaliza o telefone para o padrão internacional com código do país.
 * Se nenhum código de país for informado e tiver 10 ou 11 dígitos, assume +55 (Brasil).
 */
export function normalizePhone(rawPhone: string): string {
  if (!rawPhone) return '';
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits) return '';

  if (rawPhone.startsWith('+')) {
    return `+${digits}`;
  }

  // Se tem 10 dígitos (DDD + 8 dígitos) ou 11 dígitos (DDD + 9 dígitos), adiciona DDI 55
  if (digits.length === 10 || digits.length === 11) {
    return `+55${digits}`;
  }

  // Se já tem 12 ou 13 dígitos e começa com 55
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    return `+${digits}`;
  }

  return `+${digits}`;
}

/**
 * Formata telefone para exibição amigável
 * Ex: +55 (11) 98765-4321
 */
export function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return phone || '';

  if (digits.startsWith('55') && digits.length === 13) {
    const ddd = digits.slice(2, 4);
    const part1 = digits.slice(4, 9);
    const part2 = digits.slice(9);
    return `+55 (${ddd}) ${part1}-${part2}`;
  }

  if (digits.startsWith('55') && digits.length === 12) {
    const ddd = digits.slice(2, 4);
    const part1 = digits.slice(4, 8);
    const part2 = digits.slice(8);
    return `+55 (${ddd}) ${part1}-${part2}`;
  }

  if (digits.length === 11) {
    const ddd = digits.slice(0, 2);
    const part1 = digits.slice(2, 7);
    const part2 = digits.slice(7);
    return `(${ddd}) ${part1}-${part2}`;
  }

  return phone;
}

/**
 * Formata data e hora no fuso horário America/Sao_Paulo
 */
export function formatDateTimeSP(
  dateInput: string | Date | number | undefined | null,
  options?: Intl.DateTimeFormatOptions
): string {
  if (!dateInput) return '—';
  const date = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '—';

  const defaultOptions: Intl.DateTimeFormatOptions = {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  };

  return new Intl.DateTimeFormat('pt-BR', defaultOptions).format(date);
}

/**
 * Formata apenas a data no fuso de São Paulo
 */
export function formatDateSP(dateInput: string | Date | number | undefined | null): string {
  return formatDateTimeSP(dateInput, {
    hour: undefined,
    minute: undefined,
  });
}

/**
 * Formata apenas o horário
 */
export function formatTimeSP(dateInput: string | Date | number | undefined | null): string {
  return formatDateTimeSP(dateInput, {
    day: undefined,
    month: undefined,
    year: undefined,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Exibe tempo relativo em português (ex: Há 10 minutos, Ontem às 14:00)
 */
export function formatRelativeTime(dateInput: string | Date | number | undefined | null): string {
  if (!dateInput) return '—';
  const date = typeof dateInput === 'string' || typeof dateInput === 'number' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '—';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return 'Agora';
  if (diffMinutes < 60) return `Há ${diffMinutes} min`;
  if (diffHours < 24) return `Há ${diffHours} h`;
  if (diffDays === 1) return `Ontem às ${formatTimeSP(date)}`;
  if (diffDays < 7) return `Há ${diffDays} dias`;

  return formatDateSP(date);
}

/**
 * Exporta array de leads para arquivo CSV compatível com Excel UTF-8
 */
export function exportLeadsToCSV(leads: any[]): void {
  const headers = [
    'Nome',
    'Telefone',
    'E-mail',
    'Empresa',
    'Origem',
    'Etapa',
    'Responsável',
    'Valor (BRL)',
    'Tags',
    'Consentimento Mensagens',
    'Origem Consentimento',
    'Data Consentimento',
    'Último Contato',
    'Próximo Follow-up',
    'Data Cadastro',
  ];

  const escapeCSV = (field: any) => {
    if (field === undefined || field === null) return '""';
    const str = String(field).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = leads.map((lead) => [
    escapeCSV(lead.name),
    escapeCSV(lead.phone),
    escapeCSV(lead.email || ''),
    escapeCSV(lead.company || ''),
    escapeCSV(lead.source || ''),
    escapeCSV(lead.stageName || lead.stageId || ''),
    escapeCSV(lead.ownerName || ''),
    escapeCSV(lead.value || 0),
    escapeCSV((lead.tags || []).join('; ')),
    escapeCSV(lead.consentMessaging ? 'Sim' : 'Não'),
    escapeCSV(lead.consentSource || ''),
    escapeCSV(lead.consentDate ? formatDateSP(lead.consentDate) : ''),
    escapeCSV(lead.lastContactAt ? formatDateTimeSP(lead.lastContactAt) : ''),
    escapeCSV(lead.nextFollowUpAt ? formatDateTimeSP(lead.nextFollowUpAt) : ''),
    escapeCSV(formatDateTimeSP(lead.createdAt)),
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `lumus_crm_leads_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Converte arquivo CSV de importação em lista de leads estruturados
 */
export function parseLeadsCSV(text: string): {
  leads: Array<{
    name: string;
    phone: string;
    email?: string;
    company?: string;
    source?: string;
    value?: number;
    tags?: string[];
    notes?: string;
  }>;
  errors: string[];
} {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 1) {
    return { leads: [], errors: ['O arquivo CSV está vazio ou contém apenas cabeçalhos.'] };
  }

  const delimiter = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(delimiter).map((h) => h.trim().replace(/^["']|["']$/g, '').toLowerCase());

  const nameIdx = headers.findIndex((h) => h.includes('nome') || h === 'name');
  const phoneIdx = headers.findIndex((h) => h.includes('tel') || h.includes('fone') || h.includes('whats') || h === 'phone');
  const emailIdx = headers.findIndex((h) => h.includes('mail'));
  const companyIdx = headers.findIndex((h) => h.includes('empresa') || h === 'company');
  const sourceIdx = headers.findIndex((h) => h.includes('origem') || h === 'source');
  const valueIdx = headers.findIndex((h) => h.includes('valor') || h === 'value');
  const tagsIdx = headers.findIndex((h) => h.includes('tag') || h.includes('etiqueta'));

  if (nameIdx === -1 || phoneIdx === -1) {
    return {
      leads: [],
      errors: ['O arquivo CSV deve conter colunas identificáveis de "Nome" e "Telefone".'],
    };
  }

  const parsedLeads: any[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const rawLine = lines[i];
    // Split considerando aspas
    const parts = rawLine.split(new RegExp(`${delimiter}(?=(?:(?:[^"]*"){2})*[^"]*$)`));
    const cleanCol = (idx: number) => {
      if (idx === -1 || !parts[idx]) return '';
      return parts[idx].trim().replace(/^["']|["']$/g, '').trim();
    };

    const name = cleanCol(nameIdx);
    const rawPhone = cleanCol(phoneIdx);
    const phone = normalizePhone(rawPhone);

    if (!name) {
      errors.push(`Linha ${i + 1}: Nome ausente.`);
      continue;
    }
    if (!phone || phone.length < 9) {
      errors.push(`Linha ${i + 1} (${name}): Telefone inválido "${rawPhone}".`);
      continue;
    }

    const email = cleanCol(emailIdx);
    const company = cleanCol(companyIdx);
    const source = cleanCol(sourceIdx) || 'Importação CSV';
    const valueRaw = cleanCol(valueIdx).replace(/[^\d.,]/g, '').replace(',', '.');
    const value = parseFloat(valueRaw) || 0;
    const tagsRaw = cleanCol(tagsIdx);
    const tags = tagsRaw
      ? tagsRaw.split(/[,;]/).map((t) => t.trim()).filter(Boolean)
      : ['Importado'];

    parsedLeads.push({
      name,
      phone,
      email: email || undefined,
      company: company || undefined,
      source,
      value,
      tags,
    });
  }

  return { leads: parsedLeads, errors };
}
