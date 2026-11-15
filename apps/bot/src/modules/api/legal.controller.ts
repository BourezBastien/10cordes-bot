import { HttpController, HttpGet } from '@spraxium/http';
import type { Context } from 'hono';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGES: Record<string, { title: string; file: string }> = {
  terms: {
    title: "Conditions d'Utilisation",
    file: join(process.cwd(), "..", "..", "docs", "legal", "terms.md"),
  },
  privacy: {
    title: "Politique de Confidentialité",
    file: join(process.cwd(), "..", "..", "docs", "legal", "privacy.md"),
  },
};

function renderPage(title: string, markdown: string): string {
  const safe = markdown.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - 10cordes-bot</title>
<style>body{background:#111114;color:#f2f2f5;font-family:system-ui,sans-serif;max-width:52rem;margin:0 auto;padding:2rem 1rem;line-height:1.6}
h1{color:#57f287}pre{white-space:pre-wrap;font-family:inherit;font-size:1rem}</style>
</head><body><pre>${safe}</pre></body></html>`;
}

function fallbackPage(title: string): Response {
  const html = `<!doctype html><html lang="fr"><body style="background:#111114;color:#f2f2f5;font-family:system-ui;padding:2rem"><h1>${title}</h1><p>Document disponible prochainement. Contactez le staff du serveur de support.</p></body></html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/** Pages légales publiques (ToS / Privacy) - URLs déclarées dans le Discord Developer Portal. */
@HttpController('/legal')
export class LegalController {
  @HttpGet('/terms')
  terms(ctx: Context): Response {
    return this.page(ctx, PAGES.terms ?? { title: "Terms", file: "" });
  }

  @HttpGet('/privacy')
  privacy(ctx: Context): Response {
    return this.page(ctx, PAGES.privacy ?? { title: "Privacy", file: "" });
  }

  private page(ctx: Context, page: { title: string; file: string }): Response {
    try {
      const markdown = readFileSync(page.file, 'utf8');
      return ctx.html(renderPage(page.title, markdown));
    } catch {
      return fallbackPage(page.title);
    }
  }
}
