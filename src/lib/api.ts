import { auth } from './firebase.ts';

/**
 * Chamada autenticada à API do CRM: envia o token de login do Firebase,
 * que o servidor valida antes de qualquer ação no WhatsApp.
 */
export async function apiFetch<T = any>(
  path: string,
  options: { method?: string; body?: any } = {}
): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Sessão encerrada. Entre novamente.');
  const token = await user.getIdToken();
  let res: Response;
  try {
    res = await fetch(path, {
      method: options.method || (options.body ? 'POST' : 'GET'),
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error('Sem conexão com o servidor do CRM. Verifique sua internet.');
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err: any = new Error(data?.error || `Erro ${res.status} no servidor.`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data as T;
}
