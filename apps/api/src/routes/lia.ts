import type { FastifyInstance } from "fastify";
import { getDb } from "@limo/db";
import { liaLeads, liaEvents } from "@limo/db";
import { eq, and, count, sql, desc, lte, notInArray } from "drizzle-orm";
import { requireManager } from "../middleware/auth.js";

// Painel da Lia (assistente de SDR do Limo). Leitura do estado que o motor da
// Lia — que roda LOCAL — persiste nas tabelas lia_leads / lia_events. Tudo
// manager-only e escopado ao time do gestor. O motor (envio de e-mail/WhatsApp,
// avanco de cadencia) continua fora daqui; estas rotas so MOSTRAM.

const STAGES = ["Novo", "Em Cadência", "Engajado", "Trial Ativo", "Cliente", "Perdido"];

export async function liaRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();

  // ── Lista de leads ─────────────────────────────────────────────────────────
  // Opcional: ?etapa=Engajado filtra por etapa.
  fastify.get("/lia/leads", { preHandler: [requireManager] }, async (request) => {
    const { teamId } = request.user as any;
    if (!teamId) return { leads: [] };

    const { etapa } = request.query as { etapa?: string };
    const where = etapa
      ? and(eq(liaLeads.teamId, teamId), eq(liaLeads.etapa, etapa))
      : eq(liaLeads.teamId, teamId);

    const leads = await db
      .select()
      .from(liaLeads)
      .where(where)
      .orderBy(desc(liaLeads.updatedAt));

    return { leads };
  });

  // ── Funil + KPIs ───────────────────────────────────────────────────────────
  fastify.get("/lia/funnel", { preHandler: [requireManager] }, async (request) => {
    const { teamId } = request.user as any;
    if (!teamId) return { funnel: [], kpis: {} };

    // Contagem por etapa
    const rows = await db
      .select({ etapa: liaLeads.etapa, total: count() })
      .from(liaLeads)
      .where(eq(liaLeads.teamId, teamId))
      .groupBy(liaLeads.etapa);

    const porEtapa = new Map(rows.map((r) => [r.etapa, Number(r.total)]));
    const funnel = STAGES.map((etapa) => ({ etapa, total: porEtapa.get(etapa) ?? 0 }));

    // KPIs a partir dos eventos (espelha src/metrics.py)
    const [k] = await db
      .select({
        toques: sql<number>`count(*) filter (where ${liaEvents.tipo} in ('email_enviado','whatsapp_enviado'))`,
        leadsContatados: sql<number>`count(distinct ${liaEvents.leadId}) filter (where ${liaEvents.tipo} in ('email_enviado','whatsapp_enviado'))`,
        respostas: sql<number>`count(*) filter (where ${liaEvents.tipo} = 'resposta_recebida')`,
        reunioes: sql<number>`count(*) filter (where ${liaEvents.tipo} = 'reuniao_marcada')`,
        objecoes: sql<number>`count(*) filter (where ${liaEvents.tipo} = 'objecao_contornada')`,
      })
      .from(liaEvents)
      .where(eq(liaEvents.teamId, teamId));

    const toques = Number(k?.toques ?? 0);
    const respostas = Number(k?.respostas ?? 0);

    const [{ totalLeads }] = await db
      .select({ totalLeads: count() })
      .from(liaLeads)
      .where(eq(liaLeads.teamId, teamId));

    return {
      funnel,
      kpis: {
        totalLeads: Number(totalLeads),
        leadsContatados: Number(k?.leadsContatados ?? 0),
        toquesEnviados: toques,
        respostas,
        reunioesMarcadas: Number(k?.reunioes ?? 0),
        objecoesContornadas: Number(k?.objecoes ?? 0),
        taxaResposta: toques > 0 ? Math.round((respostas / toques) * 1000) / 1000 : 0,
      },
    };
  });

  // ── Briefing do dia (visao de gestao) ──────────────────────────────────────
  // Quem respondeu (assumir primeiro) e quem tem toque previsto pra hoje/atrasado.
  // O ranking fino por trilha mora no motor Python; aqui e a visao acionavel.
  fastify.get("/lia/briefing", { preHandler: [requireManager] }, async (request) => {
    const { teamId } = request.user as any;
    if (!teamId) return { responderam: [], aTocar: [] };

    const responderam = await db
      .select({
        id: liaLeads.id,
        nome: liaLeads.nome,
        empresa: liaLeads.empresa,
        whatsapp: liaLeads.whatsapp,
        etapa: liaLeads.etapa,
        objecao: liaLeads.objecao,
      })
      .from(liaLeads)
      .where(
        and(
          eq(liaLeads.teamId, teamId),
          eq(liaLeads.respondeu, true),
          notInArray(liaLeads.etapa, ["Cliente", "Perdido"]),
        ),
      )
      .orderBy(desc(liaLeads.ultimoToque));

    const aTocar = await db
      .select({
        id: liaLeads.id,
        nome: liaLeads.nome,
        empresa: liaLeads.empresa,
        whatsapp: liaLeads.whatsapp,
        origem: liaLeads.origem,
        etapa: liaLeads.etapa,
        diaCadencia: liaLeads.diaCadencia,
        proximaAcao: liaLeads.proximaAcao,
      })
      .from(liaLeads)
      .where(
        and(
          eq(liaLeads.teamId, teamId),
          notInArray(liaLeads.etapa, ["Cliente", "Perdido"]),
          lte(liaLeads.proximaAcao, new Date()),
        ),
      )
      .orderBy(liaLeads.proximaAcao);

    return {
      data: new Date().toISOString().slice(0, 10),
      responderam,
      aTocar,
    };
  });
}
