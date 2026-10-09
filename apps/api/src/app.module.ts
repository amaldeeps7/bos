import { Controller, Get, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CoreModule } from './core/core.module';
import { AuthGuard } from './core/auth.guard';
import { Public } from './core/decorators';
import { PrismaService } from './core/prisma.service';
import { AuthController } from './modules/auth.controller';
import { PeopleController } from './modules/people.controller';
import { TasksController } from './modules/tasks.controller';
import { MeetingsController } from './modules/meetings.controller';
import { ApprovalsController } from './modules/approvals.controller';
import { ApprovalsService } from './modules/approvals.service';
import { FinanceService } from './modules/finance.service';
import { CatalogController, CustomersController, OpportunitiesController, QuotesController } from './modules/sales.controller';
import { CreditNotesController, InvoicesController, PaymentsController } from './modules/finance.controller';
import { AssetsController, ProjectsController } from './modules/delivery.controller';
import { ReportsController } from './modules/reports.controller';
import { SettingsController } from './modules/settings.controller';
import { AiController } from './modules/ai.controller';

@Controller('health')
class HealthController {
  constructor(private prisma: PrismaService) {}
  @Public() @Get()
  async health() { await this.prisma.$queryRaw`SELECT 1`; return { ok: true }; }
}

@Module({
  imports: [CoreModule],
  controllers: [HealthController, AuthController, PeopleController, TasksController, MeetingsController, ApprovalsController,
    CustomersController, OpportunitiesController, CatalogController, QuotesController, InvoicesController, PaymentsController, CreditNotesController,
    ProjectsController, AssetsController, ReportsController, SettingsController, AiController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }, FinanceService, ApprovalsService],
})
export class AppModule {}
