import { getDb } from "@limo/db";
import { sql } from "drizzle-orm";

export interface CnaeMapping {
  cnaeCode:        string;
  cnaeDescription: string;
  isPrimary:       boolean;
  weight:          number;
}

export interface SectorMapping {
  sectorName: string;
  cnaes:      CnaeMapping[];
}

// Normalize sector input: remove accents, lowercase, strip extra spaces
export function normalizeSector(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

// Fuzzy match sector slug against our mapping table
export async function getCnaesForSector(sector: string): Promise<CnaeMapping[]> {
  const db   = getDb();
  const slug = normalizeSector(sector);

  // 1. Exact slug match
  const exact: any[] = await db.execute(sql`
    SELECT cnae_code, cnae_description, is_primary, weight
    FROM disc_sector_cnae_map
    WHERE sector_slug = ${slug} AND active = TRUE
    ORDER BY weight DESC, is_primary DESC
  `);

  if (exact.length > 0) return toMappings(exact);

  // 2. Partial match: slug contains keyword or vice-versa
  const partial: any[] = await db.execute(sql`
    SELECT cnae_code, cnae_description, is_primary, weight
    FROM disc_sector_cnae_map
    WHERE (sector_slug ILIKE ${'%' + slug + '%'} OR ${slug} ILIKE '%' || sector_slug || '%')
      AND active = TRUE
    ORDER BY weight DESC, is_primary DESC
  `);

  return toMappings(partial);
}

function toMappings(rows: any[]): CnaeMapping[] {
  return rows.map((r) => ({
    cnaeCode:        r.cnae_code,
    cnaeDescription: r.cnae_description,
    isPrimary:       r.is_primary,
    weight:          r.weight,
  }));
}

// Get top N primary + secondary CNAEs, sorted by weight
export function selectTopCnaes(mappings: CnaeMapping[], maxPrimary = 3, maxSecondary = 3): string[] {
  const primary   = mappings.filter((m) => m.isPrimary).slice(0, maxPrimary).map((m) => m.cnaeCode);
  const secondary = mappings.filter((m) => !m.isPrimary).slice(0, maxSecondary).map((m) => m.cnaeCode);
  return [...new Set([...primary, ...secondary])];
}
