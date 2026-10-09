import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';
import { NotifyService } from './notify.service';
import { NumberingService } from './numbering.service';
import { OrgService } from './org.service';

const services = [PrismaService, RedisService, AccessService, AuditService, NotifyService, NumberingService, OrgService];

@Global()
@Module({
  imports: [JwtModule.register({ global: true, secret: process.env.JWT_SECRET || 'dev-secret-change-me', signOptions: { expiresIn: '8h' } })],
  providers: services,
  exports: services,
})
export class CoreModule {}
