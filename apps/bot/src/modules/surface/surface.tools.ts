import { z } from 'zod';
import {
  defineTool,
  SurfaceDefinitionSchema,
  validateSurfaceDefinition,
  type BotTool,
  type SurfaceDefinition,
  type ToolResult,
} from '@10cordes/shared';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../database/prisma.service';
import { deepMerge } from '../../shared/utils/object';
import { describeDefinitionError, listBindingKeys, surfaceNotFound } from './surface.errors';
import { findBinding } from './surface-definition';
import type { SurfaceStore } from './surface.store';

/** Ce dont les tools surface.* ont besoin : persistance, audit et re-rendu. */
export interface SurfaceToolsDeps {
  readonly prisma: PrismaService;
  readonly audit: AuditService;
  readonly store: SurfaceStore;
  /** Re-rend le message Discord qui affiche une surface. */
  readonly render: (surfaceId: string) => Promise<void>;
}

const GUILD_REQUIRED = 'Contexte de serveur requis.';
/** Labels sans contenu : le modèle tente parfois de créer une surface « coquille vide ». */
const PLACEHOLDER_LABEL_RE = /^(probe|test|ping|placeholder|todo)$/iu;
/** Titre ou description réduit à un mot de sonde : le modèle « teste » l'outil au lieu de construire la vraie surface. */
const PROBE_TEXT_RE = /^(?:probe|test|ping|placeholder|todo|debug|d[ée]bog|essai|d[ée]mo)$/iu;

/** Forme EXACTE du paramètre `definition`. Le modèle écrivait `rows` absent ou à plat et
 * `pipeline` en objet : 7 refus de suite en 40 s sur une demande de blackjack (23/11, 22:54). */
const DEFINITION_SHAPE =
  'Forme EXACTE de definition : {"title":"Titre","description":"Texte (affiche l\u0027état avec {{state.chemin}})","initialState":{},"rows":[{"kind":"buttons","buttons":[BINDING,BINDING]}]}, ou une rangée de menu {"kind":"select","select":{"placeholder":"Choisis","options":[BINDING]}}. rows est un TABLEAU d\u0027objets, jamais absent ni à plat. BINDING = {"key":"kebab-case (30 max)","label":"Libellé (80 max)","style":"primary","disabled":false,"access":{"userIds":[],"roleIds":[],"cooldownPerUserSec":0},"pipeline":[ETAPE,...]} (access est facultatif) : pipeline est un TABLEAU d\u0027étapes (1 à 20), jamais un objet. Exemple complet : {"title":"Pioche","initialState":{"carte":0},"rows":[{"kind":"buttons","buttons":[{"key":"tirer","label":"Tirer","style":"primary","pipeline":[{"type":"random","min":1,"max":11},{"type":"setState","path":"carte","value":"{{steps.0.value}}","mode":"set"},{"type":"replyEphemeral","content":"Tu tires {{state.carte}}"}]}]}]}.';

/** Champs EXACTS des étapes d'un pipeline (le modèle écrivait des étapes incomplètes, refusées une à une). */
const STEP_REFERENCE =
  'Champs EXACTS des étapes (pipeline) : runTool{name,input} (TOUT tool du registry passe par là, par exemple createChannel, setChannelOverwrite ou sendMessage : jamais un nom de tool comme type d\u0027étape ; le résultat du tool se lit dans {{steps.N.ok}}, {{steps.N.summary}} et les champs qu\u0027il renvoie, à plat : createChannel → {{steps.N.channelId}}, createRole → {{steps.N.roleId}}, sendMessage → {{steps.N.messageId}}) · setState{path,value,mode:set|increment|decrement|toggle} · updateComponent{binding,patch:{label,style,emoji,disabled}} · sendMessage{content,channelId?} · replyEphemeral{content} · openModal{modal:{title,inputs:[{id,label,style,required}]}, en PREMIÈRE étape} · record.write{collection,data} · trigger.schedule{steps,delaySec? OU cron?,key?,condition?} · trigger.cancelByKey{key} · random{min,max} → steps.N.value · llm{prompt,maxChars?,saveTo?,parseJson?} → steps.N.text, et state.<saveTo> si saveTo (objet si parseJson) · if{condition,then,else?} · forEach{over,steps,roleId?|collection?,limit,as} · claimOnce{key,ttlSec?,winnerVar?}. Une condition est un OBJET, jamais une chaîne : {"kind":"state","path":"total","op":"eq|ne|gt|gte|lt|lte|exists|contains","value":21}, ou {"kind":"regex","input":"{{state.x}}","pattern":"..."}, ou {"kind":"all","conditions":[...]} / {"kind":"any","conditions":[...]} / {"kind":"not","condition":{...}}. setState.value accepte une référence : "{{steps.0.value}}" ou "{{state.x}}" garde le type. RÈGLE DES RÉFÉRENCES {{steps.N.champ}} : seulement vers une étape QUI PRÉCÈDE celle qui la lit, jamais sous data ({{steps.0.channelId}}, pas {{steps.0.data.channelId}}) ; à partir d\u0027un if ou d\u0027un forEach les numéros ne sont plus fixes, range alors la valeur dans l\u0027état (setState) et lis-la par {{state.x}} ; un pipeline planifié (trigger.schedule) repart de zéro et ne lit que ses propres étapes. Les textes de la surface (titre, description, footer, labels) affichent l\u0027état en direct avec {{state.chemin}}.';

