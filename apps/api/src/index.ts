import { buildApp } from "./app.js";
import { config } from "./config.js";
import { startCallProcessorWorker } from "./workers/call-processor.js";
import { startCRMSyncWorker } from "./workers/crm-sync.js";
import { startWeeklyReportWorker } from "./workers/weekly-report.js";
import { startMessageTranscriberWorker } from "./workers/message-transcriber.js";
import { startGarimpoWorker }           from "./workers/garimpo.js";
import { startDailyEnrichmentWorker }   from "./workers/daily-enrichment.js";
import { startPassiveEngineWorker }     from "./workers/passive-engine.js";
import { restoreWhatsAppSessions }      from "./routes/whatsapp.js";
import { CronJob } from "cron";
import { addJob, QUEUES } from "./lib/queue.js";
import { getDb } from "@limo/db";
import { teams, personas, lists, garimpoRuns, salesReferences, enrRuns } from "@limo/db";
import { eq, and, isNull, lt } from "drizzle-orm";
import { generatePlaybookInsights } from "./services/coaching.js";
import { salesInsights } from "@limo/db";

async function main() {
  const app = await buildApp();

  // ── Background workers ────────────────────────────────────────────────────
  startCallProcessorWorker();
  startCRMSyncWorker();
  startWeeklyReportWorker();
  startMessageTranscriberWorker();
  startGarimpoWorker();
  startDailyEnrichmentWorker();
  startPassiveEngineWorker();

  // A sessao viva do WhatsApp mora em memoria, entao todo deploy a derrubava e
  // so voltava com alguem clicando em "Conectar" com o celular na mao. As
  // credenciais ficam no Redis e sobrevivem ao restart: reabrir aqui evita o
  // WhatsApp mudo silencioso depois de cada deploy.
  restoreWhatsAppSessions(getDb(), app.log).catch((error) => {
    app.log.warn({ err: error }, "Falha ao restaurar sessoes de WhatsApp no boot");
  });

  // ── Daily Garimpo cron (every day at 06:00) ──────────────────────────────
  new CronJob(
    "0 6 * * *",
    async () => {
      const db = getDb();
      // Queue one garimpo run per persona that has an active list
      const allPersonas = await db.select().from(personas);
      for (const persona of allPersonas) {
        // Find the most recently updated list for this user
        const [list] = await db.select({ id: lists.id })
          .from(lists)
          .where(eq(lists.userId, persona.userId))
          .limit(1);
        if (!list) continue;

        const [run] = await db.insert(garimpoRuns).values({
          personaId: persona.id,
          listId: list.id,
          userId: persona.userId,
          status: "pending",
        }).returning();

        await addJob(QUEUES.GARIMPO, "garimpo-daily", {
          runId: run.id,
          personaId: persona.id,
          listId: list.id,
          userId: persona.userId,
          teamId: persona.teamId,
        });
      }
      app.log.info(`Queued daily garimpo for ${allPersonas.length} personas`);
    },
    null,
    true,
    "America/Sao_Paulo"
  );

  // ── Daily enrichment: incomplete companies (02:00) ───────────────────────
  new CronJob("0 2 * * *", async () => {
    await addJob(QUEUES.ENRICHMENT_DAILY, "enrich-companies", {
      type: "enrich-companies", batchSize: 30,
    });
    app.log.info("Queued: enrich-companies");
  }, null, true, "America/Sao_Paulo");

  // ── Passive enrichment engine (02:30, runs up to 12h) ────────────────────
  // PAUSADO por padrão: o approach de raspar site da RF rende ~zero pessoas
  // (varreu 2,24M empresas → 0 pessoas; só 125 domínios resolvidos). Reativar
  // com PASSIVE_ENGINE_CRON=1 depois de migrar pro dado próprio da RF (QSA/sócios).
  const passiveCronEnabled = process.env.PASSIVE_ENGINE_CRON === "1";
  new CronJob("30 2 * * *", async () => {
    const db = getDb();
    // Skip if another run is still ongoing (manual or previous day overlap)
    const [running] = await db.select({ id: enrRuns.id }).from(enrRuns)
      .where(eq(enrRuns.status, "running")).limit(1);
    if (running) {
      app.log.warn(`Passive engine cron skipped — run ${running.id} still ongoing`);
      return;
    }
    const [run] = await db.insert(enrRuns).values({
      triggeredBy: "cron", status: "running",
    }).returning({ id: enrRuns.id });
    await addJob(QUEUES.PASSIVE_ENGINE, "run", {
      runId: run.id, triggeredBy: "cron",
    });
    app.log.info(`Queued passive-engine run ${run.id}`);
  }, null, passiveCronEnabled, "America/Sao_Paulo");
  if (!passiveCronEnabled) app.log.info("Passive engine cron PAUSED (set PASSIVE_ENGINE_CRON=1 to re-enable)");

  // ── Daily enrichment: contacts missing email/phone (03:00) ───────────────
  new CronJob("0 3 * * *", async () => {
    await addJob(QUEUES.ENRICHMENT_DAILY, "complete-contacts", {
      type: "complete-contacts", batchSize: 25,
    });
    app.log.info("Queued: complete-contacts");
  }, null, true, "America/Sao_Paulo");

  // ── Daily enrichment: revalidate stale (04:00) + flag obsolete (04:30) ───
  new CronJob("0 4 * * *", async () => {
    await addJob(QUEUES.ENRICHMENT_DAILY, "revalidate-stale", {
      type: "revalidate-stale", batchSize: 20, maxAgeDays: 30,
    });
    app.log.info("Queued: revalidate-stale");
  }, null, true, "America/Sao_Paulo");

  new CronJob("30 4 * * *", async () => {
    await addJob(QUEUES.ENRICHMENT_DAILY, "flag-obsolete", {
      type: "flag-obsolete", batchSize: 50, maxAgeDays: 90,
    });
    app.log.info("Queued: flag-obsolete");
  }, null, true, "America/Sao_Paulo");

  // ── Daily Playbook enrichment cron (every day at 07:00) ──────────────────
  new CronJob(
    "0 7 * * *",
    async () => {
      const db = getDb();
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      // Enrich references that haven't been updated in 24h
      const refs = await db.select().from(salesReferences).where(
        eq(salesReferences.isActive, true)
      );
      let enriched = 0;
      for (const ref of refs) {
        if (ref.lastEnrichedAt && ref.lastEnrichedAt > oneDayAgo) continue;

        let recentContent = `Metodologia de ${ref.name}: ${ref.specialty ?? ""}`;
        if (ref.youtubeHandle) {
          try {
            const rss = await fetch(`https://www.youtube.com/feeds/videos.xml?user=${ref.youtubeHandle}`, { signal: AbortSignal.timeout(8000) });
            if (rss.ok) {
              const xml = await rss.text();
              const titles = [...xml.matchAll(/<title>([^<]+)<\/title>/g)].map((m) => m[1]).slice(1, 8);
              if (titles.length) recentContent += `\nVídeos recentes: ${titles.join(" | ")}`;
            }
          } catch { /* ignore */ }
        }

        const newInsights = await generatePlaybookInsights(ref.name, ref.specialty ?? null, recentContent).catch(() => []);
        if (newInsights.length > 0) {
          await db.insert(salesInsights).values(newInsights.map((i) => ({
            teamId: ref.teamId, referenceId: ref.id,
            category: i.category, title: i.title, insight: i.insight,
          })));
          await db.update(salesReferences).set({ lastEnrichedAt: new Date() }).where(eq(salesReferences.id, ref.id));
          enriched++;
        }
      }
      app.log.info(`Playbook enrichment: ${enriched}/${refs.length} references updated`);
    },
    null, true, "America/Sao_Paulo"
  );

  // ── Weekly report cron (every Friday at 08:00) ────────────────────────────
  new CronJob(
    "0 8 * * 5",
    async () => {
      const db = getDb();
      const allTeams = await db.select({ id: teams.id }).from(teams);
      for (const team of allTeams) {
        await addJob(QUEUES.WEEKLY_REPORT, "weekly-report", { teamId: team.id });
      }
      app.log.info(`Queued weekly reports for ${allTeams.length} teams`);
    },
    null,
    true,
    "America/Sao_Paulo"
  );

  // ── Start server ──────────────────────────────────────────────────────────
  try {
    const port = config.PORT ?? config.API_PORT ?? 3001;
    await app.listen({ port, host: config.API_HOST });
    app.log.info(`🚀 Limo API running at http://${config.API_HOST}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
