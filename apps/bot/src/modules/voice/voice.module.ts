import { Module } from '@spraxium/common';
import { ToolRegistryModule } from '../tool-registry/tool-registry.module';
import { VoiceService } from './voice.service';

// Lecture audio en vocal (@discordjs/voice) : tools voice.* (join, play,
// skip, stop, leave, status). Stack pure JS : opusscript + libsodium +
// ffmpeg-static (Node 27 alpha sans prebuilds natifs).
@Module({
  imports: [ToolRegistryModule],
  providers: [VoiceService],
})
export class VoiceModule {}
