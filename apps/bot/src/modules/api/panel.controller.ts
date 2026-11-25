import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { HttpCtx, HttpController, HttpGet, NotFoundError } from '@spraxium/http';
import type { Context } from 'hono';
import { AppEnv } from '../../app.env';
import { cspOf } from './api-policy.middleware';

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/** Racines que le bot sert lui-même : tout sauf l'API, le login et la sonde. */
const RESERVED: readonly string[] = ['/api', '/healthz'];

/**
 * Panel web en production : quand `DASHBOARD_DIST_DIR` est réglé, le bot sert
 * le panel compilé (`apps/dashboard/dist`) sur son propre serveur HTTP. Même
 * origine pour le panel et l'API : la session tient sans cross-site.
 *
 * - un fichier existant est servi tel quel ; ceux de `/assets/` portent un
 *   empreinte dans leur nom et se cachent un an ;
 * - tout autre chemin rend `index.html` (le routeur du panel lit l'adresse),
 *   sans cache : une nouvelle version est vue dès qu'elle est servie ;
 * - la page reçoit la CSP des pages (`cspOf` : une CSP à `default-src 'none'`
 *   lui interdirait scripts, styles et polices) et `noindex`, les ressources
 *   celle de l'API.
 *
 * Sans le réglage, rien n'est servi ici : les chemins inconnus rendent le 404 JSON.
 */
@HttpController('')
export class PanelController {
  private readonly dist: string | null;

  constructor(env: AppEnv) {
    this.dist = env.DASHBOARD_DIST_DIR?.trim() ? resolve(env.DASHBOARD_DIST_DIR.trim()) : null;
  }

  @HttpGet('/*')
  async serve(@HttpCtx() ctx: Context): Promise<Response> {
    const path = ctx.req.path;
    if (!this.dist || RESERVED.some((root) => path === root || path.startsWith(`${root}/`))) throw new NotFoundError('Not Found');
    const requested = this.resolve(path);
    const isAsset = extname(requested) !== '';
    const file = isAsset ? requested : resolve(this.dist, 'index.html');
    const body = await readFile(file).catch(() => null);
    if (!body) throw new NotFoundError('Not Found');
    const immutable = isAsset && path.startsWith('/assets/');
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': type,
        'Content-Length': String(body.byteLength),
        'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        'Content-Security-Policy': cspOf(type),
        'X-Robots-Tag': 'noindex, nofollow',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  }

  /**
   * Chemin du fichier demandé, dans le dossier du panel. Une remontée de
   * dossier retombe sur un nom absent : la page du routeur, ou 404, jamais un
   * fichier hors du panel.
   */
  private resolve(path: string): string {
    let relative: string;
    try {
      relative = decodeURIComponent(path.slice(1));
    } catch {
      relative = '';
    }
    const file = resolve(this.dist ?? '.', relative);
    return file === this.dist || file.startsWith(`${this.dist}${sep}`) ? file : resolve(this.dist ?? '.', '__hors_du_dossier__');
  }
}
