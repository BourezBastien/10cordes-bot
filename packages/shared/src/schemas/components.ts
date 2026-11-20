import { z } from 'zod';

/**
 * Layout Components V2 data-driven : une définition JSON (persistée dans
 * AgentPanel.definition) rendue en message V2 par le bot. L'agent IA construit
 * n'importe quel message interactif avec ce schéma ; les actions des boutons
 * sont résolues par le registre d'actions du bot (see actions/registry).
 * Zod = source de vérité : validé à l'écriture ET à la relecture.
 */

export const ComponentButtonActionSchema = z.discriminatedUnion('type', [
  /** Poste un message pré-écrit dans le salon du composant. */
  z.object({ type: z.literal('reply'), message: z.string().min(1).max(1000) }),
  /** Lien externe (rendu en ButtonStyle.Link, aucune interaction). */
  z.object({ type: z.literal('link'), url: z.string().url().max(1000) }),
  /** Ouvre un salon de ticket dans la catégorie (comportement historique des panels). */
  z.object({
    type: z.literal('ticket'),
    categoryId: z.string().optional(),
    welcomeMessage: z.string().max(1000).optional(),
  }),
  /** Ajoute un rôle au membre qui clique (permissions du bot vérifiées à l'exécution). */
  z.object({ type: z.literal('giveRole'), roleId: z.string().min(15) }),
  /** Retire un rôle au membre qui clique. */
  z.object({ type: z.literal('removeRole'), roleId: z.string().min(15) }),
  /** Incrémente un compteur nommé (store records, collection 'counters') et confirme. */
  z.object({ type: z.literal('counter'), name: z.string().min(1).max(60) }),
  /** Révèle un contenu caché en éphémère (spoiler/texte d'info). */
  z.object({ type: z.literal('reveal'), message: z.string().min(1).max(1000) }),
  /**
   * Enregistre un clic pour un choix donné (sondage, RSVP, inscription...) :
   * un enregistrement par membre par message (le re-cliquer change le choix).
   * Dépouillement via tally.votes. Générique : sert à tout collecteur de clics.
   */
  z.object({ type: z.literal('vote'), choice: z.string().min(1).max(80) }),
]);
export type ComponentButtonAction = z.infer<typeof ComponentButtonActionSchema>;

export const ComponentButtonSchema = z.object({
  label: z.string().min(1).max(80),
  emoji: z.string().max(16).optional(),
  style: z.enum(['primary', 'secondary', 'success', 'danger']).default('primary'),
  action: ComponentButtonActionSchema.optional(),
});
export type ComponentButton = z.infer<typeof ComponentButtonSchema>;

export const ComponentSelectOptionSchema = z.object({
  label: z.string().min(1).max(100),
  description: z.string().max(100).optional(),
  emoji: z.string().max(16).optional(),
  /** Action déclenchée quand cette option est choisie (même registre que les boutons). */
  action: ComponentButtonActionSchema.optional(),
});

/**
 * Une rangée = soit des boutons, soit un menu déroulant (contrainte Discord).
 */
export const ComponentSelectRowSchema = z.object({
  placeholder: z.string().max(100).default('Choisis une option'),
  options: z.array(ComponentSelectOptionSchema).min(1).max(25),
});
export type ComponentSelectRow = z.infer<typeof ComponentSelectRowSchema>;

export const ComponentRowDefSchema = z.union([
  z.object({ kind: z.literal('buttons'), buttons: z.array(ComponentButtonSchema).min(1).max(5) }),
  z.object({ kind: z.literal('select'), select: ComponentSelectRowSchema }),
]);
export type ComponentRowDef = z.infer<typeof ComponentRowDefSchema>;

/**
 * Le layout complet d'un message V2 construit par l'agent. Persisté en DB
 * (AgentPanel.definition), re-rendu déterministe, interactions résolues par
 * messageId + index de rangée/bouton.
 */
export const ComponentLayoutSchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    description: z.string().min(1).max(3500).optional(),
    accentColor: z.number().int().min(0).max(0xffffff).optional(),
    footer: z.string().max(200).optional(),
    thumbnailUrl: z.string().url().max(500).optional(),
    imageUrl: z.string().url().max(500).optional(),
    rows: z.array(ComponentRowDefSchema).max(10).optional(),
  })
  .refine(
    (value) => value.title || value.description,
    { message: 'Un titre ou une description est requis.' },
  );
export type ComponentLayout = z.infer<typeof ComponentLayoutSchema>;
