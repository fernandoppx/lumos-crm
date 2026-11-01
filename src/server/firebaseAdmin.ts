/**
 * Acesso do backend ao Firebase (Firestore, Auth e Storage).
 *
 * Modo recomendado em produção: Workload Identity Federation (sem chave JSON).
 *   A Vercel Function obtém um token OIDC de curta duração da Vercel, troca esse token
 *   no Google STS e personifica a conta de serviço lumos-crm-backend. Nenhuma chave
 *   permanente é gerada ou armazenada.
 *   Variáveis: GCP_PROJECT_NUMBER, GCP_WORKLOAD_IDENTITY_POOL_ID,
 *              GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID, GCP_SERVICE_ACCOUNT_EMAIL
 *
 * Alternativas (mantidas para desenvolvimento local):
 *   - FIREBASE_SERVICE_ACCOUNT_KEY (JSON) — não usar em produção
 *   - Application Default Credentials / emulador
 */

import { initializeApp, getApps, cert, applicationDefault, App } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { ExternalAccountClient } from 'google-auth-library';
import { getVercelOidcToken } from '@vercel/oidc';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

export const CRM_PROJECT_ID = process.env.FIREBASE_PROJECT_ID?.trim() || firebaseConfig.projectId;
export const CRM_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID?.trim() || firebaseConfig.firestoreDatabaseId;
export const CRM_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET?.trim() || firebaseConfig.storageBucket;

export type CredentialMode = 'workload_identity' | 'service_account_key' | 'application_default' | 'none';

function wifEnv() {
  const projectNumber = process.env.GCP_PROJECT_NUMBER?.trim() || '';
  const poolId = process.env.GCP_WORKLOAD_IDENTITY_POOL_ID?.trim() || '';
  const providerId = process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID?.trim() || '';
  const serviceAccount = process.env.GCP_SERVICE_ACCOUNT_EMAIL?.trim() || '';
  return {
    projectNumber,
    poolId,
    providerId,
    serviceAccount,
    complete: Boolean(projectNumber && poolId && providerId && serviceAccount),
  };
}

export function getCredentialMode(): CredentialMode {
  if (wifEnv().complete) return 'workload_identity';
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim()) return 'service_account_key';
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIRESTORE_EMULATOR_HOST) return 'application_default';
  return 'none';
}

/** Mantido por compatibilidade com o restante do código. */
export function hasServiceAccount(): boolean {
  return getCredentialMode() !== 'none';
}

// ---------------------------------------------------------------------------
// Workload Identity Federation
// ---------------------------------------------------------------------------

let wifClient: ExternalAccountClient | null = null;

function getWifClient(): ExternalAccountClient {
  if (wifClient) return wifClient;
  const env = wifEnv();
  const client = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience: `//iam.googleapis.com/projects/${env.projectNumber}/locations/global/workloadIdentityPools/${env.poolId}/providers/${env.providerId}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${env.serviceAccount}:generateAccessToken`,
    // Token de acesso da conta de serviço válido por no máximo 1 hora
    service_account_impersonation: { token_lifetime_seconds: 3600 },
    subject_token_supplier: {
      // O token OIDC só existe dentro de uma requisição (cabeçalho x-vercel-oidc-token).
      // É lido de novo a cada troca e nunca é guardado nem registrado em log.
      getSubjectToken: () => getVercelOidcToken(),
    },
  });
  if (!client) throw new Error('Configuração de Workload Identity inválida.');
  client.scopes = ['https://www.googleapis.com/auth/cloud-platform'];
  wifClient = client;
  return client;
}

/** Credencial no formato que o firebase-admin espera, baseada no cliente federado. */
function wifCredential() {
  return {
    async getAccessToken() {
      const client = getWifClient();
      const { token } = await client.getAccessToken();
      if (!token) throw new Error('O Google não devolveu um token de acesso.');
      const expiry = client.credentials?.expiry_date;
      const expires_in = expiry ? Math.max(60, Math.floor((expiry - Date.now()) / 1000)) : 3000;
      return { access_token: token, expires_in };
    },
  };
}

