import React from "react";
import { Link } from "react-router-dom";

export default function PrivacyPolicy() {
  return (
    <div style={{ fontFamily: "Inter, sans-serif", color: "#1a1a2e", minHeight: "100vh", background: "#f8f9fb" }}>
      {/* Nav */}
      <nav style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "16px 0" }}>
        <div style={{ maxWidth: 800, margin: "0 auto", padding: "0 24px", display: "flex", alignItems: "center", gap: 16 }}>
          <Link to="/" style={{ textDecoration: "none" }}>
            <img src="/logo_dark.png" alt="Limo" style={{ height: 36, objectFit: "contain" }} />
          </Link>
        </div>
      </nav>

      {/* Content */}
      <main style={{ maxWidth: 800, margin: "0 auto", padding: "48px 24px 80px" }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Política de Privacidade</h1>
        <p style={{ color: "#6b7280", marginBottom: 40 }}>Última atualização: 11 de junho de 2026</p>

        <Section title="1. Quem somos e a quem isto se aplica">
          <p>
            A Limo é uma plataforma de Sales Engagement voltada a equipes de pré-vendas (BDRs), com
            ferramentas para enriquecimento de dados de contatos B2B, análise de chamadas de vendas e geração de
            conteúdo de prospecção. Esta Política descreve como coletamos, processamos, armazenamos e compartilhamos
            dados pessoais — tanto no aplicativo web quanto na <strong>extensão Limo para Google Chrome</strong>.
          </p>
          <p>
            Controlador dos dados: Limo. Contato do encarregado (DPO):{" "}
            <a href="mailto:contato@limoapp.com.br" style={{ color: "#6366f1" }}>contato@limoapp.com.br</a>.
          </p>
        </Section>

        <Section title="2. Coleta de dados">
          <p>Coletamos apenas os dados necessários para operar a plataforma:</p>
          <ul>
            <li><strong>Conta e autenticação:</strong> nome, e-mail e senha (hash bcrypt) e tokens de sessão.</li>
            <li><strong>Prospecção (extensão):</strong> nome, cargo, empresa e contato público de perfis do LinkedIn que você visualiza, lidos mediante sua ação.</li>
            <li><strong>CRM:</strong> empresas, contatos, anotações e listas que você cria ou salva.</li>
            <li><strong>Áudio e transcrições de chamadas:</strong> gravações que você envia para a função de análise de chamadas e suas transcrições.</li>
            <li><strong>Enriquecimento:</strong> documento (CNPJ/CPF) e dados cadastrais usados para enriquecer contatos, sob sua solicitação.</li>
            <li><strong>Técnicos:</strong> logs de acesso, eventos de erro e endereço IP, para segurança e estabilidade.</li>
          </ul>
          <p>Não coletamos dados de cartão (processados pela Stripe) nem dados sensíveis (raça, religião, saúde, orientação sexual). Não rastreamos sua navegação fora do contexto de uso da ferramenta.</p>
        </Section>

        <Section title="3. Processamento dos dados">
          <ul>
            <li>Fornecer, manter e melhorar a plataforma e a extensão.</li>
            <li>Preencher automaticamente o CRM com dados de perfis que você visualiza.</li>
            <li>Enriquecer dados de contato a partir de fontes públicas (ex.: Receita Federal) e provedor de dados cadastrais, quando você solicita.</li>
            <li>Transcrever e analisar chamadas de vendas que você envia, gerando recomendações de coaching.</li>
            <li>Gerar conteúdo de prospecção por IA, a partir do texto que você submete.</li>
            <li>Enviar comunicações do serviço e garantir segurança e cumprimento legal.</li>
          </ul>
          <p><strong>Base legal (LGPD):</strong> execução de contrato, legítimo interesse para prospecção B2B e obrigação legal. Você pode revogar o consentimento a qualquer momento. <strong>Não vendemos seus dados</strong> e não os usamos para publicidade.</p>
        </Section>

        <Section title="4. Armazenamento dos dados">
          <ul>
            <li><strong>Local:</strong> banco PostgreSQL gerenciado e cache Redis em nuvem (Railway, EUA); áudios em armazenamento de objetos compatível com S3.</li>
            <li><strong>Proteção:</strong> HTTPS/TLS, senhas com hash bcrypt, tokens e credenciais de integração criptografados em repouso, acesso restrito por variáveis de ambiente.</li>
            <li><strong>Retenção:</strong> mantidos enquanto a conta estiver ativa; cache de enriquecimento por até 90 dias; exclusão dos dados pessoais em até 30 dias após solicitação, salvo obrigação legal.</li>
            <li><strong>Extensão:</strong> apenas o token de sessão fica localmente no navegador (<code>chrome.storage</code>), removido ao sair.</li>
          </ul>
        </Section>

        <Section title="5. Compartilhamento dos dados">
          <p>Não vendemos nem alugamos seus dados. Compartilhamos apenas com operadores, para viabilizar o serviço, sob contratos compatíveis com a LGPD:</p>
          <ul>
            <li><strong>Railway</strong> — hospedagem da aplicação, banco e cache (EUA).</li>
            <li><strong>Armazenamento de objetos (S3)</strong> — guarda de áudios de chamadas (EUA).</li>
            <li><strong>Groq, OpenAI e Anthropic</strong> — transcrição e geração de conteúdo por IA; apenas o conteúdo que você submete (EUA).</li>
            <li><strong>Assertiva Soluções</strong> — enriquecimento de dados cadastrais B2B, sob sua solicitação (Brasil).</li>
            <li><strong>Stripe</strong> — processamento de pagamentos (EUA).</li>
            <li><strong>Resend</strong> — envio de e-mails transacionais (EUA).</li>
            <li><strong>HubSpot, Pipedrive e Salesforce</strong> — exportação para o seu CRM, somente quando você conecta e autoriza.</li>
          </ul>
          <p>Também poderemos divulgar dados se exigido por lei ou para proteger a segurança da plataforma. Há transferência internacional com salvaguardas adequadas.</p>
        </Section>

        <Section title="6. A extensão Limo para Chrome">
          <p>
            <strong>Propósito único:</strong> ler informações de um perfil do LinkedIn que você está visualizando e
            preencher automaticamente o CRM da Limo, sem digitação manual.
          </p>
          <p>
            A extensão opera exclusivamente em páginas do LinkedIn. Ela não acessa outras abas, não lê dados de outros
            sites e não transmite informações sem ação explícita sua. Os dados coletados seguem o tratamento das seções
            3 a 5. <strong>Não vendemos, alugamos nem transferimos esses dados a terceiros para fins não relacionados ao
            propósito único da extensão.</strong>
          </p>
          <p>Permissões solicitadas:</p>
          <ul>
            <li><code>storage</code> — armazena o token de sessão localmente.</li>
            <li><code>sidePanel</code> — exibe o painel lateral sem nova aba.</li>
            <li><code>tabs</code> — identifica se a aba ativa é o LinkedIn.</li>
            <li><code>offscreen</code> — processamento em segundo plano do painel.</li>
            <li>Host <code>linkedin.com</code> — leitura do perfil visível.</li>
            <li>Host <code>api.limoapp.com.br</code> — sincronização com sua conta Limo.</li>
          </ul>
        </Section>

        <Section title="7. Cookies e rastreamento">
          <p>Usamos apenas cookies e armazenamento local estritamente necessários para autenticação e sessão. Não usamos cookies de publicidade nem rastreadores de marketing de terceiros.</p>
        </Section>

        <Section title="8. Seus direitos (LGPD)">
          <p>Conforme a Lei nº 13.709/2018, você tem direito a confirmar tratamento, acessar, corrigir, anonimizar, portar ou excluir seus dados e revogar consentimento a qualquer momento.</p>
          <p>
            Para exercer esses direitos:{" "}
            <a href="mailto:contato@limoapp.com.br" style={{ color: "#6366f1" }}>contato@limoapp.com.br</a>
          </p>
        </Section>

        <Section title="9. Crianças">
          <p>A Limo é uma ferramenta profissional B2B, não direcionada a menores de 18 anos. Não coletamos intencionalmente dados de crianças ou adolescentes.</p>
        </Section>

        <Section title="10. Alterações nesta política">
          <p>Podemos atualizar esta política periodicamente. Alterações relevantes serão comunicadas por e-mail ou aviso no painel, com atualização da data no topo.</p>
        </Section>

        <div style={{ marginTop: 48, paddingTop: 24, borderTop: "1px solid #e5e7eb", color: "#6b7280", fontSize: 14 }}>
          <p>Dúvidas ou solicitações? <a href="mailto:contato@limoapp.com.br" style={{ color: "#6366f1" }}>contato@limoapp.com.br</a></p>
          <p style={{ marginTop: 8 }}><Link to="/" style={{ color: "#6366f1" }}>← Voltar para o início</Link></p>
        </div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 36 }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12, color: "#1a1a2e" }}>{title}</h2>
      <div style={{ lineHeight: 1.7, color: "#374151", display: "flex", flexDirection: "column", gap: 10 }}>
        {children}
      </div>
    </section>
  );
}
