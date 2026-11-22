/**
 * Déclarations minimales pour gamedig v5 (publié sans types).
 * Source de vérité : node_modules/gamedig/lib (results/QueryResults).
 */
declare module 'gamedig' {
  export interface QueryOptions {
    type: string;
    host: string;
    port?: number;
    socketTimeout?: number;
    attemptTimeout?: number;
    maxAttempts?: number;
    givenPortOnly?: boolean;
    ipFamily?: number;
  }

  export interface Player {
    name?: string;
    ping?: number;
    [key: string]: unknown;
  }

  export interface QueryResult {
    name?: string;
    map?: string;
    password?: boolean;
    maxplayers?: number;
    players?: Player[];
    bots?: Player[];
    ping?: number;
    raw?: Record<string, unknown>;
    connect?: string;
  }

  export class GameDig {
    query(options: QueryOptions): Promise<QueryResult>;
  }

  export const games: Record<string, { name?: string; options?: Record<string, unknown>; release_year?: number }>;
}
