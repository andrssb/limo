import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDb } from "@limo/db";
import { coachingSessions, productMaterials, salesReferences, salesInsights, coachingKnowledge } from "@limo/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth.js";
import { transcribeAudioBuffer } from "../services/transcription.js";
import { askClaude } from "../lib/llm.js";
import {
  generateCoachingTips,
  getTeamKnowledgeContext,
  processProductMaterial,
  generatePlaybookInsights,
  processCoachingMaterial,
} from "../services/coaching.js";

const DEFAULT_SALES_REFS = [
  { name: "Luis Nekta",       youtubeHandle: "luisnekta",     instagramHandle: "luisnekta",     specialty: "Cold call presencial, tonalidade de voz, técnica de espelhamento e construção de rapport rápido em prospecção outbound" },
  { name: "Gustavo Pagotto",  youtubeHandle: "gustavopagotto", instagramHandle: "gustavopagotto", specialty: "Prospecção outbound, gestão de pipeline, métricas de BDR e automação de cadências" },
  { name: "Marcelo Ortega",   youtubeHandle: "marceloortega",  instagramHandle: "marceloortega",  specialty: "Técnicas de fechamento, neurovendas, persuasão ética e gestão de objeções complexas" },
  { name: "Diego Maia",       youtubeHandle: "diegomaia",      instagramHandle: "diegomaia",      specialty: "Liderança em vendas, motivação de times, cultura de alta performance e estratégias de crescimento B2B" },
  { name: "Thiago Concer",    youtubeHandle: "thiagoconcer",   instagramHandle: "thiagoconcer",   specialty: "Inside sales, scripts de vendas, qualificação de leads e treinamento de equipes BDR" },
];

