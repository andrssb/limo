#!/usr/bin/env python3
import os, subprocess, json

KEY = os.environ["GROQ_API_KEY"]
URL = "https://api.groq.com/openai/v1/chat/completions"

BASE = 'Responda APENAS em JSON com campo "companies": [{"legal_name":"Empresa Ltda","trade_name":null,"state":"UF","city":"Cidade","company_size":"GRANDE|MEDIO|EPP|ME|MEI"}]'

def call(prompt):
    body = json.dumps({
        "model": "llama-3.1-8b-instant",
        "max_tokens": 2000,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "user", "content": prompt}]
    })
    r = subprocess.run(
        ["curl", "-s", URL,
         "-H", f"Authorization: Bearer {KEY}",
         "-H", "Content-Type: application/json",
         "-d", body],
        capture_output=True, text=True
    )
    try:
        d = json.loads(r.stdout)
        return json.loads(d["choices"][0]["message"]["content"]).get("companies", [])
    except:
        return []

SP_PROMPTS = [
    f"Liste 40 empresas GRANDES e MEDIAS de tecnologia no estado SP. {BASE}",
    f"Liste 40 empresas PEQUENAS (MEI/ME/EPP) de tecnologia em SP, em Sao Paulo, Campinas, Santos, Sorocaba. {BASE}",
    f"Liste 40 empresas de tecnologia em SP: SaaS, fintech, software B2B, hardware, telecom. {BASE}",
    f"Liste 40 empresas de tecnologia em SP distribuidas por Sao Paulo, Campinas, Santos, Ribeirao Preto, Sorocaba, Sao Jose dos Campos. {BASE}",
]

BR_PROMPTS = [
    f"Liste 40 empresas GRANDES e MEDIAS de tecnologia em diferentes estados brasileiros (SP, RJ, MG, RS, PR, SC). {BASE}",
    f"Liste 40 empresas PEQUENAS de tecnologia em diferentes estados brasileiros. {BASE}",
    f"Liste 40 empresas de tecnologia no Brasil, subsegmentos variados: SaaS, fintech, software, hardware. {BASE}",
    f"Liste 40 empresas de tecnologia distribuidas pelo Brasil: Sao Paulo, Rio de Janeiro, Belo Horizonte, Porto Alegre, Curitiba, Florianopolis, Recife, Salvador. {BASE}",
]

def test(label, prompts):
    results = []
    for i, p in enumerate(prompts):
        r = call(p)
        print(f"  Chamada {i+1}: {len(r)} empresas")
        results.append(r)

    seen = set()
    companies = []
    for r in results:
        for c in r:
            k = (c.get("legal_name") or "").lower().strip()
            if k and k not in seen:
                seen.add(k)
                companies.append(c)
    return companies

print("=== SP — tecnologia ===")
sp = test("SP", SP_PROMPTS)
print(f"\nTotal SP: {len(sp)} empresas unicas")
for c in sp[:8]:
    print(f"  - {c.get('legal_name','')} | {c.get('city','')} | {c.get('company_size','')}")

print("\n=== Brasil todo — tecnologia ===")
br = test("Brasil", BR_PROMPTS)
print(f"\nTotal Brasil: {len(br)} empresas unicas")
for c in br[:8]:
    print(f"  - {c.get('legal_name','')} | {c.get('state','')} - {c.get('city','')} | {c.get('company_size','')}")

print(f"\n--- Resumo ---")
print(f"SP:     {len(sp)} empresas")
print(f"Brasil: {len(br)} empresas")
