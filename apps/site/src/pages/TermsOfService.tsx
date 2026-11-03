import React from "react";
import { Link } from "react-router-dom";

export default function TermsOfService() {
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
        <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Termos de Uso</h1>
        <p style={{ color: "#6b7280", marginBottom: 40 }}>Última atualização: junho de 2026</p>

        <Section title="1. Aceitação dos termos">
          <p>
            Estes Termos de Uso ("Termos") regem o acesso e a utilização da plataforma Limo
            ("Limo", "plataforma", "nós"), incluindo o aplicativo web, a extensão para navegador
            e quaisquer serviços relacionados. Ao criar uma conta ou usar a plataforma, você
            ("usuário", "você") declara ter lido, compreendido e concordado com estes Termos e com
            a nossa <Link to="/privacidade" style={{ color: "#6366f1" }}>Política de Privacidade</Link>.
            Se você utiliza o Limo em nome de uma empresa, declara ter poderes para vinculá-la a estes Termos.
          </p>
        </Section>

        <Section title="2. Descrição do serviço">
          <p>
            O Limo é uma plataforma de Sales Engagement voltada para equipes de pré-vendas e vendas B2B.
            Oferecemos ferramentas para descoberta e enriquecimento de dados de contatos comerciais,
            organização de prospecção, análise de abordagens e geração de conteúdo com apoio de
            inteligência artificial.
          </p>
          <p>
            Os dados de contato disponibilizados são obtidos de fontes públicas (como a Receita Federal
            e perfis públicos do LinkedIn) e de provedores terceiros licenciados. O Limo é uma ferramenta
            de apoio à prospecção e não garante a precisão, atualidade ou disponibilidade de qualquer
            dado específico.
          </p>
        </Section>

        <Section title="3. Cadastro e conta">
          <ul>
            <li>Você deve fornecer informações verdadeiras, completas e atualizadas no cadastro.</li>
            <li>Você é responsável por manter a confidencialidade da sua senha e por toda atividade realizada na sua conta.</li>
            <li>Contas de equipe podem ser administradas por um gestor, que define os acessos dos demais membros.</li>
            <li>É necessário ter capacidade civil plena e atuar em contexto profissional/empresarial para usar a plataforma.</li>
          </ul>
        </Section>

        <Section title="4. Planos, assinatura e pagamento">
          <p>
            O Limo é oferecido em planos de assinatura mensal e em pacotes avulsos de créditos. Os preços,
            limites de uso (incluindo cotas de personas e enriquecimento) e funcionalidades de cada plano são
            apresentados no momento da contratação.
          </p>
          <ul>
            <li><strong>Cobrança:</strong> os pagamentos são processados pela Stripe. Ao assinar, você autoriza a cobrança recorrente no método de pagamento informado, até o cancelamento.</li>
            <li><strong>Renovação:</strong> as assinaturas são renovadas automaticamente a cada ciclo, pelo valor vigente, salvo cancelamento prévio.</li>
            <li><strong>Pacotes avulsos:</strong> créditos adicionais adquiridos de forma avulsa são de uso único e não são reembolsáveis após o consumo.</li>
            <li><strong>Período de teste:</strong> quando oferecido, o período de teste pode ter limites reduzidos de uso e ser encerrado a qualquer momento.</li>
            <li><strong>Reajustes:</strong> podemos alterar preços e limites mediante aviso prévio; alterações valem a partir do ciclo seguinte.</li>
          </ul>
        </Section>

        <Section title="5. Cancelamento e reembolso">
          <p>
            Você pode cancelar a assinatura a qualquer momento; o acesso permanece ativo até o fim do
            ciclo já pago, sem cobranças futuras. Não há reembolso proporcional de períodos já iniciados,
            salvo quando exigido pela legislação aplicável (incluindo o direito de arrependimento de 7 dias
            previsto no Código de Defesa do Consumidor, quando cabível).
          </p>
        </Section>

        <Section title="6. Uso aceitável">
          <p>Ao usar o Limo, você concorda em NÃO:</p>
          <ul>
            <li>Utilizar os dados obtidos para finalidades ilícitas, fraudulentas ou que violem a LGPD.</li>
            <li>Enviar comunicações em massa não solicitadas (spam) em desacordo com a legislação.</li>
            <li>Revender, redistribuir ou replicar em base própria os dados obtidos pela plataforma fora do uso previsto.</li>
            <li>Tentar burlar limites de uso, cotas, segurança ou realizar engenharia reversa da plataforma.</li>
            <li>Usar a extensão ou a API de forma automatizada abusiva que sobrecarregue os serviços ou de terceiros.</li>
            <li>Compartilhar sua conta com terceiros não autorizados.</li>
          </ul>
        </Section>

        <Section title="7. Responsabilidade pelo uso dos dados (LGPD)">
          <p>
            O Limo disponibiliza dados de contato comercial para apoiar a prospecção B2B legítima.
            <strong> Você é o responsável (controlador) pelo tratamento que faz desses dados</strong> nas suas
            ações de prospecção, devendo observar a Lei Geral de Proteção de Dados (Lei nº 13.709/2018),
            em especial: utilizar base legal adequada (como o legítimo interesse para prospecção), respeitar
            pedidos de oposição e exclusão dos titulares, e não empregar os dados para finalidades incompatíveis
            (como concessão de crédito, cobrança ou discriminação).
          </p>
          <p>
            O Limo atua como fornecedor da ferramenta e de dados de fontes públicas e licenciadas, não se
            responsabilizando pelo uso indevido que o usuário venha a fazer das informações.
          </p>
        </Section>

        <Section title="8. Propriedade intelectual">
          <p>
            A plataforma, sua marca, código, design e conteúdos são de propriedade do Limo e protegidos por lei.
            Concedemos a você uma licença limitada, não exclusiva e intransferível para usar a plataforma conforme
            estes Termos. Os dados que você insere manualmente (anotações, listas, contatos do seu CRM) permanecem seus.
          </p>
        </Section>

        <Section title="9. Disponibilidade do serviço">
          <p>
            Empenhamo-nos em manter a plataforma disponível e estável, mas não garantimos operação ininterrupta.
            Podemos realizar manutenções, atualizações ou suspender temporariamente o serviço. Provedores de dados
            terceiros podem ter janelas de indisponibilidade próprias que afetam certas funcionalidades.
          </p>
        </Section>

        <Section title="10. Limitação de responsabilidade">
          <p>
            Na máxima extensão permitida pela lei, o Limo não se responsabiliza por danos indiretos, lucros
            cessantes, perda de oportunidades de negócio ou decisões comerciais tomadas com base nos dados
            fornecidos. Nossa responsabilidade total, em qualquer hipótese, limita-se ao valor pago por você
            nos 12 meses anteriores ao evento que originou a reclamação.
          </p>
        </Section>

        <Section title="11. Suspensão e rescisão">
          <p>
            Podemos suspender ou encerrar o acesso de contas que violem estes Termos, a legislação aplicável ou
            que apresentem risco à segurança da plataforma ou de terceiros. Você pode encerrar sua conta a
            qualquer momento solicitando por e-mail. Após o encerramento, tratamos seus dados conforme a
            <Link to="/privacidade" style={{ color: "#6366f1" }}> Política de Privacidade</Link>.
          </p>
        </Section>

        <Section title="12. Alterações nos termos">
          <p>
            Podemos atualizar estes Termos periodicamente. Quando houver alterações relevantes, notificaremos por
            e-mail ou aviso no painel. O uso continuado da plataforma após as alterações implica aceite dos novos Termos.
          </p>
        </Section>

        <Section title="13. Lei aplicável e foro">
          <p>
            Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro do domicílio
            do usuário consumidor para dirimir eventuais controvérsias, quando aplicável a legislação consumerista;
            nos demais casos, o foro da comarca da sede do Limo.
          </p>
        </Section>

        <div style={{ marginTop: 48, paddingTop: 24, borderTop: "1px solid #e5e7eb", color: "#6b7280", fontSize: 14 }}>
          <p>Dúvidas? Entre em contato: <a href="mailto:contato@limoapp.com.br" style={{ color: "#6366f1" }}>contato@limoapp.com.br</a></p>
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