export async function coachingRoutes(fastify: FastifyInstance): Promise<void> {
  const db = getDb();
  fastify.addHook("preHandler", requireAuth);

  // ── Product Materials ────────────────────────────────────────────────────────

  fastify.get("/product-materials", async (request) => {
    const { teamId } = request.user as any;
    const rows = await db.select().from(productMaterials)
      .where(eq(productMaterials.teamId, teamId))
      .orderBy(desc(productMaterials.createdAt));
    return { materials: rows };
  });

  fastify.post("/product-materials", async (request, reply) => {
    const { id: userId, teamId } = request.user as any;
    const body = z.object({
      type:       z.enum(["url", "text", "file"]).default("url"),
      title:      z.string().max(500).optional(),
      sourceUrl:  z.string().url().optional(),
      rawContent: z.string().optional(),
    }).parse(request.body);

    // Fetch URL content if needed
    let rawContent = body.rawContent ?? null;
    let title = body.title ?? null;

    if (body.type === "url" && body.sourceUrl && !rawContent) {
      try {
        const res = await fetch(body.sourceUrl, { signal: AbortSignal.timeout(10000) });
        const html = await res.text();
        // Extract text from HTML
        rawContent = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 6000);
        if (!title) {
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          title = titleMatch?.[1]?.trim() ?? body.sourceUrl;
        }
      } catch { /* use url as content */ rawContent = `URL: ${body.sourceUrl}`; }
    }

    const [material] = await db.insert(productMaterials).values({
      userId, teamId,
      type: body.type,
      title,
      sourceUrl: body.sourceUrl ?? null,
      rawContent,
      status: "processing",
    }).returning();

    // Process async with AI
    processProductMaterial(title, body.sourceUrl ?? null, rawContent)
      .then(async (summary) => {
        await db.update(productMaterials)
          .set({ aiSummary: summary, status: "done" })
          .where(eq(productMaterials.id, material.id));
      })
      .catch(async () => {
        await db.update(productMaterials)
          .set({ status: "failed" })
          .where(eq(productMaterials.id, material.id));
      });

    return reply.code(201).send({ material });
  });

  fastify.delete("/product-materials/:id", async (request, reply) => {
    const { teamId } = request.user as any;
    const { id } = request.params as any;
    await db.delete(productMaterials)
      .where(and(eq(productMaterials.id, id), eq(productMaterials.teamId, teamId)));
    return reply.code(204).send();
  });

  // ── Sales Playbook (Discurso) ─────────────────────────────────────────────────

  fastify.get("/sales-playbook/references", async (request, reply) => {
    const { teamId, role } = request.user as any;

    let refs = await db.select().from(salesReferences)
      .where(eq(salesReferences.teamId, teamId))
      .orderBy(desc(salesReferences.createdAt));

    // Auto-seed default references for new teams
    if (refs.length === 0) {
      const seeded = await db.insert(salesReferences)
        .values(DEFAULT_SALES_REFS.map((r) => ({ ...r, teamId })))
        .returning();
      refs = seeded;
    }

    return { references: refs };
  });

  fastify.post("/sales-playbook/references", async (request, reply) => {
    const { teamId, role } = request.user as any;
    if (role !== "manager" && role !== "admin") return reply.code(403).send({ message: "Acesso restrito ao manager" });

    const body = z.object({
      name:            z.string().min(1).max(200),
      youtubeChannel:  z.string().optional(),
      youtubeHandle:   z.string().optional(),
      instagramHandle: z.string().optional(),
      specialty:       z.string().optional(),
    }).parse(request.body);

    const [ref] = await db.insert(salesReferences).values({ ...body, teamId }).returning();
    return reply.code(201).send({ reference: ref });
  });

  fastify.delete("/sales-playbook/references/:id", async (request, reply) => {
    const { teamId, role } = request.user as any;
    if (role !== "manager" && role !== "admin") return reply.code(403).send({ message: "Acesso restrito ao manager" });
    const { id } = request.params as any;
    await db.delete(salesReferences)
      .where(and(eq(salesReferences.id, id), eq(salesReferences.teamId, teamId)));
    return reply.code(204).send();
  });

  fastify.get("/sales-playbook/insights", async (request) => {
    const { teamId } = request.user as any;
    const { category } = request.query as any;

    const rows = await db.select({
      insight: salesInsights,
      refName: salesReferences.name,
    })
      .from(salesInsights)
      .leftJoin(salesReferences, eq(salesReferences.id, salesInsights.referenceId))
      .where(eq(salesInsights.teamId, teamId))
      .orderBy(desc(salesInsights.createdAt))
      .limit(100);

    const insights = rows.map((r) => ({ ...r.insight, referenceName: r.refName }));
    const byCategory = category
      ? insights.filter((i) => i.category === category)
      : insights;

    return { insights: byCategory };
  });

  // POST /sales-playbook/enrich/:referenceId — manually trigger enrichment for a reference
  fastify.post("/sales-playbook/enrich/:referenceId", async (request, reply) => {
    const { teamId, role } = request.user as any;
    if (role !== "manager" && role !== "admin") return reply.code(403).send({ message: "Acesso restrito ao manager" });

    const { referenceId } = request.params as any;
    const [ref] = await db.select().from(salesReferences)
      .where(and(eq(salesReferences.id, referenceId), eq(salesReferences.teamId, teamId))).limit(1);
    if (!ref) return reply.code(404).send({ message: "Referência não encontrada" });

    // Fetch YouTube RSS for latest video titles/descriptions
    let recentContent = `Metodologia conhecida de ${ref.name}: ${ref.specialty ?? ""}`;
    if (ref.youtubeHandle) {
      try {
        // Try to get latest YouTube videos via search RSS (no API key needed)
        const searchRss = await fetch(
          `https://www.youtube.com/feeds/videos.xml?user=${ref.youtubeHandle}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (searchRss.ok) {
          const xml = await searchRss.text();
          const titles = [...xml.matchAll(/<title>([^<]+)<\/title>/g)].map((m) => m[1]).slice(1, 10);
          const descriptions = [...xml.matchAll(/<media:description>([^<]+)<\/media:description>/g)].map((m) => m[1]).slice(0, 5);
          recentContent += `\n\nVídeos recentes:\n${titles.join("\n")}\n\nDescrições:\n${descriptions.join("\n")}`;
        }
      } catch { /* use known specialty */ }
    }

    const newInsights = await generatePlaybookInsights(ref.name, ref.specialty ?? null, recentContent);

    if (newInsights.length > 0) {
      await db.insert(salesInsights).values(
        newInsights.map((i) => ({
          teamId,
          referenceId,
          category: i.category,
          title: i.title,
          insight: i.insight,
        }))
      );
      await db.update(salesReferences)
        .set({ lastEnrichedAt: new Date() })
        .where(eq(salesReferences.id, referenceId));
    }

    return { inserted: newInsights.length, insights: newInsights };
  });

  // POST /sales-playbook/chat — chat with the playbook AI (all roles)
  fastify.post("/sales-playbook/chat", async (request, reply) => {
    const { teamId } = request.user as any;

    const { message } = z.object({ message: z.string().min(1) }).parse(request.body);

    // Coaching context: sales-technique insights + Product Education. The more
    // the AI knows about the product, the more aligned the pitch it coaches.
    const [insights, materials] = await Promise.all([
      db.select({ category: salesInsights.category, title: salesInsights.title, insight: salesInsights.insight })
        .from(salesInsights)
        .where(eq(salesInsights.teamId, teamId))
        .limit(50),
      db.select({ title: productMaterials.title, aiSummary: productMaterials.aiSummary })
        .from(productMaterials)
        .where(and(eq(productMaterials.teamId, teamId), eq(productMaterials.status, "done")))
        .orderBy(desc(productMaterials.createdAt))
        .limit(30),
    ]);

    const context = insights.map((i) => `[${i.category}] ${i.title}: ${i.insight}`).join("\n");
    const productContext = materials
      .filter((m) => m.aiSummary)
      .map((m) => `- ${m.title ?? "Material"}: ${m.aiSummary}`)
      .join("\n");

    const text = await askClaude(
      message,
      `Você é um coach de vendas especializado em técnicas de BDR brasileiro, com base nas metodologias de Luis Nekta, Gustavo Pagotto, Marcelo Ortega, Diego Maia e Thiago Concer.

Seu papel é ensinar técnicas práticas e acionáveis de prospecção, cold call, espelhamento, qualificação e fechamento — sempre que possível, ancorando o pitch no produto que o time vende.

SOBRE O PRODUTO (Educação de Produto):
${productContext || "Nenhum material de produto cadastrado ainda. Incentive o time a cadastrar a Educação de Produto para deixar o coaching mais alinhado ao que ele vende."}

BASE DE CONHECIMENTO (técnicas de venda):
${context || "Nenhum insight cadastrado ainda. Responda com base em seu conhecimento geral."}

Responda de forma direta, prática e com exemplos reais de diálogo quando relevante. Quando fizer sentido, conecte a técnica ao produto acima. Use linguagem informal e motivadora.`,
    );
    return { response: text };
  });

  // ── Coaching Knowledge (enrichment materials) ────────────────────────────────

  fastify.get("/coaching/knowledge", async (request) => {
    const { teamId } = request.user as any;
    const rows = await db.select().from(coachingKnowledge)
      .where(eq(coachingKnowledge.teamId, teamId))
      .orderBy(desc(coachingKnowledge.createdAt));
    return { knowledge: rows };
  });

  fastify.post("/coaching/knowledge", async (request, reply) => {
    const { id: userId, teamId } = request.user as any;
    const body = z.object({
      type:       z.enum(["url", "text", "youtube"]).default("url"),
      title:      z.string().max(500).optional(),
      sourceUrl:  z.string().optional(),
      rawContent: z.string().optional(),
    }).parse(request.body);

    let rawContent = body.rawContent ?? null;
    let title = body.title ?? null;

    // Fetch URL content
    if ((body.type === "url" || body.type === "youtube") && body.sourceUrl && !rawContent) {
      try {
        // For YouTube, extract video ID and get transcript via description
        if (body.type === "youtube" || body.sourceUrl.includes("youtube.com") || body.sourceUrl.includes("youtu.be")) {
          const videoId = body.sourceUrl.match(/(?:v=|youtu\.be\/)([^&\s]+)/)?.[1];
          if (videoId) {
            const rss = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { signal: AbortSignal.timeout(8000) });
            if (rss.ok) {
              const data = await rss.json() as any;
              title = title ?? data.title ?? `YouTube: ${videoId}`;
              rawContent = `Vídeo YouTube: ${data.title ?? videoId}\nAutor: ${data.author_name ?? ""}\nURL: ${body.sourceUrl}`;
            }
          }
        } else {
          const res = await fetch(body.sourceUrl, { signal: AbortSignal.timeout(10000) });
          const html = await res.text();
          rawContent = html
            .replace(/<script[\s\S]*?<\/script>/gi, "")
            .replace(/<style[\s\S]*?<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 8000);
          if (!title) {
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            title = titleMatch?.[1]?.trim() ?? body.sourceUrl;
          }
        }
      } catch { rawContent = `URL: ${body.sourceUrl}`; }
    }

    const [item] = await db.insert(coachingKnowledge).values({
      userId, teamId,
      type: body.type,
      title,
      sourceUrl: body.sourceUrl ?? null,
      rawContent,
      status: "processing",
    }).returning();

    // Process async with AI
    processCoachingMaterial(title, rawContent)
      .then(async (summary) => {
        await db.update(coachingKnowledge)
          .set({ aiSummary: summary, status: "done" })
          .where(eq(coachingKnowledge.id, item.id));
      })
      .catch(async () => {
        await db.update(coachingKnowledge)
          .set({ status: "failed" })
          .where(eq(coachingKnowledge.id, item.id));
      });

    return reply.code(201).send({ item });
  });

  fastify.delete("/coaching/knowledge/:id", async (request, reply) => {
    const { teamId } = request.user as any;
    const { id } = request.params as any;
    await db.delete(coachingKnowledge)
      .where(and(eq(coachingKnowledge.id, id), eq(coachingKnowledge.teamId, teamId)));
    return reply.code(204).send();
  });

  // ── Live Coaching ─────────────────────────────────────────────────────────────

  fastify.post("/coaching/start", async (request, reply) => {
    const { id: userId, teamId } = request.user as any;
    const { contactId } = z.object({ contactId: z.string().uuid().optional() }).parse(request.body ?? {});

    const [session] = await db.insert(coachingSessions).values({
      userId, teamId, contactId: contactId ?? null, status: "active",
    }).returning();

    return reply.code(201).send({ sessionId: session.id });
  });

  fastify.post("/coaching/:sessionId/chunk", async (request, reply) => {
    const { id: userId, teamId } = request.user as any;
    const { sessionId } = request.params as any;

    const [session] = await db.select().from(coachingSessions)
      .where(and(eq(coachingSessions.id, sessionId), eq(coachingSessions.userId, userId))).limit(1);
    if (!session || session.status !== "active") {
      return reply.code(404).send({ message: "Sessão não encontrada ou encerrada" });
    }

    // Receive audio as base64 in JSON body. `speaker` rotula a trilha (sdr/lead)
    // quando a captura é de 2 lados (Fase 1) — ajuda a IA a saber quem falou.
    const { audio, mimeType, speaker } = z.object({
      audio:    z.string(), // base64
      mimeType: z.string().default("audio/webm"),
      speaker:  z.enum(["sdr", "lead"]).optional(),
    }).parse(request.body);

    const audioBuffer = Buffer.from(audio, "base64");

    // Transcribe chunk
    let chunkText = "";
    try {
      const { text } = await transcribeAudioBuffer(audioBuffer, mimeType, speaker);
      chunkText = text;
    } catch {
      return reply.code(200).send({ transcript: "", tips: [], skipped: true });
    }

    if (!chunkText.trim()) {
      return reply.code(200).send({ transcript: "", tips: [], skipped: true });
    }

    // Rotula a fala com o falante quando conhecido, pra a IA contextualizar.
    const labeled = speaker ? `${speaker === "sdr" ? "BDR" : "Lead"}: ${chunkText}` : chunkText;

    // Append to full transcript
    const newTranscript = (session.fullTranscript + "\n" + labeled).trim();
    await db.update(coachingSessions)
      .set({ fullTranscript: newTranscript })
      .where(eq(coachingSessions.id, sessionId));

    // Build context and generate tips
    const knowledge = await getTeamKnowledgeContext(teamId);
    const tips = await generateCoachingTips(labeled, newTranscript, knowledge);

    // Append tips to session
    const allTips = [...((session.tips as any[]) ?? []), ...tips.map((t) => ({ ...t, at: new Date().toISOString() }))];
    await db.update(coachingSessions)
      .set({ tips: allTips.slice(-20) }) // keep last 20
      .where(eq(coachingSessions.id, sessionId));

    return { transcript: chunkText, tips };
  });

  fastify.post("/coaching/:sessionId/end", async (request, reply) => {
    const { id: userId } = request.user as any;
    const { sessionId } = request.params as any;

    const [session] = await db.update(coachingSessions)
      .set({ status: "ended", endedAt: new Date() })
      .where(and(eq(coachingSessions.id, sessionId), eq(coachingSessions.userId, userId)))
      .returning();

    if (!session) return reply.code(404).send({ message: "Sessão não encontrada" });
    return { session };
  });
}
