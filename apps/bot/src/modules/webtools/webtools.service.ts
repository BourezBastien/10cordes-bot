import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { GameDig } from 'gamedig';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import { AppEnv } from '../../app.env';
import { buildCapabilityTools, type CapabilityToolsDeps } from './webtools-capabilities.tools';
import { buildDisdexTools } from './webtools-disdex.tools';
import { buildFunTools } from './webtools-fun.tools';
import { buildGithubTools } from './webtools-github.tools';
import { buildPracticalTools } from './webtools-practical.tools';
import { buildReferenceTools } from './webtools-reference.tools';
import { buildSearchTools } from './webtools-search.tools';

/**
 * Ordre d'enregistrement historique des tools, conservé à l'identique
 * alors que les factories sont regroupées par domaine : cet ordre est
 * observable (getAvailableTools liste les noms d'une catégorie dans l'ordre
 * du registry, et les tris stables de search_tools et de la sélection des
 * tools départagent les ex æquo par ordre d'insertion).
 */
const REGISTRATION_ORDER: readonly string[] = [
  'searchInternet',
  'generatePdf',
  'getWeather',
  'githubRepo',
  'readRssFeed',
  'getJoke',
  'getGif',
  'getMeme',
  'getFact',
  'getAdvice',
  'getZenQuote',
  'getTrivia',
  'getRandomAnimal',
  'getPublicHolidays',
  'convertCurrency',
  'getCountryInfo',
  'defineWord',
  'getLyrics',
  'lookupIp',
  'searchWikipedia',
  'getNews',
  'getColorSchema',
  'discordServerLookup',
  'discordInviteResolve',
  'discordUserLookup',
  'getGithubProfile',
  'server.status',
  'http.fetch',
];

/** Rang d'enregistrement d'un tool ; un tool absent de la table passe en dernier. */
function registrationRank(name: string): number {
  const rank = REGISTRATION_ORDER.indexOf(name);
  return rank === -1 ? REGISTRATION_ORDER.length : rank;
}

/**
 * Tools de capacités web et fichiers (inspiration Discord-AI-Bot) :
 * recherche internet, génération de PDF, météo, GitHub, flux RSS.
 * Aucune clé API requise : DuckDuckGo, Open-Meteo et GitHub (anonyme) sont
 * gratuits ; les PDF sont générés localement avec pdfkit. L'image générée
 * (generateImage) relève du module imagelab et de son modèle routé.
 *
 * Répartition : une factory `*.tools.ts` par domaine (recherche et actualités,
 * ouvrages de référence, infos pratiques, détente, GitHub, index disdex,
 * capacités techniques). Le service instancie les collaborateurs, construit
 * les tools et les enregistre au boot.
 */
@Injectable()
export class WebToolsService implements SpraxiumOnBoot {
  private readonly log = new Logger('WebTools');
  private readonly gamedig = new GameDig();

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly env: AppEnv,
  ) {}

  onBoot(): void {
    const deps: CapabilityToolsDeps = { gamedig: this.gamedig };
    const tools = [
      ...buildSearchTools(),
      ...buildReferenceTools(),
      ...buildPracticalTools(),
      ...buildFunTools(),
      ...buildGithubTools(),
      ...buildDisdexTools(),
      ...buildCapabilityTools(deps),
    ].sort((a, b) => registrationRank(a.name) - registrationRank(b.name));
    for (const tool of tools) this.registry.register(tool);
    this.log.info(`${tools.length} tools web enregistrés`);
  }
}
