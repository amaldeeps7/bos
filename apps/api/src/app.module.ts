import { Controller, Get, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { PrismaErrorsFilter } from './core/prisma-errors.filter';
import { CoreModule } from './core/core.module';
import { AuthGuard, TenantMiddleware } from './core/auth.guard';
import { Public } from './core/decorators';
import { PrismaService } from './core/prisma.service';
import { AuthController } from './modules/auth.controller';
import { PeopleController } from './modules/people.controller';
import { TasksController } from './modules/tasks.controller';
import { MeetingsController } from './modules/meetings.controller';
import { ApprovalsController } from './modules/approvals.controller';
import { ApprovalsService } from './modules/approvals.service';
import { FinanceService } from './modules/finance.service';
import { DocumentsService } from './modules/documents.service';
import { CatalogController, CustomersController, OpportunitiesController, QuotesController } from './modules/sales.controller';
import { CreditNotesController, InvoicesController, PaymentsController } from './modules/finance.controller';
import { AssetsController, ProjectsController } from './modules/delivery.controller';
import { ReportsController } from './modules/reports.controller';
import { SettingsController } from './modules/settings.controller';
import { AiController } from './modules/ai.controller';
import { TeamController } from './modules/team.controller';
import { SchedulerService } from './modules/scheduler.service';
import { SearchController } from './modules/search.controller';
import { OrgsController } from './modules/orgs.controller';
import { AgentService } from './modules/agent/agent.service';
import { ExportService } from './modules/export.service';

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
    ProjectsController, AssetsController, ReportsController, SettingsController, AiController, SearchController, TeamController, OrgsController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_FILTER, useClass: PrismaErrorsFilter }, FinanceService, ApprovalsService, DocumentsService, SchedulerService, ExportService, AgentService, SearchController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) { consumer.apply(TenantMiddleware).forRoutes('*'); }
}