/** Token de acesso de curta duração da conta de serviço (para chamadas REST). Nunca registrar em log. */
export async function getServiceAccessToken(): Promise<string> {
  const mode = getCredentialMode();
  if (mode === 'workload_identity') {
    const { token } = await getWifClient().getAccessToken();
    if (!token) throw new Error('O Google não devolveu um token de acesso.');
    return token;
  }
  const app = getApp();
  const t = await (app.options.credential as any).getAccessToken();
  return t.access_token;
}

/** Claims não sensíveis do token OIDC atual (para diagnóstico). Nunca devolve o token. */
export async function describeVercelIdentity(): Promise<Record<string, string> | null> {
  try {
    const token = await getVercelOidcToken();
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return {
      iss: String(payload.iss || ''),
      aud: String(payload.aud || ''),
      owner: String(payload.owner || ''),
      owner_id: String(payload.owner_id || ''),
      project: String(payload.project || ''),
      project_id: String(payload.project_id || ''),
      environment: String(payload.environment || ''),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// App, Firestore, Auth, Storage
// ---------------------------------------------------------------------------

let adminApp: App | null = null;
let adminDbInstance: Firestore | null = null;

function getApp(): App {
  if (adminApp) return adminApp;
  const existing = getApps();
  if (existing.length) {
    adminApp = existing[0];
    return adminApp;
  }
  const mode = getCredentialMode();
  const base = { projectId: CRM_PROJECT_ID, storageBucket: CRM_STORAGE_BUCKET };

  if (mode === 'workload_identity') {
    adminApp = initializeApp({ ...base, credential: wifCredential() as any });
  } else if (mode === 'service_account_key') {
    let credentialObj: any;
    try {
      credentialObj = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY!.trim());
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY contém JSON inválido.');
    }
    if (typeof credentialObj.private_key === 'string') {
      credentialObj.private_key = credentialObj.private_key.replace(/\\n/g, '\n');
    }
    adminApp = initializeApp({ ...base, credential: cert(credentialObj) });
  } else {
    adminApp = initializeApp({ ...base, credential: applicationDefault() });
  }
  return adminApp;
}

export function getAdminFirestore(): { db: Firestore | null; error: string | null } {
  if (adminDbInstance) return { db: adminDbInstance, error: null };
  const mode = getCredentialMode();
  if (mode === 'none') {
    return {
      db: null,
      error:
        'Servidor sem acesso ao banco: configure as variáveis GCP_* do Workload Identity Federation na Vercel.',
    };
  }
  try {
    if (mode === 'workload_identity') {
      // O firebase-admin só aceita chave JSON ou ADC no Firestore; com credencial federada
      // criamos o cliente diretamente, passando o cliente de autenticação.
      adminDbInstance = new Firestore({
        projectId: CRM_PROJECT_ID,
        databaseId: CRM_DATABASE_ID,
        authClient: getWifClient(),
        preferRest: true,
      } as any);
    } else {
      adminDbInstance = getFirestore(getApp(), CRM_DATABASE_ID);
    }
    return { db: adminDbInstance, error: null };
  } catch (err: any) {
    const msg = err?.message || 'Erro desconhecido ao inicializar o Firestore.';
    console.warn('[FirebaseAdmin] Falha ao inicializar o Firestore:', msg);
    return { db: null, error: msg };
  }
}

/** A verificação do login (ID token) usa só as chaves públicas do Google e o Project ID. */
export function getAdminAuth(): Auth {
  return getAuth(getApp());
}

/** Grava um arquivo no Firebase Storage e devolve o caminho e o bucket. */
export async function uploadToStorage(path: string, buffer: Buffer, contentType: string, metadata: Record<string, string>) {
  if (getCredentialMode() !== 'workload_identity') {
    const bucket = getStorage(getApp()).bucket(CRM_STORAGE_BUCKET);
    await bucket.file(path).save(buffer, { resumable: false, metadata: { contentType, metadata } });
    return { bucket: bucket.name };
  }

  // Com credencial federada usamos a API JSON do Cloud Storage (upload multipart).
  const token = await getServiceAccessToken();
  const boundary = `lumos${Date.now().toString(36)}`;
  const meta = JSON.stringify({ name: path, contentType, metadata });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(CRM_STORAGE_BUCKET)}/o?uploadType=multipart`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }
  );
  if (!res.ok) {
    throw new Error(`Falha ao gravar arquivo no Storage (${res.status}).`);
  }
  return { bucket: CRM_STORAGE_BUCKET };
}

export { FieldValue };
