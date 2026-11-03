// Sócios/administradores reais da Receita Federal (tabela rf_socios), por CNPJ.
// É a fonte de NOMES de decisores pro Garimpo, consultada SOB DEMANDA por
// cnpj_basico (8 primeiros dígitos do CNPJ). Substitui o approach de raspar site
// do motor passivo (que dava zero). Ver migração 0024 + scripts/import-rf-socios.ts.

import { getDb } from "@limo/db";
import { sql } from "drizzle-orm";

export interface SocioCandidate {
  firstName: string;
  lastName:  string;
  cargo:     string;
}

export async function findSocios(cnpj?: string | null): Promise<SocioCandidate[]> {
  const basico = String(cnpj ?? "").replace(/\D/g, "").slice(0, 8);
  if (basico.length !== 8) return [];

  try {
    const rows: any[] = await getDb().execute(sql`
      SELECT nome_socio, cargo
      FROM   rf_socios
      WHERE  cnpj_basico = ${basico}
      LIMIT  25
    `);
    return rows
      .map((r) => {
        const parts = String(r.nome_socio ?? "").trim().split(/\s+/).filter(Boolean);
        return {
          firstName: parts[0] ?? "",
          lastName:  parts.slice(1).join(" "),
          cargo:     r.cargo ?? "Sócio",
        };
      })
      .filter((s) => s.firstName.length > 0);
  } catch {
    // Tabela pode não existir / estar vazia ainda — degrada em silêncio.
    return [];
  }
}
