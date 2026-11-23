import { Injectable, type SpraxiumOnBoot } from '@spraxium/common';
import { Logger } from '@spraxium/logger';
import { Client } from 'discord.js';
import { getToolRegistry } from '../tool-registry/tool-registry.service';
import { VoiceConnectionManager } from './voice-connection';
import { VoiceSessions } from './voice-sessions';
import { buildVoiceTools, type VoiceToolsDeps } from './voice.tools';

/**
 * Lecture audio en vocal (@discordjs/voice). Stack 100 % pure JS (Node 27
 * alpha sans prebuilds natifs) : opusscript (encodage), libsodium-wrappers
 * (chiffrement), ffmpeg-static (transcodage mp3 → PCM). Un player par
 * serveur avec file d'attente ; le bot rejoint le vocal de l'appelant ou un
 * salon précisé, puis streame des URLs https directes (ex : pistes kie.ai).
 * URLs validées par assertSafeUrl avant le spawn ffmpeg (SSRF + injection
 * d'arguments) : jamais localhost / privé, https uniquement.
 *
 * Répartition : VoiceSessions (état par serveur, file d'attente, ffmpeg),
 * VoiceConnectionManager (connexion au salon), voice.tools.ts (tools
 * voice.*). Le service les enregistre au boot, rien de plus.
 */
@Injectable()
export class VoiceService implements SpraxiumOnBoot {
  private readonly log = new Logger('Voice');
  // Collaborateurs non injectables : champs de classe, jamais des paramètres de constructeur DI.
  private readonly sessions = new VoiceSessions();
  private readonly connection: VoiceConnectionManager;

  constructor(private readonly client: Client) {
    this.connection = new VoiceConnectionManager(this.sessions);
  }

  onBoot(): void {
    const registry = getToolRegistry();
    const deps: VoiceToolsDeps = { client: this.client, sessions: this.sessions, connection: this.connection };
    for (const tool of buildVoiceTools(deps)) registry.register(tool);
    this.log.info(`${buildVoiceTools(deps).length} tools vocal enregistrés (opusscript + libsodium + ffmpeg-static).`);
  }
}
