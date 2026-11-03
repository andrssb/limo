#!/usr/bin/env python3
import os, urllib.request, json, time, sys

KEY = os.environ["GROQ_API_KEY"]
URL = "https://api.groq.com/openai/v1/chat/completions"

def call(prompt):
    body = json.dumps({
        "model": "llama-3.1-8b-instant",
        "max_tokens": 2500,
        "response_format": {"type": "json_object"},
        "messages": [{"role": "user", "content": prompt}]
    }).encode("utf-8")
    req = urllib.request.Request(URL, data=body, headers={
        "Authorization": f"Bearer {KEY}",
        "Content-Type": "application/json"
    })
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            d = json.loads(r.read().decode("utf-8"))
            content = d["choices"][0]["message"]["content"]
            return json.loads(content).get("companies", [])
    except Exception as e:
        print(f"  [erro: {e}]", file=sys.stderr)
        return []

def dedupe(lists):
    seen = set()
    result = []
    for r in lists:
        for c in r:
            k = (c.get("legal_name") or "").lower().strip()
            if k and k not in seen:
                seen.add(k)
                result.append(c)
    return result

base = 'Responda APENAS em JSON com o campo "companies" (array). Cada item: {"legal_name":"Razão Social Ltda","trade_name":"Nome ou null","state":"UF","city":"Cidade","company_size":"MEI|ME|EPP|MEDIO|GRANDE"}'

# ── SP ───────────────────────────────────────────────────────────────────────
sp_prompts = [
    f'Liste 40 empresas brasileiras GRANDES e MÉDIAS do setor tecnologia no estado SP. CNAEs: 6201-5, 6202-3. {base}',
    f'Liste 40 empresas brasileiras PEQUENAS (MEI/ME/EPP) de tecnologia no estado SP. Cidades: São Paulo, Campinas, Santos, Sorocaba, São José dos Campos. {base}',
    f'Liste 40 empresas de tecnologia em SP - subsegmentos: SaaS, fintech, software B2B, hardware, telecom. {base}',
    f'Liste 40 empresas de tecnologia distribuídas pelo estado de SP: São Paulo, Campinas, Santos, Ribeirão Preto, Sorocaba, São José dos Campos, Osasco. {base}',
]

print("Testando SP — tecnologia (4 chamadas)...")
sp_results = []
for i, p in enumerate(sp_prompts):
    r = call(p)
    print(f"  Chamada {i+1}: {len(r)} empresas")
    sp_results.append(r)
    time.sleep(0.4)

sp = dedupe(sp_results)
print(f"\n=== SP: {len(sp)} empresas únicas ===")
for c in sp[:10]:
    print(f"  - {c.get('legal_name','')} | {c.get('city','')} | {c.get('company_size','')}")

# ── Brasil ───────────────────────────────────────────────────────────────────
br_prompts = [
    f'Liste 40 empresas brasileiras GRANDES e MÉDIAS do setor tecnologia em diferentes estados. {base}',
    f'Liste 40 empresas brasileiras PEQUENAS (MEI/ME/EPP) de tecnologia em diferentes estados brasileiros. {base}',
    f'Liste 40 empresas brasileiras de tecnologia - subsegmentos variados (SaaS, fintech, software, hardware) em diferentes estados. {base}',
    f'Liste 40 empresas de tecnologia distribuídas pelo Brasil: São Paulo, Rio de Janeiro, Belo Horizonte, Porto Alegre, Curitiba, Florianópolis, Recife, Salvador, Fortaleza, Manaus. {base}',
]

print("\nTestando Brasil todo — tecnologia (4 chamadas)...")
br_results = []
for i, p in enumerate(br_prompts):
    r = call(p)
    print(f"  Chamada {i+1}: {len(r)} empresas")
    br_results.append(r)
    time.sleep(0.4)

br = dedupe(br_results)
print(f"\n=== Brasil: {len(br)} empresas únicas ===")
for c in br[:10]:
    print(f"  - {c.get('legal_name','')} | {c.get('state','')} - {c.get('city','')} | {c.get('company_size','')}")

print(f"\nResumo:")
print(f"  SP (tecnologia):     {len(sp)} empresas")
print(f"  Brasil (tecnologia): {len(br)} empresas")
