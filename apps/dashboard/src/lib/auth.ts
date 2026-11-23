import { createAuthClient } from 'better-auth/react';

/** Client better-auth : cookies inclus (même origine via le proxy Vite). */
export const authClient = createAuthClient();

export const { useSession } = authClient;
