-- When a task was completed (so long-finished tasks can be paged instead of always loaded).
ALTER TABLE "Task" ADD COLUMN "doneAt" TIMESTAMP(3);
UPDATE "Task" SET "doneAt" = "createdAt" WHERE "status" = 'done';

-- Indexes for the list screens' filters (assignee/status/due, project, date ranges, notifications).
CREATE INDEX "Task_orgId_assigneeId_status_due_idx" ON "Task"("orgId", "assigneeId", "status", "due");
CREATE INDEX "Task_orgId_projectId_idx" ON "Task"("orgId", "projectId");
CREATE INDEX "Task_orgId_status_doneAt_idx" ON "Task"("orgId", "status", "doneAt");
CREATE INDEX "Invoice_orgId_date_idx" ON "Invoice"("orgId", "date");
CREATE INDEX "Invoice_orgId_customerId_idx" ON "Invoice"("orgId", "customerId");
CREATE INDEX "Payment_orgId_date_idx" ON "Payment"("orgId", "date");
CREATE INDEX "Quote_orgId_date_idx" ON "Quote"("orgId", "date");
CREATE INDEX "Meeting_orgId_date_idx" ON "Meeting"("orgId", "date");
CREATE INDEX "Notification_orgId_userId_createdAt_idx" ON "Notification"("orgId", "userId", "createdAt");
