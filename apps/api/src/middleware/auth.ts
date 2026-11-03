import type { FastifyRequest, FastifyReply } from "fastify";
import { config } from "../config.js";

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    reply.code(401).send({ statusCode: 401, error: "Unauthorized", message: "Token inválido ou expirado" });
  }
}

export async function requireManager(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;
  const user = request.user as any;
  if (user.role !== "manager" && user.role !== "admin") {
    reply.code(403).send({ statusCode: 403, error: "Forbidden", message: "Acesso restrito a gestores" });
  }
}

// Restrito ao dono do produto (gate por email). Usado no painel do pool da
// Assertiva, que é um recurso global compartilhado entre todos os times.
export async function requireOwner(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  await requireAuth(request, reply);
  if (reply.sent) return;
  const user = request.user as any;
  if (!user?.email || user.email.toLowerCase() !== config.OWNER_EMAIL.toLowerCase()) {
    reply.code(403).send({ statusCode: 403, error: "Forbidden", message: "Acesso restrito" });
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      id: string;
      email?: string;
      role?: string;
      teamId?: string | null;
      type?: "refresh" | "calendar_oauth";
    };
    user: {
      id: string;
      email: string;
      role: string;
      teamId: string | null;
    };
  }
}
