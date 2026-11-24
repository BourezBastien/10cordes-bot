import type { Client } from 'discord.js';
import type { ToolResult, ToolRunContext } from '@10cordes/shared';
import { safeFetch } from '../../shared/utils/safe-fetch';
import type { CapabilityCredentials } from '../providers/provider.types';

const DEFAULT_MODEL = 'z-image';

/** Résout, pour un serveur, le fournisseur qui sert sa capacité image kie.ai. */
export type KieCredentialsResolver = (guildId: string | null) => Promise<CapabilityCredentials | null>;

/**
 * Génération d'image via kie.ai puis livraison en pièce jointe dans le salon
 * de la demande. Collaborateur NON injectable : WebToolsService l'instancie
 * comme champ de classe avec le client Discord et le résolveur de clé.
 */
export class KieImageGenerator {
  constructor(
    private readonly client: Client,
    private readonly credentials: KieCredentialsResolver,
  ) {}

  /**
   * Génération d'image via kie.ai (jobs API, z-image / Tongyi-MAI) :
   * createTask → poll recordInfo → resultJson.resultUrls[0]. Z-Image = 0,8
   * crédit (~$0.004) l'image, rendu en ~6s, aspect_ratio requis. Pattern UX :
   * UN message de progression édité à chaque étape, puis l'image téléchargée
   * et postée en pièce jointe (Discord n'accepte pas de PJ sur un edit).
   */
  async generate(prompt: string, ctx: ToolRunContext, label: string, aspectRatio: string): Promise<ToolResult> {
    const credentials = await this.credentials(ctx.guildId);
    const key = credentials?.apiKey;
    if (!credentials || !key) return { ok: false, summary: 'Génération d\u0027image désactivée : intégration kie.ai via le bot.' };
    const apiBase = `${credentials.baseUrl.replace(/\/+$/u, '')}/api/v1`;
    const model = credentials.modelId || DEFAULT_MODEL;
    if (!ctx.channelId) return { ok: false, summary: 'Salon de la demande introuvable.' };
    const channel = await this.client.channels.fetch(ctx.channelId).catch(() => null);
    if (!channel?.isTextBased() || !('send' in channel)) {
      return { ok: false, summary: 'Salon introuvable pour poster l\u0027image.' };
    }

    // Progression dans LA ligne de statut du traitement (ctx.progress) :
    // jamais de message dédié, la seule livraison est le fichier lui-même.
    const update = async (message: string): Promise<void> => {
      await ctx.progress?.(message);
    };

    const created = await safeFetch(`${apiBase}/jobs/createTask`, {
      timeoutMs: 30_000,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, input: { prompt, aspect_ratio: aspectRatio } }),
    });
    const createdData = (await created.json().catch(() => ({}))) as { code?: number; data?: { taskId?: string }; msg?: string };
    if (createdData.code !== 200 || !createdData.data?.taskId) {
      await update('image : génération refusée par kie.ai');
      return { ok: false, summary: `Génération refusée par kie.ai : ${createdData.msg ?? 'erreur inconnue'}` };
    }

    await update(`image : génération lancée (z-image, ${aspectRatio})`);
    const deadline = Date.now() + 90_000;
    let elapsed = 0;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      elapsed += 4;
      const record = await safeFetch(`${apiBase}/jobs/recordInfo?taskId=${createdData.data.taskId}`, {
        timeoutMs: 15_000,
        headers: { Authorization: `Bearer ${key}` },
      });
      const recordData = (await record.json().catch(() => ({}))) as {
        data?: {
          // z-image : resultJson = chaîne JSON {"resultUrls":[...]}. Autres
          // modèles jobs : response.result_url / resultUrl / liste.
          resultJson?: string;
          response?: {
            result_url?: string;
            resultUrl?: string;
            data?: Array<{ url?: string }>;
          };
        };
      };
      let resultUrl: string | undefined;
      if (recordData.data?.resultJson) {
        try {
          const inner = JSON.parse(recordData.data.resultJson) as { resultUrls?: string[] };
          resultUrl = inner.resultUrls?.[0];
        } catch {
          // Format inattendu : on retombera sur les autres formes.
        }
      }
      resultUrl ??= recordData.data?.response?.result_url ?? recordData.data?.response?.resultUrl ?? recordData.data?.response?.data?.find((entry) => entry.url)?.url;
      if (resultUrl) {
        await update('image prête : envoi du fichier');
        const image = await fetch(resultUrl).then((res) => res.arrayBuffer()).catch(() => null);
        if (image) {
          await channel
            .send({
              content: `**${label}**`,
              files: [{ name: `${label.replace(/[^a-zA-Z0-9-_]/gu, '-').slice(0, 40)}.png`, attachment: Buffer.from(image) }],
            })
            .catch(() => {});
        }
        await update('image livrée (z-image, 0,8 crédit)');
        return { ok: true, summary: `Image générée et envoyée dans le salon (source : kie.ai, z-image).`, data: { url: resultUrl } };
      }
      await update(`image : génération en cours... ${elapsed}s`);
    }
    await update('image : dépasse 90s, elle arrivera ; réessaie dans une minute');
    return { ok: false, summary: 'La génération dépasse 90 secondes : réessaie dans une minute.' };
  }
}
