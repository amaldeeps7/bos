import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService, prismaProvider } from './prisma.service';
import { RedisService } from './redis.service';
import { AccessService } from './access.service';
import { AuditService } from './audit.service';
import { NotifyService } from './notify.service';
import { NumberingService } from './numbering.service';
import { OrgService } from './org.service';
import { MailService } from './mail.service';
import { PdfService } from './pdf.service';
import { MembersService } from './members.service';
import { SessionService } from './session.service';

const services = [RedisService, AccessService, AuditService, NotifyService, NumberingService, OrgService, MailService, PdfService, MembersService, SessionService];

@Global()
@Module({
  imports: [JwtModule.register({ global: true, secret: process.env.JWT_SECRET || 'dev-secret-change-me', signOptions: { expiresIn: '8h' } })],
  providers: [prismaProvider, ...services],
  exports: [PrismaService, ...services],
})
export class CoreModule {}
