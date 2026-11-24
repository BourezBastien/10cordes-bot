import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';
import { safeFetchJson } from '../../shared/utils/safe-fetch';

/**
 * Tools GitHub (API anonyme, 60 requêtes/heure) : fiche d'un dépôt et fiche
 * d'un profil. Ordre d'origine dans le registry : githubRepo, getGithubProfile.
 */
export function buildGithubTools(): BotTool[] {
  return [
    {
      name: 'githubRepo',
      description:
        'Infos sur un dépôt GitHub (propriétaire/nom) : description, étoiles, langage, dernière release, lien de diagramme interactif (gitdiagram). Limite API : 60 requêtes/heure sans auth.',
      category: 'web',
      paramsSchema: z.object({ repo: z.string().min(3).max(120).describe('Format propriétaire/nom, ex: discordjs/discord.js') }),
      requiredModules: [],
      destructive: false,
      systemPrompt:
        'Format strict propriétaire/nom. Pour une vue en diagramme de l\u0027architecture, donne le lien https://gitdiagram.com/{owner}/{repo}. Limite 60 req/h sans clé : pas de boucles intensives.',
      handler: async (input, _ctx) => {
        const { repo } = input as { repo: string };
        // Le nom demandé part dans le chemin de l'API : deux segments propres, rien qui remonte l'arborescence.
        const parts = repo
          .replace(/^https?:\/\/github\.com\//, '')
          .replace(/\/+$/, '')
          .replace(/\.git$/, '')
          .split('/');
        const clean = parts.join('/');
        if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/u.test(part) || part === '.' || part === '..')) {
          return { ok: false, summary: 'Format attendu : propriétaire/nom (ex : discordjs/discord.js).' };
        }
        const headers = { 'User-Agent': '10cordes-bot', Accept: 'application/vnd.github+json' };
        const info = await safeFetchJson<{
          full_name?: string;
          description?: string;
          stargazers_count?: number;
          forks_count?: number;
          language?: string;
          html_url?: string;
          message?: string;
        }>(`https://api.github.com/repos/${clean}`, { headers });
        if (info?.message) return { ok: false, summary: `Dépôt introuvable : ${info.message}` };
        // Un dépôt sans release répond 404 : la question de la version ne doit pas faire échouer la fiche.
        const release = await safeFetchJson<{ tag_name?: string; name?: string }>(`https://api.github.com/repos/${clean}/releases/latest`, { headers }).catch(
          (): { tag_name?: string; name?: string } => ({}),
        );
        return {
          ok: true,
          summary: `${info.full_name} : ${info.description ?? 'sans description'}, ${info.stargazers_count ?? 0} étoiles, ${info.forks_count ?? 0} forks, langage ${info.language ?? '?'}${release?.tag_name ? `, dernière version ${release.tag_name}` : ''}. ${info.html_url ?? ''} | Diagramme interactif : https://gitdiagram.com/${clean}`,
          data: { ...info, latestRelease: release?.tag_name ?? null, diagramUrl: `https://gitdiagram.com/${clean}` },
        };
      },
    },
    {
      name: 'getGithubProfile',
      description:
        'Fiche profil GitHub : avatar, bio, followers, repos publics, organisation. Limite API : 60 requêtes/heure sans authentification.',
      category: 'web',
      paramsSchema: z.object({ username: z.string().min(1).max(60) }),
      requiredModules: [],
      destructive: false,
      systemPrompt:
        'Source : api.github.com. Limite 60 req/h sans clé : évite les boucles intensives. Pour le diagramme d\u0027un repo, propose le lien https://gitdiagram.com/{owner}/{repo}.',
      handler: async (input, _ctx) => {
        const { username } = input as { username: string };
        const headers = { 'User-Agent': '10cordes-bot', Accept: 'application/vnd.github+json' };
        const data = await safeFetchJson<{
          login?: string;
          name?: string;
          bio?: string;
          avatar_url?: string;
          followers?: number;
          public_repos?: number;
          created_at?: string;
          blog?: string;
          message?: string;
        }>(`https://api.github.com/users/${encodeURIComponent(username)}`, { headers });
        if (data?.message) return { ok: false, summary: `Profil introuvable : ${data.message}` };
        return {
          ok: true,
          summary: `${data.name ?? data.login} (GitHub) : ${data.bio ?? 'sans bio'}, ${data.followers ?? 0} followers, ${data.public_repos ?? 0} repos publics, inscrit depuis ${data.created_at?.slice(0, 10) ?? '?'}${data.blog ? `, site : ${data.blog}` : ''}. Avatar : ${data.avatar_url ?? ''}`,
          data: { avatar_url: data.avatar_url },
        };
      },
    },
  ];
}