/** Texte (titre ou description) qui trahit une surface de sonde, sinon null. */
function probeTextOf(definition: SurfaceDefinition): 'titre' | 'description' | null {
  if (definition.title && PROBE_TEXT_RE.test(definition.title.trim())) return 'titre';
  if (definition.description && PROBE_TEXT_RE.test(definition.description.trim())) return 'description';
  return null;
}

const rowHasOnlyPlaceholders = (row: SurfaceDefinition['rows'][number]): boolean =>
  row.kind === 'buttons' ? row.buttons.every((b) => PLACEHOLDER_LABEL_RE.test(b.label)) : row.select.options.every((o) => PLACEHOLDER_LABEL_RE.test(o.label));

function surfaceCreateTool(deps: SurfaceToolsDeps): BotTool {
  return defineTool({
    name: 'surface.create',
    description:
      'Constructeur universel d\u0027interface interactive : une surface Components V2 (titre, description, rangées de boutons ou menus) avec un état JSON persistant, re-rendue à chaque mutation. Sert à construire tickets, sondages, jeux, captcha, vocaux temporaires. Le paramètre definition est une chaîne JSON. ' +
        DEFINITION_SHAPE +
        ' ' +
        STEP_REFERENCE,
    category: 'surface',
    keywords: ['panneau', 'panel', 'bouton', 'button', 'modal', 'menu', 'select', 'composant', 'formulaire', 'embed'],
    paramsSchema: z.object({
      channelId: z.string().min(1),
      kind: z.string().min(1).max(40).default('custom'),
      definition: z.string().min(10).max(20_000).describe('JSON SurfaceDefinition complet'),
    }),
    requiredModules: [],
    permissions: ['ManageGuild'],
    destructive: false,
      systemPrompt:
        'Forme : {"title","description","initialState","rows":[{"kind":"buttons","buttons":[{"key","label","style","pipeline":[étapes]}]}]}. rows = tableau d\u0027objets, pipeline = tableau d\u0027étapes (jamais un objet). Un tool s\u0027exécute par runTool{name,input}, et son résultat se lit dans {{steps.N.<champ renvoyé>}} (createChannel → {{steps.N.channelId}}). Contenu RÉEL demandé (titre explicite, labels métier, pipelines complets), JAMAIS de coquille vide ni de placeholder. openModal uniquement en PREMIÈRE étape. Clés de bindings kebab-case uniques. Réponds en UNE phrase après création.',
    handler: async (input, ctx): Promise<ToolResult> => {
      if (!ctx.guildId) return { ok: false, summary: GUILD_REQUIRED };
      const { channelId, kind, definition: raw } = input as { channelId: string; kind?: string; definition: string };
      let definition: SurfaceDefinition;
      try {
        definition = SurfaceDefinitionSchema.parse(JSON.parse(raw));
      } catch (error) {
        return { ok: false, summary: `Définition invalide : ${describeDefinitionError(error)}` };
      }
      // R0.3, STRICT : pas de surface « coquille vide » (bug Probe/ping), ni de
      // surface de sonde : le modèle testait l'outil avec titre ou texte
      // « probe », laissant ces coquilles dans le salon.
      if (!definition.title || definition.title.trim().length < 3) {
        return { ok: false, summary: "Titre requis (min 3 caractères réels) : donne le VRAI titre du panneau, pas un placeholder." };
      }
      const probe = probeTextOf(definition);
      if (probe) {
        return {
          ok: false,
          summary: `Surface de sonde refusée (${probe} réduit à « probe »), rien n\u0027a été posté. Construis directement la VRAIE surface demandée en un seul appel : champs exacts des étapes dans la description de surface.create.`,
        };
      }
      if (definition.rows.length === 0) {
        return { ok: false, summary: 'Au moins une rangée de composants est requise : fournis les VRAIS boutons/menus avec leurs labels et pipelines, pas une coquille vide.' };
      }
      if (definition.rows.every(rowHasOnlyPlaceholders)) {
        return { ok: false, summary: 'Labels placeholder détectés (probe/test/ping) : fournis le VRAI contenu demandé par l\u0027utilisateur.' };
      }
      const errors = validateSurfaceDefinition(definition);
      if (errors.length > 0) return { ok: false, summary: `Définition rejetée : ${errors.join(' | ')}` };
      const created = await deps.prisma.interactiveSurface.create({
        data: {
          guildId: ctx.guildId,
          channelId,
          kind: kind ?? 'custom',
          definition: JSON.stringify(definition),
          state: JSON.stringify(definition.initialState ?? {}),
          createdBy: ctx.userId,
        },
      });
      await deps.render(created.id);
      const row = await deps.prisma.interactiveSurface.findUnique({ where: { id: created.id } });
      deps.audit.record({
        guildId: ctx.guildId,
        source: 'agent',
        action: 'surface.created',
        actorId: ctx.userId,
        metadata: { surfaceId: created.id, kind: row?.kind },
      });
      return {
        ok: true,
        summary: `Surface « ${definition.title ?? row?.kind ?? ''} » créée dans <#${channelId}> (surfaceId ${created.id}).`,
        data: { surfaceId: created.id, messageId: row?.messageId },
      };
    },
  });
}

