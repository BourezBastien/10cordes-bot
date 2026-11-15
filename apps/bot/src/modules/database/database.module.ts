import { Global, Module } from '@spraxium/common';
import { PrismaService } from './prisma.service';

// @Global : PrismaService accessible depuis tous les containers enfants
// (fallback parent), une seule instance de client dans tout le bot.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
