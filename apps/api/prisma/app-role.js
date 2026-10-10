/* Ensures the application role exists and can use every table, without bypassing row-level security.
   Runs on each container start after `prisma migrate deploy`, as the owner (MIGRATE_DATABASE_URL).
   Idempotent. Needs CREATEROLE (the Docker owner role is a superuser); otherwise it only reports. */
const { PrismaClient } = require('@prisma/client');

const appUrl = new URL(process.env.DATABASE_URL);
const role = decodeURIComponent(appUrl.username);
const password = decodeURIComponent(appUrl.password);
const db = new PrismaClient({ datasourceUrl: process.env.MIGRATE_DATABASE_URL });
const ident = s => '"' + s.replace(/"/g, '""') + '"';
const lit = s => "'" + s.replace(/'/g, "''") + "'";

(async () => {
  const owner = new URL(process.env.MIGRATE_DATABASE_URL).username;
  if (role === owner) { console.warn(`app-role: DATABASE_URL uses the owner role (${owner}); row-level security is bypassed. Use a separate role.`); return; }
  const [r] = await db.$queryRawUnsafe(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`, role);
  if (!r) await db.$executeRawUnsafe(`CREATE ROLE ${ident(role)} LOGIN PASSWORD ${lit(password)} NOSUPERUSER NOBYPASSRLS`);
  else if (r.rolsuper || r.rolbypassrls) throw new Error(`${role} bypasses row-level security (superuser or BYPASSRLS). Give the API a role without either.`);
  const dbName = (await db.$queryRawUnsafe('SELECT current_database() AS d'))[0].d;
  for (const sql of [
    `GRANT CONNECT ON DATABASE ${ident(dbName)} TO ${ident(role)}`,
    `GRANT USAGE ON SCHEMA public TO ${ident(role)}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ident(role)}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ident(role)}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ident(role)}`,
    `REVOKE ALL ON "_prisma_migrations" FROM ${ident(role)}`,
    `GRANT EXECUTE ON FUNCTION account_org_count(text) TO ${ident(role)}`,
  ]) await db.$executeRawUnsafe(sql);
  console.log(`app-role: ${role} ready (no BYPASSRLS)`);
})().catch(e => { console.error('app-role:', e.message); process.exitCode = 1; }).finally(() => db.$disconnect());
