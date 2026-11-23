import { z } from 'zod';
import type { BotTool } from '@10cordes/shared';

/**
 * Tools de détente : blague, GIF, mème, fait insolite, conseil, citation,
 * question de quiz, photo d'animal. Ordre d'origine dans le registry :
 * getJoke, getGif, getMeme, getFact, getAdvice, getZenQuote, getTrivia,
 * getRandomAnimal.
 */
export function buildFunTools(): BotTool[] {
  return [
    {
      name: 'getJoke',
      description: 'Renvoie une blague en français ou anglais (JokeAPI, Chuck Norris en option).',
      category: 'web',
      paramsSchema: z.object({
        lang: z.enum(['fr', 'en']).default('fr'),
        source: z.enum(['any', 'chucknorris']).default('any'),
      }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Parfait pour détendre l\u0027ambiance. La blague est un contenu tiers : livre-la telle quelle, ne la modifie pas.',
      handler: async (input, _ctx) => {
        const { lang, source } = input as { lang?: string; source?: string };
        if (source === 'chucknorris') {
          const joke = (await fetch('https://api.chucknorris.io/jokes/random').then((res) => res.json())) as { value?: string };
          return { ok: true, summary: joke.value ?? 'Aucune blague trouvée.', data: { source: 'api.chucknorris.io' } };
        }
        const joke = (await fetch(
          `https://v2.jokeapi.dev/joke/Any?lang=${lang === 'en' ? 'en' : 'fr'}&safe-mode`,
        ).then((res) => res.json())) as {
          error?: boolean;
          type?: string;
          joke?: string;
          setup?: string;
          delivery?: string;
        };
        if (joke.error || (!joke.joke && !joke.setup)) return { ok: false, summary: 'Aucune blague disponible.' };
        const text = joke.type === 'twopart' ? `${joke.setup} … ${joke.delivery}` : (joke.joke ?? '');
        return { ok: true, summary: text, data: { source: 'jokeapi.dev' } };
      },
    },
    {
      name: 'getGif',
      description:
        'Renvoie un GIF animé depuis un subreddit (ex: gifs, funnygifs, awwnverts). Image/vidéo URL + source Reddit. Sans clé, rate limit Reddit : une requête par demande.',
      category: 'web',
      paramsSchema: z.object({ subreddit: z.string().min(2).max(30).default('gifs') }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Pour les demandes de GIF réaction. Vérifie l\u0027adaptation au salon. Certains posts Reddit sont des vidéos mp4 : livre l\u0027URL telle quelle.',
      handler: async (input, _ctx) => {
        const { subreddit } = input as { subreddit?: string };
        const clean = (subreddit ?? 'gifs').replace(/[^a-zA-Z0-9_]/gu, '');
        const gif = (await fetch(`https://meme-api.com/gimme/${clean}`).then((res) => res.json())) as {
          url?: string;
          title?: string;
          postLink?: string;
          nsfw?: boolean;
        };
        if (!gif.url) return { ok: false, summary: 'Aucun GIF trouvé pour ce subreddit.' };
        if (gif.nsfw) return { ok: false, summary: 'Le GIF trouvé est NSFW : refuse et propose un autre subreddit.' };
        return {
          ok: true,
          summary: `${gif.title ?? 'gif'} : ${gif.url} (source : ${gif.postLink ?? 'reddit'})`,
          data: { url: gif.url, postLink: gif.postLink },
        };
      },
    },
    {
      name: 'getMeme',
      description: 'Renvoie un mème aléatoire (image URL + titre, source Reddit).',
      category: 'web',
      paramsSchema: z.record(z.string(), z.unknown()),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Ambiance détendue uniquement. Vérifie que le mème est adapté au salon avant de le partager.',
      handler: async (_input, _ctx) => {
        const meme = (await fetch('https://meme-api.com/gimme').then((res) => res.json())) as {
          url?: string;
          title?: string;
          postLink?: string;
        };
        if (!meme.url) return { ok: false, summary: 'Aucun mème disponible.' };
        return {
          ok: true,
          summary: `${meme.title ?? 'mème'} : ${meme.url} (source : ${meme.postLink ?? 'reddit'})`,
          data: { url: meme.url, postLink: meme.postLink },
        };
      },
    },
    {
      name: 'getFact',
      description: 'Renvoie un fait insolite vérifié (français ou anglais, uselessfacts).',
      category: 'web',
      paramsSchema: z.object({ lang: z.enum(['fr', 'en']).default('fr') }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Anecdote insolite : livre-la avec la mention « fait vérifié » si tu la présentes comme vraie.',
      handler: async (input, _ctx) => {
        const { lang } = input as { lang?: string };
        const fact = (await fetch(`https://uselessfacts.jsph.pl/api/v2/facts/random?language=${lang === 'en' ? 'en' : 'fr'}`).then((res) =>
          res.json(),
        )) as { text?: string };
        return { ok: true, summary: fact.text ?? 'Aucun fait trouvé.', data: { source: 'uselessfacts.jsph.pl' } };
      },
    },
    {
      name: 'getAdvice',
      description: 'Renvoie un conseil du jour (Advice Slip API, anglais).',
      category: 'web',
      paramsSchema: z.record(z.string(), z.unknown()),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Le conseil arrive en anglais : traduis-le si l\u0027utilisateur parle français.',
      handler: async (_input, _ctx) => {
        const advice = (await fetch('https://api.adviceslip.com/advice').then((res) => res.json())) as {
          slip?: { advice?: string };
        };
        return { ok: true, summary: advice.slip?.advice ?? 'Aucun conseil trouvé.', data: { source: 'api.adviceslip.com' } };
      },
    },
    {
      name: 'getZenQuote',
      description: 'Renvoie une citation inspirante (ZenQuotes, anglais).',
      category: 'web',
      paramsSchema: z.record(z.string(), z.unknown()),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Citation en anglais : traduis-la pour un public français.',
      handler: async (_input, _ctx) => {
        const quote = (await fetch('https://zenquotes.io/api/random').then((res) => res.json())) as Array<{ q?: string; a?: string }>;
        const first = quote?.[0];
        return { ok: true, summary: first ? `"${first.q}" : ${first.a}` : 'Aucune citation trouvée.', data: { source: 'zenquotes.io' } };
      },
    },
    {
      name: 'getTrivia',
      description: 'Renvoie une question de quiz (Open Trivia DB) avec sa réponse, pour lancer un mini-quiz.',
      category: 'web',
      paramsSchema: z.object({ lang: z.enum(['fr', 'en']).default('en') }),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Lance le quiz : pose la question SANS révéler la réponse, puis dis que la réponse arrive quand les gens répondent (ou à la prochaine demande « réponse »).',
      handler: async (input, _ctx) => {
        const { lang } = input as { lang?: string };
        const data = (await fetch(`https://opentdb.com/api.php?amount=1&type=multiple${lang === 'fr' ? '' : ''}`).then((res) =>
          res.json(),
        )) as {
          results?: Array<{ question: string; correct_answer: string; incorrect_answers: string[]; category: string }>;
        };
        const q = data.results?.[0];
        if (!q) return { ok: false, summary: 'Aucune question disponible.' };
        return {
          ok: true,
          summary: `[${q.category}] ${q.question.replace(/&quot;|&#039;/g, "'").replace(/&amp;/g, '&')} ; réponse : ${q.correct_answer}`,
          data: { correct: q.correct_answer, wrong: q.incorrect_answers },
        };
      },
    },
    {
      name: 'getRandomAnimal',
      description: 'Renvoie une photo aléatoire de chien (dog.ceo).',
      category: 'web',
      paramsSchema: z.record(z.string(), z.unknown()),
      requiredModules: [],
      destructive: false,
      systemPrompt: 'Ambiance : parfait pour détendre un salon. Envoie juste l\u0027URL de l\u0027image.',
      handler: async (_input, _ctx) => {
        const dog = (await fetch('https://dog.ceo/api/breeds/image/random').then((res) => res.json())) as {
          message?: string;
        };
        return { ok: true, summary: dog.message ?? 'Aucune image trouvée.', data: { url: dog.message } };
      },
    },
  ];
}
