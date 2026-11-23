import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { AudioPlayer, VoiceConnection } from '@discordjs/voice';

/** Une piste de la file d'attente : son titre affiché et son URL audio https directe. */
export interface QueueTrack {
  title: string;
  url: string;
}

/** Session vocale d'un serveur : connexion, player, transcodeur, file et piste en cours. */
export interface GuildVoiceState {
  connection: VoiceConnection | null;
  player: AudioPlayer;
  ffmpeg: ChildProcessWithoutNullStreams | null;
  queue: QueueTrack[];
  nowPlaying: QueueTrack | null;
}
