import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * SecretBox (R2) — chiffrement AES-256-GCM des clés API stockées en DB.
 * Clé dérivée : sha256(ENCRYPTION_SECRET ?? BETTER_AUTH_SECRET ?? DISCORD_TOKEN).
 * Format stocké : v1:<iv-base64>:<tag-base64>:<data-base64>.
 * Le préfixe v1: permet de détecter les valeurs non chiffrées (migration).
 */

function deriveKey(secrets: { encryption?: string; betterAuth?: string; token?: string }): Buffer {
  const source = secrets.encryption || secrets.betterAuth || secrets.token || '';
  return createHash('sha256').update(source, 'utf8').digest();
}

/** Chiffre une valeur sensible. Retourne v1:<iv>:<tag>:<data>. */
export function encryptSecret(plaintext: string, secrets: { encryption?: string; betterAuth?: string; token?: string }): string {
  const key = deriveKey(secrets);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/** Déchiffre une valeur v1:<iv>:<tag>:<data>. Retourne null si invalide. */
export function decryptSecret(ciphertext: string, secrets: { encryption?: string; betterAuth?: string; token?: string }): string | null {
  if (!ciphertext.startsWith('v1:')) {
    // Valeur héritée non chiffrée : retournée telle quelle (migration boot).
    return ciphertext;
  }
  try {
    const [, ivB64, tagB64, dataB64] = ciphertext.split(':');
    const key = deriveKey(secrets);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/** La valeur est-elle déjà chiffrée (préfixe v1:) ? */
export function isEncrypted(value: string): boolean {
  return value.startsWith('v1:');
}