function surfacePatchStateTool(deps: SurfaceToolsDeps): BotTool {
  return defineTool({
    name: 'surface.patchState',
    description:
      'Modifie l\u0027état JSON persistant d\u0027une surface (fusion profonde) puis la RE-REND automatiquement. Identifie la surface par surfaceId OU par messageId (l\u0027id du message Discord qui l\u0027affiche).',
    category: 'surface',
    keywords: ['etat', 'état', 'state', 'compteur', 'grille', 'vote'],
    paramsSchema: z.object({
      surfaceId: z.string().min(1).optional().describe('ID de la surface (renvoyé par surface.create)'),
      messageId: z.string().min(1).optional().describe('ID du message Discord qui affiche la surface (alternative à surfaceId)'),
      state: z.record(z.string(), z.unknown()).describe('Patch profond à fusionner'),
    }),
    requiredModules: [],
    permissions: ['ManageGuild'],
    destructive: false,
    systemPrompt: 'Pour initialiser/compléter l\u0027état (owner, compteurs, grilles, résultats de vote). Le re-rendu est automatique.',
    handler: async (input, ctx): Promise<ToolResult> => {
      if (!ctx.guildId) return { ok: false, summary: GUILD_REQUIRED };
      const { surfaceId, messageId, state } = input as { surfaceId?: string; messageId?: string; state: Record<string, unknown> };
      const surface = await deps.store.find(ctx.guildId, surfaceId, messageId);
      if (!surface) return { ok: false, summary: surfaceNotFound(surfaceId, messageId) };
      const merged = deepMerge(JSON.parse(surface.state || '{}') as Record<string, unknown>, state) as Record<string, unknown>;
      await deps.store.saveState(surface.id, merged);
      await deps.render(surface.id);
      return { ok: true, summary: `État de la surface ${surface.id.slice(-6)} mis à jour et re-rendu.` };
    },
  });
}

