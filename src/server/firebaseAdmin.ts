/**
 * Inicialização segura do Firebase Admin SDK para o backend do Lumus CRM.
 * 
 * Prioriza Application Default Credentials (ADC) em ambientes Google Cloud Run autorizados
 * ou chave de conta de serviço via variável de ambiente FIREBASE_SERVICE_ACCOUNT_KEY.
 * 
 * IMPORTANTE:
 * - Não expõe chaves ou credenciais no frontend.
 * - Conecta-se especificamente ao Project ID e Firestore Database ID do Lumus CRM.
 */

import { initializeApp, getApps, cert, applicationDefault, App } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldValue } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };

let adminApp: App | null = null;
let adminDbInstance: Firestore | null = null;
let initError: string | null = null;

export const CRM_PROJECT_ID = process.env.FIREBASE_PROJECT_ID?.trim() || firebaseConfig.projectId;
export const CRM_DATABASE_ID = process.env.FIRESTORE_DATABASE_ID?.trim() || firebaseConfig.firestoreDatabaseId;

export function getAdminFirestore(): { db: Firestore | null; error: string | null } {
  if (adminDbInstance) {
    return { db: adminDbInstance, error: null };
  }

  try {
    const existingApps = getApps();
    if (!existingApps.length) {
      const serviceAccountKeyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();

      if (serviceAccountKeyJson) {
        let credentialObj: any;
        try {
          credentialObj = JSON.parse(serviceAccountKeyJson);
        } catch {
          throw new Error('Variável FIREBASE_SERVICE_ACCOUNT_KEY contém JSON inválido.');
        }

        adminApp = initializeApp({
          credential: cert(credentialObj),
          projectId: CRM_PROJECT_ID,
        });
      } else {
        // Tenta Application Default Credentials (ADC)
        adminApp = initializeApp({
          credential: applicationDefault(),
          projectId: CRM_PROJECT_ID,
        });
      }
    } else {
      adminApp = existingApps[0];
    }

    // Inicializa Firestore direcionado para o Database ID específico do applet
    adminDbInstance = getFirestore(adminApp, CRM_DATABASE_ID);
    initError = null;
    return { db: adminDbInstance, error: null };
  } catch (err: any) {
    initError = err.message || 'Erro desconhecido ao inicializar Firebase Admin SDK.';
    console.warn('[FirebaseAdmin Init Warning]:', initError);
    return { db: null, error: initError };
  }
}

export { FieldValue };

