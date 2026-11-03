import assert from "node:assert/strict";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  buildContactHasPhoneFilter,
  buildContactSearchFilter,
  normalizeContactSearchTerm,
} from "./contact-search.js";

const dialect = new PgDialect();

function render(filter: ReturnType<typeof buildContactSearchFilter>) {
  assert.ok(filter, "filtro nao deveria ser nulo");
  return dialect.sqlToQuery(filter!);
}

test("normaliza o termo digitado antes de buscar", () => {
  assert.equal(normalizeContactSearchTerm("  Andre   Teste  Voz "), "Andre Teste Voz");
  assert.equal(normalizeContactSearchTerm("   "), "");
});

test("busca por nome completo usa concat de nome e sobrenome", () => {
  const { sql, params } = render(buildContactSearchFilter("Andre   Teste Voz"));
  assert.match(sql, /concat_ws\(' ', "contacts"\."first_name", "contacts"\."last_name"\) ilike/);
  assert.ok(params.every((param) => param === "%Andre Teste Voz%"));
  assert.equal(params.length, 5);
});

test("busca cobre nome, sobrenome, nome completo, e-mail e empresa", () => {
  const { sql } = render(buildContactSearchFilter("limo"));
  for (const column of ["first_name", "last_name", "email", "company_name"]) {
    assert.ok(sql.includes(`"contacts"."${column}"`), `faltou ${column} na busca`);
  }
});

test("termo vazio nao gera filtro", () => {
  assert.equal(buildContactSearchFilter("   "), null);
});

test("filtro de telefone descarta nulo e string em branco", () => {
  const { sql } = dialect.sqlToQuery(buildContactHasPhoneFilter());
  assert.match(sql, /"contacts"\."phone" is not null/);
  assert.match(sql, /length\(btrim\("contacts"\."phone"\)\) > 0/);
});