function surfaceUpdateComponentTool(deps: SurfaceToolsDeps): BotTool {
  return defineTool({
    name: 'surface.updateComponent',
    description:
      'Patche une surface puis re-rend le message : SOIT un composant par sa clé de binding (label, style, emoji, disabled), SOIT l\u0027en-tête (title, description), par exemple pour afficher les résultats d\u0027un vote dans la description. Identifie la surface par surfaceId OU par messageId.',
    category: 'surface',
    keywords: ['titre', 'title', 'label', 'libelle', 'libellé', 'rendu', 'resultat', 'résultat'],
    paramsSchema: z.object({
      surfaceId: z.string().min(1).optional().describe('ID de la surface (renvoyé par surface.create)'),
      messageId: z.string().min(1).optional().describe('ID du message Discord qui affiche la surface'),
      binding: z.string().min(1).max(30).optional().describe('Clé du bouton/option à patcher'),
      title: z.string().max(120).optional().describe('Nouveau titre de la surface'),
      description: z.string().max(3500).optional().describe('Nouvelle description (supporte ## titres), ex : résultats, pourcentages'),
      label: z.string().max(80).optional(),
      style: z.enum(['primary', 'secondary', 'success', 'danger']).optional(),
      emoji: z.string().max(16).optional(),
      disabled: z.boolean().optional(),
    }),
    requiredModules: [],
    permissions: ['ManageGuild'],
    destructive: false,
    systemPrompt:
      'La primitive « bouton rouge qui passe vert » ET « publier les résultats » : patch disabled/style/label d\u0027un binding, ou title/description de l\u0027en-tête (sans binding). Re-rendu immédiat. Pour clôturer un vote : patchState (résultats dans l\u0027état) + description avec les chiffres + disabled sur chaque bouton.',
    handler: async (input, ctx): Promise<ToolResult> => {
      if (!ctx.guildId) return { ok: false, summary: GUILD_REQUIRED };
      const { surfaceId, messageId, binding, title, description, ...patch } = input as {
        surfaceId?: string;
        messageId?: string;
        binding?: string;
        title?: string;
        description?: string;
        label?: string;
        style?: 'primary' | 'secondary' | 'success' | 'danger';
        emoji?: string;
        disabled?: boolean;
      };
      const surface = await deps.store.find(ctx.guildId, surfaceId, messageId);
      if (!surface) return { ok: false, summary: surfaceNotFound(surfaceId, messageId) };
      const definition = SurfaceDefinitionSchema.parse(JSON.parse(surface.definition));
      const touched: string[] = [];
      if (title !== undefined || description !== undefined) {
        if (title !== undefined) definition.title = title;
        if (description !== undefined) definition.description = description;
        touched.push('en-tête');
      }
      if (binding !== undefined) {
        const target = findBinding(definition, binding);
        if (!target) {
          return {
            ok: false,
            summary: `Binding « ${binding} » introuvable. Clés disponibles : ${listBindingKeys(definition).join(', ')} (utilise la clé du binding, pas son label).`,
          };
        }
        Object.assign(target, { ...patch, ...(patch.label !== undefined ? { label: patch.label } : {}) });
        touched.push(`binding « ${binding} »`);
      }
      if (touched.length === 0) return { ok: false, summary: 'Rien à patcher : fournis binding, title ou description.' };
      await deps.store.saveDefinition(surface.id, definition);
      await deps.render(surface.id);
      return { ok: true, summary: `Surface re-rendue (${touched.join(' + ')}).` };
    },
  });
}

function surfaceGetTool(deps: SurfaceToolsDeps): BotTool {
  return defineTool({
    name: 'surface.get',
    description:
      'Lit une surface (définition + état actuel) : diagnostic et édition ultérieure. Identifie la surface par surfaceId OU par messageId (l\u0027id du message Discord qui l\u0027affiche).',
    category: 'surface',
    paramsSchema: z.object({
      surfaceId: z.string().min(1).optional(),
      messageId: z.string().min(1).optional().describe('ID du message Discord qui affiche la surface'),
    }),
    requiredModules: [],
    permissions: ['ManageGuild'],
    destructive: false,
    systemPrompt: 'Read-only.',
    handler: async (input, ctx): Promise<ToolResult> => {
      if (!ctx.guildId) return { ok: false, summary: GUILD_REQUIRED };
      const { surfaceId, messageId } = input as { surfaceId?: string; messageId?: string };
      const row = await deps.store.find(ctx.guildId, surfaceId, messageId);
      if (!row) return { ok: false, summary: surfaceNotFound(surfaceId, messageId) };
      return {
        ok: true,
        summary: `Surface ${row.kind} : state=${row.state.slice(0, 400)}`,
        data: { surfaceId: row.id, definition: JSON.parse(row.definition), state: JSON.parse(row.state || '{}'), messageId: row.messageId },
      };
    },
  });
}

/** Primitives surface.* de l'agent (ordre d'enregistrement : create, patchState, updateComponent, get). */
export function buildSurfaceTools(deps: SurfaceToolsDeps): BotTool[] {
  return [surfaceCreateTool(deps), surfacePatchStateTool(deps), surfaceUpdateComponentTool(deps), surfaceGetTool(deps)];
}
