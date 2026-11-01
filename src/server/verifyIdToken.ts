/**
 * Verificação do ID token do Firebase Authentication sem firebase-admin/auth.
 *
 * Segue o procedimento oficial ("Verify ID tokens using a third-party JWT library"):
 *  - algoritmo RS256 e `kid` presente nos certificados públicos do Google
 *  - assinatura válida
 *  - aud = Project ID; iss = https://securetoken.google.com/<Project ID>
 *  - exp no futuro, iat e auth_time no passado, sub não vazio
 * Os certificados são públicos (não é segredo) e ficam em cache pelo tempo que o Google indicar.
 */

import crypto from 'crypto';

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const CLOCK_SKEW_S = 300;

let certCache: { certs: Record<string, string>; expiresAt: number } | null = null;

async function getCerts(): Promise<Record<string, string>> {
  if (certCache && certCache.expiresAt > Date.now()) return certCache.certs;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error(`Não foi possível obter os certificados públicos do Firebase (${res.status}).`);
  const certs = (await res.json()) as Record<string, string>;
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') || '')?.[1] || 3600);
  certCache = { certs, expiresAt: Date.now() + Math.min(maxAge, 6 * 3600) * 1000 };
  return certs;
}

function b64urlJson(part: string): any {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

export interface DecodedIdToken {
  uid: string;
  email?: string;
  [key: string]: any;
}

export async function verifyFirebaseIdToken(token: string, projectId: string): Promise<DecodedIdToken> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Token malformado.');
  const header = b64urlJson(parts[0]);
  const payload = b64urlJson(parts[1]);

  if (header.alg !== 'RS256') throw new Error('Algoritmo inválido.');
  let certs = await getCerts();
  if (!header.kid || !certs[header.kid]) {
    certCache = null; // chaves podem ter girado
    certs = await getCerts();
    if (!certs[header.kid]) throw new Error('Chave de assinatura desconhecida.');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
  if (!verifier.verify(certs[header.kid], Buffer.from(parts[2], 'base64url'))) {
    throw new Error('Assinatura inválida.');
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) throw new Error('Audience inválido.');
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) throw new Error('Issuer inválido.');
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128) throw new Error('Subject inválido.');
  if (typeof payload.exp !== 'number' || payload.exp <= now - CLOCK_SKEW_S) throw new Error('Token expirado.');
  if (typeof payload.iat !== 'number' || payload.iat > now + CLOCK_SKEW_S) throw new Error('Token emitido no futuro.');
  if (payload.auth_time && payload.auth_time > now + CLOCK_SKEW_S) throw new Error('auth_time inválido.');

  return { ...payload, uid: payload.sub };
}
