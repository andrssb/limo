import React, { useState } from "react";
import { Link } from "react-router-dom";
import {
  Link2, ListChecks, Building2, LayoutDashboard, Download,
  Mic2, Target, TrendingUp, Trophy, BellRing, BarChart3,
  Users, BookOpen, Cpu,
} from "lucide-react";

const APP_URL = "https://app.limoapp.com.br";

// WhatsApp do Victor — é o CTA principal do site. Trocar o número AQUI muda
// todos os botões da página de uma vez.
// Formato: 55 + DDD + número, só dígitos.
const WHATSAPP_NUMERO = "5500000000000"; // número de exemplo
const WHATSAPP_TEXTO  = "Oi Victor, vim pelo site da Limo. Queria entender como funciona.";
const WHATSAPP_URL    = `https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent(WHATSAPP_TEXTO)}`;

function Navbar() {
  return (
    <nav className="navbar">
      <div className="container navbar-inner">
        <div className="navbar-logo">
          <img src="/logo.png" alt="Limo" style={{ width: 180, height: 72, objectFit: "contain" }} />
        </div>
        <div className="navbar-links">
          <a href="#produto">Produto</a>
          <a href="#como-funciona">Como funciona</a>
          <a href="#funcionalidades">Funcionalidades</a>
          <a href="#resultados">Resultados</a>
        </div>
        <div className="navbar-cta">
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="btn-primary" style={{ padding: "9px 18px", fontSize: "13px" }}>
            Falar no WhatsApp
          </a>
          <a href={APP_URL} className="btn-primary" style={{ padding: "9px 18px", fontSize: "13px" }}>
            Entrar
          </a>
          <Link to="/cadastro" className="btn-primary" style={{ padding: "9px 18px", fontSize: "13px" }}>
            Teste grátis
          </Link>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section className="hero">
      <div className="container hero-inner">
        <div>
          <div className="hero-badge">7 dias grátis · sem cartão</div>
          <h1>
            Inteligência comercial<br />
            para <em>pré-vendas.</em>
          </h1>
          <p className="hero-sub">
            O Limo mostra ao seu time com quais empresas falar, quem decide dentro
            de cada uma e como chegar nessa pessoa. Quem fala com o cliente continua
            sendo o seu time — o que muda é para quem.
          </p>
          <div className="hero-actions">
            <Link to="/cadastro" className="btn-primary">
              Começar trial grátis →
            </Link>
            <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="btn-outline">
              Falar no WhatsApp
            </a>
          </div>
          <p className="hero-trial-note">7 dias grátis · Sem cartão de crédito · Cancele quando quiser</p>
        </div>

        <div className="hero-visual">
          <div className="hero-visual-header">
            <div className="hero-dot" style={{ background: "#ef4444" }} />
            <div className="hero-dot" style={{ background: "#f59e0b" }} />
            <div className="hero-dot" style={{ background: "#a3e635" }} />
            <span style={{ marginLeft: 8, fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
              app.limoapp.com.br
            </span>
          </div>
          <div className="hero-stat-grid">
            <div className="hero-stat">
              <div className="hero-stat-val">147</div>
              <div className="hero-stat-label">Leads qualificados</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-val">38%</div>
              <div className="hero-stat-label">Taxa de conversão</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-val">23</div>
              <div className="hero-stat-label">Reuniões agendadas</div>
            </div>
            <div className="hero-stat">
              <div className="hero-stat-val">82%</div>
              <div className="hero-stat-label">Meta do mês</div>
            </div>
          </div>
          {[
            { label: "LinkedIn", pct: 78 },
            { label: "Sites", pct: 54 },
            { label: "Garimpo", pct: 91 },
          ].map(({ label, pct }) => (
            <div className="hero-bar-row" key={label}>
              <span className="hero-bar-label">{label}</span>
              <div className="hero-bar-track">
                <div className="hero-bar-fill" style={{ width: `${pct}%` }} />
              </div>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", width: 30 }}>{pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function StatsBar() {
  return (
    <div className="stats-bar">
      <div className="container stats-bar-inner">
        {[
          { val: "Decisor", label: "com nome e cargo, não um contato genérico" },
          { val: "Celular", label: "e não o telefone da recepção" },
          { val: "CNPJ", label: "empresa que existe e está ativa" },
          { val: "CSV/CRM", label: "no processo que seu time já usa" },
        ].map(({ val, label }) => (
          <div className="stat-item" key={label}>
            <div className="stat-item-val">{val}</div>
            <div className="stat-item-label">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Product Preview ──────────────────────────────────────────────────────────

function MockSidebar({ active }: { active: string }) {
  const items = ["Dashboard", "Contatos", "Listas", "Descobrir", "Garimpo"];
  return (
    <div className="mock-sidebar">
      <div className="mock-sidebar-logo" />
      {items.map((item) => (
        <div key={item} className={`mock-nav-item${item === active ? " active" : ""}`}>
          <div className="mock-nav-icon" />
          <span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function MockDiscovery() {
  return (
    <div className="mock-app">
      <MockSidebar active="Descobrir" />
      <div className="mock-content">
        <div className="mock-topbar">
          <span className="mock-page-title">Descobrir empresas</span>
        </div>
        <div className="mock-discover-layout">
          <div className="mock-filters">
            <div className="mock-filter-group">
              <div className="mock-filter-label">Setor</div>
              <div className="mock-filter-select">Tecnologia da Informação</div>
            </div>
            <div className="mock-filter-group">
              <div className="mock-filter-label">Estado</div>
              <div className="mock-filter-select">São Paulo</div>
            </div>
            <div className="mock-filter-group">
              <div className="mock-filter-label">Porte</div>
              <div className="mock-filter-select">Médio porte</div>
            </div>
            <div className="mock-btn">Buscar empresas</div>
          </div>
          <div className="mock-results">
            <div className="mock-results-count">3.421 empresas encontradas</div>
            {[
              { name: "TechVision Sistemas", city: "São Paulo", cnae: "6201-5", size: "Médio" },
              { name: "DataCore Analytics", city: "Campinas", cnae: "6311-9", size: "Grande" },
              { name: "Innova Tech Solutions", city: "São Paulo", cnae: "6202-3", size: "Médio" },
              { name: "Nexus Digital", city: "São Paulo", cnae: "6209-1", size: "Pequeno" },
            ].map((c) => (
              <div className="mock-company-card" key={c.name}>
                <div className="mock-company-initial">{c.name[0]}</div>
                <div className="mock-company-info">
                  <div className="mock-company-name">{c.name}</div>
                  <div className="mock-company-meta">{c.city} · CNAE {c.cnae} · {c.size} porte</div>
                </div>
                <div className="mock-action-link">Adicionar →</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MockGarimpo() {
  return (
    <div className="mock-app">
      <MockSidebar active="Garimpo" />
      <div className="mock-content">
        <div className="mock-topbar">
          <span className="mock-page-title">Garimpo</span>
        </div>
        <div className="mock-garimpo-layout">
          <div className="mock-prompt-box">
            <div className="mock-filter-label" style={{ marginBottom: 8 }}>Descreva o perfil ideal do cliente</div>
            <div className="mock-prompt-text">
              "Empresas de tecnologia em São Paulo, com 50 a 200 funcionários, focadas em RH ou Recrutamento."
            </div>
            <div className="mock-btn mock-btn-green" style={{ alignSelf: "flex-start", marginTop: 4 }}>Iniciar Garimpo</div>
          </div>
          <div className="mock-garimpo-results">
            <div className="mock-results-count">127 contatos encontrados</div>
            {[
              { name: "Camila Ferreira", role: "Head de Recursos Humanos", co: "DataCore Analytics" },
              { name: "Marcos Oliveira", role: "CEO & Fundador", co: "TechVision Sistemas" },
              { name: "Ana Costa", role: "Diretora Comercial", co: "Innova Tech Solutions" },
            ].map((c) => (
              <div className="mock-contact-card" key={c.name}>
                <div className="mock-contact-avatar">
                  {c.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                </div>
                <div className="mock-contact-info">
                  <div className="mock-contact-name">{c.name}</div>
                  <div className="mock-contact-role">{c.role} · {c.co}</div>
                </div>
                <div className="mock-li-badge">in</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MockDashboard() {
  return (
    <div className="mock-app">
      <MockSidebar active="Dashboard" />
      <div className="mock-content">
        <div className="mock-topbar">
          <span className="mock-page-title">Dashboard</span>
        </div>
        <div className="mock-metrics">
          {[
            { label: "Ligações hoje", val: "24" },
            { label: "Contatos", val: "147" },
            { label: "Conversão", val: "38%" },
            { label: "Meta do mês", val: "82%" },
          ].map((m) => (
            <div className="mock-metric-card" key={m.label}>
              <div className="mock-metric-val">{m.val}</div>
              <div className="mock-metric-label">{m.label}</div>
            </div>
          ))}
        </div>
        <div className="mock-table-section">
          <div className="mock-table-title">Performance por membro</div>
          <table className="mock-table">
            <thead>
              <tr>
                <th>BDR</th>
                <th>Ligações</th>
                <th>Contatos</th>
                <th>Meta</th>
              </tr>
            </thead>
            <tbody>
              {[
                { name: "Ana Lima", calls: 18, contacts: 45, pct: 90 },
                { name: "Carlos Melo", calls: 12, contacts: 31, pct: 62 },
                { name: "Julia Rocha", calls: 21, contacts: 52, pct: 104 },
              ].map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{r.calls}</td>
                  <td>{r.contacts}</td>
                  <td>
                    <div className="mock-progress-wrap">
                      <div className="mock-progress">
                        <div
                          className="mock-progress-bar"
                          style={{
                            width: `${Math.min(r.pct, 100)}%`,
                            background: r.pct >= 100 ? "#a3e635" : "#3b82f6",
                          }}
                        />
                      </div>
                      <span style={{ fontSize: 11, color: "#64748b" }}>{r.pct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const PREVIEW_TABS = [
  { label: "Descobrir empresas", Screen: MockDiscovery },
  { label: "Garimpo", Screen: MockGarimpo },
  { label: "Painel de métricas", Screen: MockDashboard },
];

function ProductPreview() {
  const [tab, setTab] = useState(0);
  const { Screen } = PREVIEW_TABS[tab];

  return (
    <section className="preview-section" id="produto">
      <div className="container">
        <div className="section-header center">
          <div className="section-label">Produto</div>
          <h2 className="section-title">Veja o Limo em ação</h2>
          <p className="section-sub">Interface limpa, fluxo intuitivo, resultado desde o primeiro dia.</p>
        </div>

        <div className="preview-tabs-row">
          {PREVIEW_TABS.map((t, i) => (
            <button
              key={i}
              className={`preview-tab${tab === i ? " active" : ""}`}
              onClick={() => setTab(i)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="preview-window">
          <div className="preview-chrome">
            <div className="preview-chrome-dots">
              <span style={{ background: "#ef4444" }} />
              <span style={{ background: "#f59e0b" }} />
              <span style={{ background: "#a3e635" }} />
            </div>
            <div className="preview-chrome-url">app.limoapp.com.br</div>
          </div>
          <Screen />
        </div>
      </div>
    </section>
  );
}

// ─── How it works ─────────────────────────────────────────────────────────────

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Defina o perfil que você vende",
      desc: "Descreva o cliente ideal — setor, porte, região. O Limo cruza a base de empresas e devolve as que batem com esse perfil, não uma lista genérica de CNPJs.",
    },
    {
      n: "02",
      title: "Descubra quem decide",
      desc: "Em cada empresa, o Limo identifica o responsável pela área que você atende: nome, cargo e o caminho até ele — celular e e-mail verificados.",
    },
    {
      n: "03",
      title: "Seu time trabalha a lista",
      desc: "Exporte para o CRM ou trabalhe direto no painel. O gestor acompanha o que o time fez com a lista: quais empresas avançaram e onde o processo trava.",
    },
  ];

  return (
    <section className="section" id="como-funciona">
      <div className="container">
        <div className="section-header center">
          <div className="section-label">Como funciona</div>
          <h2 className="section-title">Da dúvida "com quem falar?" à conversa certa</h2>
          <p className="section-sub">Três etapas. Nenhuma delas envia mensagem no seu lugar.</p>
        </div>
        <div className="steps-grid">
          {steps.map((s, i) => (
            <div className="step-card" key={s.n} style={{ position: "relative" }}>
              <div className="step-number">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
              {i < steps.length - 1 && <div className="step-arrow">→</div>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Features ─────────────────────────────────────────────────────────────────

type Feature = {
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; color?: string }>;
  title: string;
  desc: string;
  badge?: string;
};

const FEATURES_CORE: Feature[] = [
  { Icon: Link2,           title: "Pesquisa no LinkedIn", desc: "Enquanto seu time pesquisa no LinkedIn, o Limo guarda nome, cargo e empresa na lista. Você navega, ele organiza." },
  { Icon: ListChecks,      title: "Listas segmentadas",   desc: "Separe por cargo, setor ou região e saiba exatamente qual lista pertence a qual frente de venda." },
  { Icon: Building2,       title: "Descobrir empresas",   desc: "Filtre a base de empresas brasileiras do Limo por setor, região e porte, com dado cadastral verificado." },
  { Icon: LayoutDashboard, title: "Dashboard pessoal",    desc: "Acompanhe o que foi feito com cada lista: contatos trabalhados, empresas que avançaram e evolução semanal." },
  { Icon: Download,        title: "Exportar lista (CSV)", desc: "Leve a lista pro CRM que seu time já usa. O Limo entra no seu processo, não substitui ele." },
];

const FEATURES_METRICS_EXTRAS: Feature[] = [
  { Icon: Mic2,      title: "Coaching ao vivo com IA",       desc: "A IA analisa suas ligações em tempo real e sugere respostas para objeções na hora.", badge: "IA" },
  { Icon: Target,    title: "Metas por membro",               desc: "Defina metas individuais para cada BDR e acompanhe o progresso em tempo real." },
  { Icon: TrendingUp,title: "Relatório semanal IA",           desc: "Toda sexta, um relatório inteligente sobre gargalos, destaques e ações recomendadas.", badge: "IA" },
  { Icon: Trophy,    title: "Ranking do time",                desc: "Gamificação por conversão: BDRs competem de forma saudável e ficam mais engajados." },
  { Icon: BellRing,  title: "Alertas de performance",         desc: "Notificação automática quando um BDR está em risco de não bater a meta." },
  { Icon: BarChart3, title: "Painel Head — visão estratégica", desc: "Funil agregado, análise de ICP, fontes de lead e forecast de prospecção do time.", badge: "Exclusivo" },
];

const FEATURES_BUSINESS_EXTRAS: Feature[] = [
  { Icon: Users,    title: "Multi-time / multi-unidade", desc: "Gerencie múltiplos times comerciais em uma só conta, com hierarquia de gestores e relatórios consolidados.", badge: "Business" },
  { Icon: BookOpen, title: "Onboarding dedicado",        desc: "Sessão de implementação com especialista Limo, treinamento do time e configuração inicial sob medida.", badge: "Business" },
];

function garimpoCard(personas: number, empresas: number): Feature {
  return {
    Icon: Cpu,
    title: "Garimpo",
    desc: `Descreva o perfil de cliente e receba até ${personas} decisores em ${empresas} empresas por mês, com celular e e-mail verificados.`,
  };
}

const PLANS = {
  start:    { label: "Plano Start",    features: [garimpoCard(220, 300), ...FEATURES_CORE] },
  metrics:  { label: "Plano Metrics",  features: [garimpoCard(500, 700), ...FEATURES_CORE, ...FEATURES_METRICS_EXTRAS] },
  business: { label: "Plano Business", features: [garimpoCard(600, 1000), ...FEATURES_CORE, ...FEATURES_METRICS_EXTRAS, ...FEATURES_BUSINESS_EXTRAS] },
} as const;

type PlanKey = keyof typeof PLANS;

function Features() {
  const [activeTab, setActiveTab] = useState<PlanKey>("start");
  const features = PLANS[activeTab].features;

  return (
    <section className="section features-section" id="funcionalidades">
      <div className="container">
        <div className="section-header">
          <div className="section-label">Funcionalidades</div>
          <h2 className="section-title">O que o seu time de pré-venda recebe</h2>
          <p className="section-sub">Veja o que tem em cada plano. Para conhecer os valores, chame a gente no WhatsApp.</p>
        </div>

        <div className="plans-tabs">
          {(Object.keys(PLANS) as PlanKey[]).map((key) => (
            <button
              key={key}
              className={`plan-tab ${activeTab === key ? "active" : ""}`}
              onClick={() => setActiveTab(key)}
            >
              {PLANS[key].label}
            </button>
          ))}
        </div>

        <div className="features-grid">
          {features.map((f) => (
            <div className="feature-card" key={f.title}>
              <div className="feature-icon">
                <f.Icon size={20} strokeWidth={2} color="#4a7c00" />
              </div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
              {f.badge && <div className="feature-badge">{f.badge}</div>}
            </div>
          ))}
        </div>

        <div style={{ textAlign: "center", marginTop: 40 }}>
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="btn-primary" style={{ fontSize: 15 }}>
            Falar sobre valores no WhatsApp →
          </a>
        </div>
      </div>
    </section>
  );
}

// ─── Results ──────────────────────────────────────────────────────────────────

function Results() {
  const cards = [
    {
      metric: "Celular",
      title: "em vez do telefone da portaria",
      desc: "Lista raspada de mapa entrega o número da recepção, que ninguém atende. O Limo entrega o contato de quem decide.",
    },
    {
      metric: "Decisor",
      title: "com nome, cargo e área",
      desc: "Não é 'o contato da empresa'. É a pessoa responsável pela área que você atende, identificada uma a uma.",
    },
    {
      metric: "Zero",
      title: "mensagem enviada no seu nome",
      desc: "O Limo não dispara nada. Quem fala com o cliente é o seu time — a ferramenta garante que a conversa comece com a pessoa certa.",
    },
    {
      metric: "CNPJ",
      title: "empresa que existe e está ativa",
      desc: "Dado cadastral verificado antes de entrar na lista. Seu BDR não perde o dia ligando para empresa que fechou.",
    },
    {
      metric: "Rampa",
      title: "sem as primeiras semanas garimpando",
      desc: "BDR novo costuma gastar as primeiras semanas montando lista. Com a lista pronta no primeiro dia, esse tempo vira conversa.",
    },
    {
      metric: "Gestor",
      title: "enxerga o que foi feito com a lista",
      desc: "Quais empresas avançaram, quais travaram e em que etapa. Visibilidade do processo, não só do número final.",
    },
  ];

  return (
    <section className="section results-section" id="resultados">
      <div className="container">
        <div className="section-header center">
          <div className="section-label">Resultados</div>
          <h2 className="section-title">O que muda quando o time usa o Limo</h2>
          <p className="section-sub">Não é volume de disparo. É qualidade de alvo.</p>
        </div>
        <div className="results-grid">
          {cards.map((c) => (
            <div className="result-card" key={c.metric}>
              <div className="result-metric">{c.metric}</div>
              <h3 className="result-title">{c.title}</h3>
              <p className="result-desc">{c.desc}</p>
            </div>
          ))}
        </div>
        <div style={{ textAlign: "center", marginTop: 48 }}>
          <Link to="/cadastro" className="btn-primary" style={{ fontSize: 16, padding: "16px 32px", marginRight: 14 }}>
            Começar grátis por 7 dias →
          </Link>
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="btn-outline" style={{ fontSize: 15 }}>
            Falar no WhatsApp
          </a>
        </div>
      </div>
    </section>
  );
}

// ─── CTA ──────────────────────────────────────────────────────────────────────

function CtaSection() {
  return (
    <section className="cta-section">
      <div className="container">
        <h2>Seu BDR começa semana que vem. <em>A lista dele já existe?</em></h2>
        <p>Comece hoje e ele entra com a lista pronta, em vez de montar do zero.</p>
        <div className="cta-actions">
          <Link to="/cadastro" className="btn-primary" style={{ fontSize: 16, padding: "16px 32px" }}>
            Começar trial grátis →
          </Link>
          <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className="btn-outline" style={{ fontSize: 15, borderColor: "rgba(163,230,53,0.5)", color: "var(--green)" }}>
            Falar no WhatsApp
          </a>
        </div>
        <p className="cta-note">7 dias grátis · Sem cartão · Cancele quando quiser</p>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-inner">
          <div>
            <div className="footer-logo">
              <img src="/logo_dark.png" alt="Limo" style={{ width: 180, height: 72, objectFit: "contain" }} />
            </div>
            <div className="footer-tagline">Inteligência comercial para pré-vendas.</div>
          </div>
          <div className="footer-links">
            <h4>Produto</h4>
            <ul>
              <li><a href="#produto">Ver o produto</a></li>
              <li><a href="#funcionalidades">Funcionalidades</a></li>
              <li><Link to="/cadastro">Trial grátis</Link></li>
              <li><a href="/privacidade">Política de Privacidade</a></li>
              <li><a href="/termos">Termos de Uso</a></li>
            </ul>
          </div>
          <div className="footer-links">
            <h4>Conta</h4>
            <ul>
              <li><a href="https://app.limoapp.com.br">Acessar painel</a></li>
              <li><Link to="/cadastro">Criar conta</Link></li>
            </ul>
          </div>
          <div className="footer-links">
            <h4>Contato</h4>
            <ul>
              <li><a href="mailto:contato@limoapp.com.br">contato@limoapp.com.br</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          © {new Date().getFullYear()} Limo · Inteligência comercial para pré-vendas · <Link to="/privacidade">Política de Privacidade</Link> · <Link to="/termos">Termos de Uso</Link>
        </div>
      </div>
    </footer>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  return (
    <>
      <Navbar />
      <Hero />
      <StatsBar />
      <ProductPreview />
      <HowItWorks />
      <Features />
      <Results />
      <CtaSection />
      <Footer />
    </>
  );
}
