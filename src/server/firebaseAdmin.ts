/**
 * Inicialização do Firebase Admin SDK no backend.
 *
 * Em produção (Vercel) é obrigatório definir FIREBASE_SERVICE_ACCOUNT_KEY com o JSON
 * da conta de serviço do projeto Firebase. Sem ela, a verificação de login funciona,
 * mas o servidor não consegue gravar mensagens recebidas pelo WhatsApp.
 */

import { initializeApp, getApps, cert, applicationDefault, App } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth, Auth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

let adminApp: App | null = null;
let adminDbInstance: Firestore | null = null;
let initError: string | null = null;

export const CRM_PROJECT_ID = process.env.FIREBASE_PROJECT_ID?.trim() || firebaseConfig.projectId;
export const CRM_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID?.trim() || firebaseConfig.firestoreDatabaseId;
export const CRM_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET?.trim() || firebaseConfig.storageBucket;

export function hasServiceAccount(): boolean {
  return Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim() || process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

function getApp(): App {
  if (adminApp) return adminApp;
  const existing = getApps();
  if (existing.length) {
    adminApp = existing[0];
    return adminApp;
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (raw) {
    let credentialObj: any;
    try {
      credentialObj = JSON.parse(raw);
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY contém JSON inválido.');
    }
    if (typeof credentialObj.private_key === 'string') {
      credentialObj.private_key = credentialObj.private_key.replace(/\\n/g, '\n');
    }
    adminApp = initializeApp({
      credential: cert(credentialObj),
      projectId: CRM_PROJECT_ID,
      storageBucket: CRM_STORAGE_BUCKET,
    });
  } else {
    adminApp = initializeApp({
      credential: applicationDefault(),
      projectId: CRM_PROJECT_ID,
      storageBucket: CRM_STORAGE_BUCKET,
    });
  }
  return adminApp;
}

export function getAdminFirestore(): { db: Firestore | null; error: string | null } {
  if (adminDbInstance) return { db: adminDbInstance, error: null };
  if (process.env.FIRESTORE_EMULATOR_HOST === undefined && !hasServiceAccount()) {
    return {
      db: null,
      error:
        'Servidor sem acesso ao banco: configure FIREBASE_SERVICE_ACCOUNT_KEY nas variáveis de ambiente da Vercel.',
    };
  }
  try {
    adminDbInstance = getFirestore(getApp(), CRM_DATABASE_ID);
    initError = null;
    return { db: adminDbInstance, error: null };
  } catch (err: any) {
    initError = err.message || 'Erro desconhecido ao inicializar Firebase Admin SDK.';
    console.warn('[FirebaseAdmin Init Warning]:', initError);
    return { db: null, error: initError };
  }
}

/** A verificação do token de login só precisa do Project ID, não da conta de serviço. */
export function getAdminAuth(): Auth {
  return getAuth(getApp());
}

export function getAdminBucket() {
  return getStorage(getApp()).bucket(CRM_STORAGE_BUCKET);
}

export { FieldValue };
