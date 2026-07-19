import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient } from "@supabase/supabase-js";
import {
  ArrowLeft,
  Bell,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  FileBarChart,
  FileText,
  Filter,
  HelpCircle,
  LayoutDashboard,
  Menu,
  Download,
  Eye,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  Save,
  TrendingUp,
  UploadCloud,
  UserRound,
  Users,
  X,
} from "lucide-react";
import "./style.css";

const API = "/api";
const supabaseClient =
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
    ? createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      )
    : null;

function aplicarAparencia(
  tema = localStorage.getItem("avanco-theme") || "sistema",
  cor = localStorage.getItem("avanco-primary-color") || "#087b66",
) {
  document.documentElement.dataset.theme = tema;
  document.documentElement.style.setProperty("--green", cor);
  document.documentElement.style.setProperty("--primary", cor);
}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (supabaseClient) {
    const { data } = await supabaseClient.auth.getSession();
    if (data.session?.access_token)
      headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  return fetch(url, { ...options, headers });
}

async function currentAccessContext() {
  const { data: authData } = await supabaseClient.auth.getUser();
  if (!authData.user) throw new Error("Sessão expirada");
  const { data: membership, error } = await supabaseClient
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", authData.user.id)
    .eq("active", true)
    .limit(1)
    .single();
  if (error) throw error;
  return {
    user: authData.user,
    organizationId: membership.organization_id,
    role: membership.role,
  };
}

async function compactarArquivo(file) {
  if (!('CompressionStream' in window) || file.size < 4096) return { conteudo: file, comprimido: false };
  try {
    const stream = file.stream().pipeThrough(new CompressionStream('gzip'));
    const comprimido = await new Response(stream).blob();
    return comprimido.size <= file.size * 0.9
      ? { conteudo: new Blob([comprimido], { type: 'application/gzip' }), comprimido: true }
      : { conteudo: file, comprimido: false };
  } catch { return { conteudo: file, comprimido: false }; }
}

async function uploadReservationDocuments(
  files,
  reservationId,
  personType,
  documentType,
) {
  const { user, organizationId } = await currentAccessContext();
  const uploaded = [];
  for (const file of files) {
    const { conteudo, comprimido } = await compactarArquivo(file);
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${organizationId}/${reservationId}/${crypto.randomUUID()}-${safeName}${comprimido ? '.gz' : ''}`;
    const { error: uploadError } = await supabaseClient.storage
      .from("reservation-documents")
      .upload(path, conteudo, { contentType: comprimido ? 'application/gzip' : file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { data, error } = await supabaseClient
      .from("reservation_documents")
      .insert({
        organization_id: organizationId,
        reservation_id: reservationId,
        person_type: personType || "Titular",
        document_type: documentType || "Documento adicional",
        file_name: file.name,
        storage_path: path,
        mime_type: file.type,
        size_bytes: conteudo.size,
        uploaded_by: user.id,
      })
      .select(
        "id, file_name, document_type, person_type, storage_path, mime_type, size_bytes, status, created_at",
      )
      .single();
    if (error) {
      await supabaseClient.storage.from("reservation-documents").remove([path]);
      throw error;
    }
    uploaded.push([data.file_name, data.document_type, data]);
  }
  return uploaded;
}

const formularioInicial = {
  reserva: "",
  cliente: "",
  corretor: "",
  imobiliaria: "Equipe Própria | CAT",
  telefone: "",
  creditu: true,
  etapaAtual: 0,
  status: "Em processo",
  prioridade: "verde",
  repasseMes: true,
  observacoes: "",
};

const gruposDocumentos = [
  {
    nome: "Documentação pessoal",
    documentos: [
      "RG/CPF do proponente",
      "Certidão de estado civil ou termo de união estável",
      "Comprovante de endereço",
      "Comprovante de renda ou extratos bancários",
      "Extrato do FGTS",
      "IRPF",
      "Recibo de renda",
      "Carteira de trabalho digital",
      "Autorização no aplicativo",
    ],
    regras: [
      "Renda formal: o extrato do FGTS é obrigatório.",
      "Renda informal: podem ser anexados IRPF e recibo.",
      "Mais de 3 anos de FGTS: carteira de trabalho digital e autorização no aplicativo são obrigatórias.",
    ],
  },
  {
    nome: "Documentos do cônjuge — se houver",
    documentos: [
      "RG/CPF do cônjuge",
      "Certidão civil do cônjuge em união estável",
      "Comprovante de renda do cônjuge",
    ],
    regras: ["A renda do cônjuge só é exigida quando ele possuir renda."],
  },
  {
    nome: "Dependente menor",
    documentos: ["Certidão de nascimento ou termo de adoção/guarda"],
  },
  {
    nome: "Dependente maior ou dependente até 3º grau",
    documentos: [
      "RG/CPF do dependente",
      "RG/CPF do cônjuge do dependente casado",
      "Certidão civil do dependente",
      "Declaração de parentesco",
    ],
  },
  {
    nome: "Formulários Caixa",
    documentos: [
      "DAMP",
      "Ficha de cadastro",
      "Ficha de abertura de conta",
      "MO",
      "Ficha de cheque especial",
      "Ficha de cartão de crédito",
    ],
  },
  {
    nome: "Kit Creditú",
    documentos: [
      "RG/CPF do proponente — Creditú",
      "RG/CPF do cônjuge — Creditú",
      "Certidão de estado civil — Creditú",
      "Comprovante de residência ou declaração de endereço modelo Creditú",
      "RG/CPF do segundo proponente",
      "RG/CPF do cônjuge do segundo proponente",
      "Tela SICAQ",
      "Tela de cadastro do proponente como associado",
      "Simulador Creditú",
    ],
  },
  {
    nome: "AGEHAB",
    documentos: [
      "RG/CPF do beneficiário",
      "RG/CPF do cônjuge — AGEHAB",
      "Certidão de estado civil — AGEHAB",
      "Comprovante de renda — AGEHAB",
      "Comprovante de renda do cônjuge ou declaração de não renda modelo AGEHAB",
      "Certidão de nascimento ou termo de adoção/guarda do dependente menor",
      "RG/CPF do dependente maior até 4º grau",
      "Certidão civil de dependentes maiores até 4º grau",
      "Renda ou declaração de não renda do dependente maior até 4º grau",
      "Comprovante de endereço ou declaração de endereço modelo AGEHAB",
      "RG/CPF do declarante — se houver",
      "Documento que comprove vínculo na cidade participante do programa",
    ],
  },
];

const vinculosDocumentos = [
  ['RG/CPF do proponente','RG/CPF do proponente — Creditú','RG/CPF do beneficiário'],
  ['RG/CPF do cônjuge','RG/CPF do cônjuge — Creditú','RG/CPF do cônjuge — AGEHAB'],
  ['Certidão de estado civil ou termo de união estável','Certidão civil do cônjuge em união estável','Certidão de estado civil — Creditú','Certidão de estado civil — AGEHAB'],
  ['Comprovante de endereço','Comprovante de residência ou declaração de endereço modelo Creditú','Comprovante de endereço ou declaração de endereço modelo AGEHAB'],
  ['Comprovante de renda ou extratos bancários','Comprovante de renda — AGEHAB'],
  ['Comprovante de renda do cônjuge','Comprovante de renda do cônjuge ou declaração de não renda modelo AGEHAB'],
  ['Certidão de nascimento ou termo de adoção/guarda','Certidão de nascimento ou termo de adoção/guarda do dependente menor'],
  ['RG/CPF do dependente','RG/CPF do dependente maior até 4º grau'],
  ['Certidão civil do dependente','Certidão civil de dependentes maiores até 4º grau']
];
const equivalentesDoDocumento = tipo => vinculosDocumentos.find(grupo => grupo.includes(tipo)) || [tipo];

function AuthGate() {
  const [session, setSession] = useState(supabaseClient ? undefined : null);
  const [mfaMode, setMfaMode] = useState(supabaseClient ? 'loading' : 'app');
  useEffect(() => {
    if (!supabaseClient) return;
    supabaseClient.auth
      .getSession()
      .then(({ data }) => setSession(data.session));
    const { data } = supabaseClient.auth.onAuthStateChange((_, nextSession) => {
      setMfaMode(nextSession ? 'loading' : 'app');
      setSession(nextSession);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!supabaseClient || !session) { if (!session) setMfaMode('app'); return; }
    let active = true;
    (async()=>{try{const factors=await supabaseClient.auth.mfa.listFactors();if(factors.error)throw factors.error;const verified=factors.data.totp.filter(f=>f.status==='verified');if(!active)return;if(!verified.length){setMfaMode('enroll');return}const aal=await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();if(aal.error)throw aal.error;setMfaMode(aal.data.currentLevel==='aal2'?'app':{type:'challenge',factorId:verified[0].id})}catch{if(active)setMfaMode('enroll')}})();
    return()=>{active=false};
  }, [session]);
  const reavaliarMfa = async()=>{setMfaMode('loading');const aal=await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();setMfaMode(aal.data?.currentLevel==='aal2'?'app':'loading');};
  if (supabaseClient && (session === undefined || mfaMode === 'loading'))
    return (
      <div className="auth-loading">
        <div className="brand-mark">
          <TrendingUp size={23} />
        </div>
        <span>Carregando Avanço...</span>
      </div>
    );
  if (supabaseClient && !session) return <AuthScreen />;
  if (supabaseClient && mfaMode === 'enroll') return <MfaEnroll onSuccess={reavaliarMfa}/>;
  if (supabaseClient && typeof mfaMode === 'object') return <MfaChallenge factorId={mfaMode.factorId} onSuccess={reavaliarMfa}/>;
  return <App />;
}

function MfaShell({ eyebrow, title, description, children }) {
  return <main className="mfa-page"><section className="mfa-card"><div className="mfa-shield"><CheckCircle2 size={26}/></div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p>{children}<button className="mfa-signout" onClick={()=>supabaseClient.auth.signOut()}>Sair da conta</button></section></main>;
}

function MfaEnroll({ onSuccess }) {
  const [factor,setFactor]=useState(null),[codigo,setCodigo]=useState(''),[erro,setErro]=useState(''),[enviando,setEnviando]=useState(false);
  useEffect(()=>{let active=true;(async()=>{try{const list=await supabaseClient.auth.mfa.listFactors();for(const item of list.data?.all||[]){if(item.status!=='verified')await supabaseClient.auth.mfa.unenroll({factorId:item.id})}const result=await supabaseClient.auth.mfa.enroll({factorType:'totp',friendlyName:'Microsoft Authenticator'});if(result.error)throw result.error;if(active)setFactor(result.data)}catch(error){if(active)setErro(error.message)}})();return()=>{active=false}},[]);
  async function ativar(e){e.preventDefault();if(!factor||codigo.length!==6)return;setEnviando(true);setErro('');const challenge=await supabaseClient.auth.mfa.challenge({factorId:factor.id});if(challenge.error){setErro(challenge.error.message);setEnviando(false);return}const verify=await supabaseClient.auth.mfa.verify({factorId:factor.id,challengeId:challenge.data.id,code:codigo});setEnviando(false);if(verify.error){setErro('Código inválido ou expirado. Tente novamente.');return}onSuccess()}
  return <MfaShell eyebrow="PROTEÇÃO DA CONTA" title="Ative o Microsoft Authenticator" description="Escaneie o QR Code no aplicativo Microsoft Authenticator e confirme o código de seis dígitos.">{factor?<form className="mfa-form" onSubmit={ativar}><div className="mfa-qr"><img src={factor.totp.qr_code} alt="QR Code para Microsoft Authenticator"/></div><ol><li>Abra o Microsoft Authenticator.</li><li>Toque em + e escolha “Outra conta”.</li><li>Escaneie o QR Code acima.</li></ol><label><span>Código de verificação</span><input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength="6" value={codigo} onChange={e=>setCodigo(e.target.value.replace(/\D/g,''))} placeholder="000000"/></label>{erro&&<div className="auth-feedback">{erro}</div>}<button className="primary-button" disabled={enviando||codigo.length!==6}>{enviando?'Validando...':'Ativar autenticação'}</button><details><summary>Não consegue escanear?</summary><code>{factor.totp.secret}</code></details></form>:<div className="mfa-preparing">{erro||'Preparando QR Code...'}</div>}</MfaShell>;
}

function MfaChallenge({ factorId, onSuccess }) {
  const [codigo,setCodigo]=useState(''),[erro,setErro]=useState(''),[enviando,setEnviando]=useState(false);
  async function verificar(e){e.preventDefault();setEnviando(true);setErro('');const challenge=await supabaseClient.auth.mfa.challenge({factorId});if(challenge.error){setErro(challenge.error.message);setEnviando(false);return}const verify=await supabaseClient.auth.mfa.verify({factorId,challengeId:challenge.data.id,code:codigo});setEnviando(false);if(verify.error){setErro('Código inválido ou expirado.');return}onSuccess()}
  return <MfaShell eyebrow="VERIFICAÇÃO EM DUAS ETAPAS" title="Digite o código do autenticador" description="Abra o Microsoft Authenticator e informe o código atual desta conta."><form className="mfa-form" onSubmit={verificar}><label><span>Código de seis dígitos</span><input autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength="6" value={codigo} onChange={e=>setCodigo(e.target.value.replace(/\D/g,''))} placeholder="000000"/></label>{erro&&<div className="auth-feedback">{erro}</div>}<button className="primary-button" disabled={enviando||codigo.length!==6}>{enviando?'Verificando...':'Validar e entrar'}</button></form></MfaShell>;
}

function AuthScreen() {
  const [cadastro, setCadastro] = useState(false);
  const [form, setForm] = useState({ nome: "", email: "", senha: "" });
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function enviar(e) {
    e.preventDefault();
    setErro("");
    setEnviando(true);
    const result = cadastro
      ? await supabaseClient.auth.signUp({
          email: form.email,
          password: form.senha,
          options: { data: { full_name: form.nome } },
        })
      : await supabaseClient.auth.signInWithPassword({
          email: form.email,
          password: form.senha,
        });
    setEnviando(false);
    if (result.error) setErro(result.error.message);
    else if (cadastro && !result.data.session)
      setErro("Cadastro realizado. Confirme seu e-mail para entrar.");
  }
  return (
    <main className="auth-page">
      <section className="auth-brand">
        <div className="brand-mark">
          <TrendingUp size={28} />
        </div>
        <span className="eyebrow">GESTÃO COMERCIAL</span>
        <h1>
          Controle cada etapa.
          <br />
          Acelere cada venda.
        </h1>
        <p>
          Reservas, crédito, documentos e repasses em uma plataforma segura.
        </p>
      </section>
      <section className="auth-card">
        <div>
          <span className="eyebrow">BEM-VINDO AO AVANÇO</span>
          <h2>{cadastro ? "Criar sua conta" : "Acessar plataforma"}</h2>
          <p>
            {cadastro
              ? "O primeiro usuário será o administrador da organização."
              : "Entre com suas credenciais corporativas."}
          </p>
        </div>
        <form onSubmit={enviar}>
          {cadastro && (
            <label>
              <span>Nome completo</span>
              <input
                required
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Seu nome"
              />
            </label>
          )}
          <label>
            <span>E-mail</span>
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="nome@empresa.com.br"
            />
          </label>
          <label>
            <span>Senha</span>
            <input
              required
              minLength="8"
              type="password"
              value={form.senha}
              onChange={(e) => setForm({ ...form, senha: e.target.value })}
              placeholder="Mínimo de 8 caracteres"
            />
          </label>
          {erro && <div className="auth-feedback">{erro}</div>}
          <button className="primary-button" disabled={enviando}>
            {enviando ? "Aguarde..." : cadastro ? "Criar conta" : "Entrar"}
          </button>
        </form>
        <button
          className="auth-switch"
          onClick={() => {
            setCadastro(!cadastro);
            setErro("");
          }}
        >
          {cadastro
            ? "Já possui conta? Entrar"
            : "Primeiro acesso? Criar conta"}
        </button>
      </section>
    </main>
  );
}

function App() {
  const [clientes, setClientes] = useState([]);
  const [etapas, setEtapas] = useState([]);
  const [resumo, setResumo] = useState({});
  const [q, setQ] = useState("");
  const [imobiliaria, setImobiliaria] = useState("TODOS");
  const [form, setForm] = useState(formularioInicial);
  const [cadastroAberto, setCadastroAberto] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [clienteSelecionado, setClienteSelecionado] = useState(null);
  const [repasseSelecionado, setRepasseSelecionado] = useState(null);
  const [tela, setTela] = useState("clientes");
  const [sidebarRecolhida, setSidebarRecolhida] = useState(false);

  useEffect(() => {
    let timer;
    const reiniciar = () => {
      clearTimeout(timer);
      setSidebarRecolhida(false);
      timer = setTimeout(
        () => {
          if (window.innerWidth > 820) setSidebarRecolhida(true);
        },
        Number(localStorage.getItem("avanco-sidebar-idle") || 30) * 1000,
      );
    };
    ["mousemove", "keydown", "click", "scroll"].forEach((evento) =>
      window.addEventListener(evento, reiniciar, { passive: true }),
    );
    reiniciar();
    return () => {
      clearTimeout(timer);
      ["mousemove", "keydown", "click", "scroll"].forEach((evento) =>
        window.removeEventListener(evento, reiniciar),
      );
    };
  }, []);

  async function carregar() {
    const params = new URLSearchParams({ q, imobiliaria });
    setCarregando(true);
    try {
      const [lista, listaEtapas, dadosResumo] = await Promise.all([
        apiFetch(`${API}/clientes?${params}`).then((r) => r.json()),
        apiFetch(`${API}/etapas`).then((r) => r.json()),
        apiFetch(`${API}/resumo`).then((r) => r.json()),
      ]);
      setClientes(lista);
      setEtapas(listaEtapas);
      setResumo(dadosResumo);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, [q, imobiliaria]);
  useEffect(() => {
    aplicarAparencia();
  }, []);

  const imobiliarias = useMemo(
    () => [
      "TODOS",
      ...new Set(clientes.map((c) => c.imobiliaria).filter(Boolean)),
    ],
    [clientes],
  );

  async function criarCliente(e) {
    e.preventDefault();
    await apiFetch(`${API}/clientes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm(formularioInicial);
    setCadastroAberto(false);
    carregar();
  }

  async function atualizar(id, dados) {
    setClientes((atuais) =>
      atuais.map((c) => (c.id === id ? { ...c, ...dados } : c)),
    );
    await apiFetch(`${API}/clientes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(dados),
    });
    carregar();
  }

  async function excluir(id) {
    if (!confirm("Deseja realmente excluir este cliente?")) return;
    await apiFetch(`${API}/clientes/${id}`, { method: "DELETE" });
    carregar();
  }

  return (
    <div className="app-shell">
      <Sidebar
        aberto={menuAberto}
        recolhida={sidebarRecolhida}
        expandir={() => setSidebarRecolhida(false)}
        fechar={() => setMenuAberto(false)}
        tela={tela}
        navegar={(destino) => {
          setTela(destino);
          setClienteSelecionado(null);
          setRepasseSelecionado(null);
          setMenuAberto(false);
        }}
      />

      <div
        className={`workspace ${sidebarRecolhida ? "sidebar-collapsed" : ""}`}
      >
        <Topbar abrirMenu={() => setMenuAberto(true)} />

        <main className="page">
          {repasseSelecionado ? (
            <DetalheRepasse
              cliente={repasseSelecionado}
              voltar={() => setRepasseSelecionado(null)}
              atualizar={atualizar}
            />
          ) : clienteSelecionado ? (
            <DetalheReserva
              cliente={clienteSelecionado}
              etapas={etapas}
              voltar={() => setClienteSelecionado(null)}
              atualizar={atualizar}
            />
          ) : tela === "configuracoes" ? (
            <Configuracoes />
          ) : tela === "credito" ? (
            <RelatorioCredito
              clientes={clientes}
              atualizar={atualizar}
              abrir={setClienteSelecionado}
            />
          ) : tela === "relatorios" ? (
            <RelatoriosExecutivos clientes={clientes} />
          ) : tela === "visao" ? (
            <VisaoGeral
              clientes={clientes}
              etapas={etapas}
              abrirReserva={setClienteSelecionado}
              abrirRepasse={setRepasseSelecionado}
            />
          ) : tela === "reservas" ? (
            <Reservas
              clientes={clientes}
              etapas={etapas}
              abrir={setClienteSelecionado}
            />
          ) : tela === "repasses" ? (
            <Repasses
              clientes={clientes}
              etapas={etapas}
              abrir={setRepasseSelecionado}
            />
          ) : (
            <>
              <div className="breadcrumb">
                <span>Comercial</span>
                <ChevronRight size={14} />
                <span>Gestão de clientes</span>
              </div>
              <section className="page-heading">
                <div>
                  <span className="eyebrow">CARTEIRA COMERCIAL</span>
                  <h1>Gestão de clientes</h1>
                  <p>
                    Acompanhe reservas, crédito e repasses em uma visão
                    unificada.
                  </p>
                </div>
                <button
                  className="primary-button"
                  onClick={() => setCadastroAberto(true)}
                >
                  <Plus size={18} /> Novo cliente
                </button>
              </section>

              <section className="metric-grid">
                <MetricCard
                  icon={Users}
                  label="Clientes ativos"
                  value={resumo.total}
                  detail="Carteira atual"
                  tone="emerald"
                />
                <MetricCard
                  icon={CalendarDays}
                  label="Repasse no mês"
                  value={resumo.repasseMes}
                  detail="Prioridade do período"
                  tone="blue"
                />
                <MetricCard
                  icon={CircleDollarSign}
                  label="Com Creditú"
                  value={resumo.comCreditu}
                  detail="Em análise de crédito"
                  tone="violet"
                />
                <MetricCard
                  icon={ClipboardList}
                  label="Pendências"
                  value={resumo.pendentes}
                  detail="Requerem atenção"
                  tone="amber"
                />
                <MetricCard
                  icon={Check}
                  label="Finalizados"
                  value={resumo.finalizados}
                  detail="Vendas concluídas"
                  tone="green"
                />
              </section>

              {cadastroAberto && (
                <Cadastro
                  form={form}
                  setForm={setForm}
                  salvar={criarCliente}
                  fechar={() => setCadastroAberto(false)}
                />
              )}

              <section className="content-card">
                <div className="card-heading">
                  <div>
                    <h2>Carteira de clientes</h2>
                    <p>{clientes.length} registros encontrados</p>
                  </div>
                  <div className="view-actions">
                    <button title="Configurar visualização">
                      <SlidersHorizontal size={18} />
                    </button>
                    <button title="Mais opções">
                      <MoreHorizontal size={19} />
                    </button>
                  </div>
                </div>

                <div className="filters">
                  <label className="search-box">
                    <Search size={19} />
                    <input
                      aria-label="Pesquisar clientes"
                      placeholder="Buscar por reserva, cliente ou corretor"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                    />
                    <kbd>⌘ K</kbd>
                  </label>
                  <label className="select-box">
                    <Building2 size={18} />
                    <select
                      aria-label="Filtrar por imobiliária"
                      value={imobiliaria}
                      onChange={(e) => setImobiliaria(e.target.value)}
                    >
                      {imobiliarias.map((i) => (
                        <option key={i}>{i}</option>
                      ))}
                    </select>
                    <ChevronDown size={16} />
                  </label>
                  <button className="filter-button">
                    <Filter size={17} /> Mais filtros <span>2</span>
                  </button>
                </div>

                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Cliente / reserva</th>
                        <th>Origem</th>
                        <th>Etapa atual</th>
                        <th>Progresso</th>
                        <th>Prioridade</th>
                        <th>Status</th>
                        <th>Observações</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {carregando && !clientes.length ? (
                        <tr>
                          <td colSpan="8">
                            <div className="empty-state">
                              Carregando carteira...
                            </div>
                          </td>
                        </tr>
                      ) : (
                        clientes.map((c) => (
                          <ClienteRow
                            key={c.id}
                            cliente={c}
                            etapas={etapas}
                            atualizar={atualizar}
                            excluir={excluir}
                            abrir={setClienteSelecionado}
                          />
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="table-footer">
                  <span>
                    Mostrando {clientes.length} de{" "}
                    {resumo.total || clientes.length} clientes
                  </span>
                  <div>
                    <button disabled>Anterior</button>
                    <button className="page-number">1</button>
                    <button disabled>Próxima</button>
                  </div>
                </div>
              </section>
            </>
          )}
        </main>
      </div>
      <button className="chat-button" title="Falar com o suporte">
        <MessageCircle size={23} />
      </button>
    </div>
  );
}

function Sidebar({ aberto, recolhida, expandir, fechar, tela, navegar }) {
  const [usuario, setUsuario] = useState({ nome: "Usuário", cargo: "Equipe" });
  useEffect(() => {
    if (!supabaseClient) return;
    currentAccessContext()
      .then(({ user, role }) =>
        setUsuario({
          nome: user.user_metadata?.full_name || user.email || "Usuário",
          cargo:
            {
              owner: "Proprietário",
              admin: "Administrador",
              manager: "Gestor",
              analyst: "Analista",
              broker: "Corretor",
            }[role] || role,
        }),
      )
      .catch(() => {});
  }, []);
  const iniciais = usuario.nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0])
    .join("")
    .toUpperCase();
  const itens = [
    [LayoutDashboard, "Visão geral", "visao"],
    [Users, "Clientes", "clientes"],
    [ClipboardList, "Reservas", "reservas"],
    [CircleDollarSign, "Crédito", "credito"],
    [TrendingUp, "Repasses", "repasses"],
    [FileBarChart, "Relatórios", "relatorios"],
  ];
  return (
    <>
      <div
        className={`mobile-overlay ${aberto ? "show" : ""}`}
        onClick={fechar}
      />
      <aside
        onMouseEnter={expandir}
        className={`sidebar ${aberto ? "open" : ""} ${recolhida ? "collapsed" : ""}`}
      >
        <div className="brand">
          <div className="brand-mark">
            <TrendingUp size={23} />
          </div>
          <div>
            <strong>Avanço</strong>
            <span>Gestão comercial</span>
          </div>
          <button className="mobile-close" onClick={fechar}>
            <X size={20} />
          </button>
        </div>
        <div className="company-switch">
          <div className="company-icon">7L</div>
          <div>
            <span>Organização</span>
            <strong>7LM Empreendimentos</strong>
          </div>
          <ChevronDown size={15} />
        </div>
        <nav>
          <span className="nav-label">MENU PRINCIPAL</span>
          {itens.map(([Icon, texto, destino]) => (
            <button
              title={texto}
              className={tela === destino ? "active" : ""}
              key={texto}
              onClick={() => navegar(destino)}
            >
              <Icon size={19} />
              <span>{texto}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button title="Central de ajuda">
            <HelpCircle size={19} />
            <span>Central de ajuda</span>
          </button>
          <button
            title="Configurações"
            className={tela === "configuracoes" ? "active" : ""}
            onClick={() => navegar("configuracoes")}
          >
            <Settings size={19} />
            <span>Configurações</span>
          </button>
          <div
            className="sidebar-user"
            title={`${usuario.nome} · ${usuario.cargo}`}
          >
            <div className="avatar">{iniciais}</div>
            <div>
              <strong>{usuario.nome}</strong>
              <span>{usuario.cargo}</span>
            </div>
            <MoreHorizontal size={18} />
          </div>
        </div>
      </aside>
    </>
  );
}

function Topbar({ abrirMenu }) {
  return (
    <header className="topbar">
      <button className="menu-button" onClick={abrirMenu}>
        <Menu size={22} />
      </button>
      <div className="top-search">
        <Search size={18} />
        <span>O que você procura?</span>
      </div>
      <div className="top-actions">
        <button>
          <HelpCircle size={20} />
        </button>
        <button className="notification">
          <Bell size={20} />
          <i />
        </button>
        <button
          className="top-avatar"
          title="Sair"
          onClick={() => supabaseClient?.auth.signOut()}
        >
          DM
        </button>
      </div>
    </header>
  );
}

function MetricCard({ icon: Icon, label, value, detail, tone }) {
  return (
    <article className="metric-card">
      <div className={`metric-icon ${tone}`}>
        <Icon size={21} />
      </div>
      <div>
        <span>{label}</span>
        <strong>{value ?? 0}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function Configuracoes() {
  const [campos, setCampos] = useState(() =>
    JSON.parse(localStorage.getItem("avanco-custom-fields") || "[]"),
  );
  const [novo, setNovo] = useState({ nome: "", tipo: "Texto", cor: "#087b66" });
  const [cor, setCor] = useState(
    () => localStorage.getItem("avanco-primary-color") || "#087b66",
  );
  const [tema, setTema] = useState(
    () => localStorage.getItem("avanco-theme") || "sistema",
  );
  const [tempo, setTempo] = useState(
    () => localStorage.getItem("avanco-sidebar-idle") || "30",
  );
  const [arquivoImportacao, setArquivoImportacao] = useState(null);
  const [importando, setImportando] = useState(false);
  const [resultadoImportacao, setResultadoImportacao] = useState(null);
  const salvar = () => {
    localStorage.setItem("avanco-custom-fields", JSON.stringify(campos));
    localStorage.setItem("avanco-primary-color", cor);
    localStorage.setItem("avanco-theme", tema);
    localStorage.setItem("avanco-sidebar-idle", tempo);
    aplicarAparencia(tema, cor);
    alert("Configurações salvas.");
  };
  const adicionar = () => {
    if (!novo.nome.trim()) return;
    setCampos((atuais) => [...atuais, { ...novo, id: crypto.randomUUID() }]);
    setNovo({ nome: "", tipo: "Texto", cor: "#087b66" });
  };
  const importarPlanilha = async () => {
    if (!arquivoImportacao) return;
    if (
      !confirm(
        `Importar ${arquivoImportacao.name}? As reservas existentes serão atualizadas pelo número.`,
      )
    )
      return;
    setImportando(true);
    setResultadoImportacao(null);
    try {
      const formData = new FormData();
      formData.append("planilha", arquivoImportacao);
      const response = await apiFetch(`${API}/importar-planilha`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.erro || "Falha na importação");
      setResultadoImportacao({ ok: true, ...data });
      setArquivoImportacao(null);
    } catch (error) {
      setResultadoImportacao({ ok: false, erro: error.message });
    } finally {
      setImportando(false);
    }
  };
  return (
    <div className="settings-page">
      <div className="breadcrumb">
        <span>Sistema</span>
        <ChevronRight size={14} />
        <span>Configurações</span>
      </div>
      <section className="page-heading">
        <div>
          <span className="eyebrow">PERSONALIZAÇÃO</span>
          <h1>Configurações</h1>
          <p>Adapte campos, cores e comportamento da plataforma.</p>
        </div>
        <button className="primary-button" onClick={salvar}>
          <Save size={16} />
          Salvar configurações
        </button>
      </section>
      <div className="settings-grid">
        <section className="content-card settings-card">
          <div className="card-heading">
            <div>
              <h2>Campos personalizados</h2>
              <p>Crie informações adicionais para reservas e clientes.</p>
            </div>
          </div>
          <div className="custom-field-form">
            <label>
              <span>Nome do campo</span>
              <input
                value={novo.nome}
                onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
                placeholder="Ex.: Origem da indicação"
              />
            </label>
            <label>
              <span>Tipo</span>
              <select
                value={novo.tipo}
                onChange={(e) => setNovo({ ...novo, tipo: e.target.value })}
              >
                <option>Texto</option>
                <option>Número</option>
                <option>Data</option>
                <option>Lista de opções</option>
                <option>Sim/Não</option>
              </select>
            </label>
            <label>
              <span>Cor</span>
              <input
                type="color"
                value={novo.cor}
                onChange={(e) => setNovo({ ...novo, cor: e.target.value })}
              />
            </label>
            <button className="primary-button" onClick={adicionar}>
              <Plus size={15} />
              Criar campo
            </button>
          </div>
          <div className="custom-field-list">
            {campos.length ? (
              campos.map((campo) => (
                <div key={campo.id}>
                  <i style={{ background: campo.cor }} />
                  <div>
                    <strong>{campo.nome}</strong>
                    <span>{campo.tipo}</span>
                  </div>
                  <button
                    onClick={() =>
                      setCampos((atuais) =>
                        atuais.filter((item) => item.id !== campo.id),
                      )
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            ) : (
              <div className="settings-empty">
                Nenhum campo personalizado criado.
              </div>
            )}
          </div>
        </section>
        <section className="content-card settings-card">
          <div className="card-heading">
            <div>
              <h2>Aparência e navegação</h2>
              <p>Defina a identidade visual e o tempo de recolhimento.</p>
            </div>
          </div>
          <div className="settings-options">
            <div>
              <span className="settings-label">Tema predefinido</span>
              <div className="theme-presets">
                <button
                  className={tema === "sistema" ? "active" : ""}
                  onClick={() => {
                    setTema("sistema");
                    setCor("#087b66");
                    aplicarAparencia("sistema", "#087b66");
                  }}
                >
                  <i className="theme-system" />
                  <strong>Cor do sistema</strong>
                  <small>Claro e verde</small>
                </button>
                <button
                  className={tema === "noturno" ? "active" : ""}
                  onClick={() => {
                    setTema("noturno");
                    aplicarAparencia("noturno", cor);
                  }}
                >
                  <i className="theme-dark" />
                  <strong>Modo noturno</strong>
                  <small>Fundo escuro</small>
                </button>
              </div>
            </div>
            <label>
              <span>Cor principal personalizada</span>
              <div>
                <input
                  type="color"
                  value={cor}
                  onChange={(e) => {
                    setCor(e.target.value);
                    aplicarAparencia(tema, e.target.value);
                  }}
                />
                <strong>{cor}</strong>
              </div>
            </label>
            <label>
              <span>Recolher menu após</span>
              <select value={tempo} onChange={(e) => setTempo(e.target.value)}>
                <option value="15">15 segundos</option>
                <option value="30">30 segundos</option>
                <option value="60">1 minuto</option>
                <option value="120">2 minutos</option>
              </select>
            </label>
            <div className="setting-note">
              <Menu size={18} />
              <span>
                Ao recolher, o menu mantém somente os ícones. Passe o mouse
                sobre ele para expandir novamente.
              </span>
            </div>
          </div>
        </section>
        <MfaSettings />
        <section className="content-card settings-card import-settings-card">
          <div className="card-heading">
            <div><h2>Importar base por planilha</h2><p>Atualize clientes, reservas, crédito e repasses usando Excel.</p></div>
            <UploadCloud size={20} />
          </div>
          <div className="spreadsheet-import">
            <label className={`spreadsheet-drop ${arquivoImportacao ? "selected" : ""}`}>
              <UploadCloud size={25} />
              <strong>{arquivoImportacao ? arquivoImportacao.name : "Selecionar planilha"}</strong>
              <span>Arquivos .XLS ou .XLSX · máximo de 10 MB</span>
              <input type="file" accept=".xls,.xlsx" onChange={(e) => { setArquivoImportacao(e.target.files?.[0] || null); setResultadoImportacao(null); }} />
            </label>
            <div className="spreadsheet-import-rules">
              <p><Check size={14} />O número da reserva é usado como chave.</p>
              <p><Check size={14} />Registros existentes são atualizados, sem duplicação.</p>
              <p><Check size={14} />Apenas proprietários, administradores e gestores podem importar.</p>
            </div>
            <button className="primary-button" disabled={!arquivoImportacao || importando} onClick={importarPlanilha}>
              {importando ? "Importando, aguarde..." : "Importar e atualizar base"}
            </button>
            {resultadoImportacao && <div className={`import-result ${resultadoImportacao.ok ? "success" : "error"}`}>
              <strong>{resultadoImportacao.ok ? "Importação concluída" : "Não foi possível importar"}</strong>
              <span>{resultadoImportacao.ok ? `${resultadoImportacao.validas} válidas · ${resultadoImportacao.novas} novas · ${resultadoImportacao.atualizadas} atualizadas · ${resultadoImportacao.repasses} repasses` : resultadoImportacao.erro}</span>
            </div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function MfaSettings() {
  const [fatores,setFatores]=useState([]),[carregando,setCarregando]=useState(true),[erro,setErro]=useState('');
  useEffect(()=>{if(!supabaseClient){setCarregando(false);return}supabaseClient.auth.mfa.listFactors().then(({data,error})=>{if(error)setErro(error.message);else setFatores((data.totp||[]).filter(f=>f.status==='verified'));setCarregando(false)})},[]);
  async function remover(factorId){if(!confirm('Remover o Microsoft Authenticator? Você precisará configurá-lo novamente no próximo acesso.'))return;setCarregando(true);const result=await supabaseClient.auth.mfa.unenroll({factorId});if(result.error){setErro(result.error.message);setCarregando(false);return}await supabaseClient.auth.signOut()}
  return <section className="content-card settings-card mfa-settings-card"><div className="card-heading"><div><h2>Microsoft Authenticator</h2><p>Segundo fator obrigatório para proteger o acesso ao sistema.</p></div><div className={`mfa-status ${fatores.length?'enabled':'disabled'}`}><i/>{fatores.length?'Ativo':'Não configurado'}</div></div><div className="mfa-settings-content"><div className="mfa-settings-icon"><CheckCircle2 size={24}/></div><div><strong>Verificação por código TOTP</strong><span>{carregando?'Consultando configuração...':fatores.length?'Sua conta exige um código de seis dígitos após a senha.':'O sistema solicitará a configuração no próximo acesso.'}</span>{erro&&<small>{erro}</small>}</div>{fatores.map(fator=><button key={fator.id} className="secondary-button" disabled={carregando} onClick={()=>remover(fator.id)}>Remover autenticador</button>)}</div></section>;
}

function statusRepasseDoCliente(cliente) {
  if (cliente.situacaoRepasse) return cliente.situacaoRepasse;
  if (cliente.etapaAtual >= 9) return "Assinatura Caixa";
  if (cliente.etapaAtual >= 8) return "Em andamento";
  return "Início do repasse";
}

function situacaoConformidade(cliente) {
  if (cliente.dataReenvioCehop || cliente.reenvioCehop)
    return "Aguardando conformidade";
  if (cliente.dataInconformidadeCehop || cliente.inconformidadeCehop)
    return "Inconforme";
  if (cliente.dataConformidadeCehop || cliente.conformidadeCehop)
    return "Conforme";
  if (cliente.dataEnvioCehop || cliente.envioCehop)
    return "Aguardando conformidade";
  return "Aguardando envio para conformidade";
}

function RelatorioCredito({ clientes, atualizar, abrir }) {
  const [busca, setBusca] = useState("");
  const [contarMesFiltro, setContarMesFiltro] = useState("todos");
  const [documentosReserva, setDocumentosReserva] = useState({});
  const [clienteArrastado, setClienteArrastado] = useState(null);
  const [colunaSobre, setColunaSobre] = useState(null);
  const [rolando, setRolando] = useState(false);
  const scrollRef = useRef(null),
    dragScrollRef = useRef(null);
  useEffect(() => {
    if (!supabaseClient) return;
    supabaseClient
      .from("reservation_documents")
      .select("reservation_id, document_type")
      .then(({ data }) => {
        if (!data) return;
        setDocumentosReserva(
          data.reduce(
            (mapa, item) => ({
              ...mapa,
              [item.reservation_id]: [
                ...(mapa[item.reservation_id] || []),
                item.document_type,
              ],
            }),
            {},
          ),
        );
      });
  }, []);
  const diasSla = (cliente) => {
    const data =
      cliente.dataReenvioCehop ||
      cliente.reenvioCehop ||
      cliente.dataEnvioCehop ||
      cliente.envioCehop ||
      cliente.atualizadoEm;
    if (!data) return 0;
    return Math.max(
      0,
      Math.floor((Date.now() - new Date(data).getTime()) / 86400000),
    );
  };
  const chaveMes = (valor) => {
    if (!valor) return null;
    const texto = String(valor); const br = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (br) return `${br[3]}-${br[2].padStart(2,'0')}`;
    const data = new Date(valor); return Number.isNaN(data.valueOf()) ? null : `${data.getFullYear()}-${String(data.getMonth()+1).padStart(2,'0')}`;
  };
  const valorContarMes = cliente => String(cliente.planilha?.['Repasse no mês:'] || (cliente.repasseMes ? 'Sim' : 'Não')).trim();
  const opcoesContarMes = [...new Set(clientes.map(valorContarMes).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
  const filtrados = clientes.filter((c) =>
    `${c.reserva} ${c.cliente} ${c.corretor}`.toLowerCase().includes(busca.toLowerCase()) &&
    (contarMesFiltro === 'todos' || valorContarMes(c) === contarMesFiltro),
  );
  const mesAssinatura = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
  const assinadoNoMes = (c) => {
    if (!c.dataAssinatura) return false;
    return (
      /assinatura caixa/i.test(statusRepasseDoCliente(c)) &&
      chaveMes(c.dataAssinatura) === mesAssinatura
    );
  };
  const catalogoDocumentos = gruposDocumentos.flatMap(
    (grupo) => grupo.documentos,
  );
  const faltantesDoCliente = (c) => {
    const anexados = documentosReserva[c.id] || [];
    const atendidos = new Set(anexados.flatMap(equivalentesDoDocumento));
    return catalogoDocumentos.filter((tipo) => !atendidos.has(tipo));
  };
  const colunas = [
    {
      nome: "Processo",
      cor: "#d64a43",
      teste: (c) => Number(c.etapaAtual) <= 1,
      dados: { etapaAtual: 1, situacaoRepasse: "" },
    },
    {
      nome: "Secretaria de vendas",
      cor: "#19b8d5",
      teste: (c) => Number(c.etapaAtual) === 2,
      dados: { etapaAtual: 2, situacaoRepasse: "" },
    },
    {
      nome: "SIENGE",
      cor: "#f04444",
      teste: (c) => Number(c.etapaAtual) === 3,
      dados: { etapaAtual: 3, situacaoRepasse: "" },
    },
    {
      nome: "Crédito",
      cor: "#24bd5c",
      teste: (c) => [4, 5].includes(Number(c.etapaAtual)),
      dados: { etapaAtual: 4, situacaoRepasse: "" },
    },
    {
      nome: "Creditú",
      cor: "#c39362",
      teste: (c) => Number(c.etapaAtual) === 6,
      dados: { etapaAtual: 6, situacaoRepasse: "" },
    },
    {
      nome: "Assinatura 7LM",
      cor: "#ded719",
      teste: (c) => Number(c.etapaAtual) === 7 && !c.situacaoRepasse,
      dados: { etapaAtual: 7, situacaoRepasse: "" },
    },
    {
      nome: "Início repasse",
      cor: "#8fa7aa",
      teste: (c) =>
        !/assinatura caixa/i.test(statusRepasseDoCliente(c)) &&
        (Number(c.etapaAtual) === 8 ||
          (/início|inicio|andamento/i.test(c.situacaoRepasse || "") &&
            Number(c.etapaAtual) >= 7)),
      dados: { etapaAtual: 8, situacaoRepasse: "Início do repasse" },
    },
    {
      nome: "Assinatura Caixa",
      cor: "#e6a9aa",
      teste: (c) =>
        /assinatura caixa/i.test(statusRepasseDoCliente(c)) &&
        !assinadoNoMes(c),
      dados: {
        etapaAtual: 9,
        situacaoRepasse: "Assinatura Caixa",
        dataAssinatura: "",
      },
    },
    {
      nome: "Assinados no mês",
      cor: "#17883b",
      teste: (c) => assinadoNoMes(c),
      dados: {
        etapaAtual: 9,
        situacaoRepasse: "Assinatura Caixa",
        dataAssinatura: new Date().toISOString().slice(0, 10),
      },
    },
  ];
  const moverCliente = async (coluna) => {
    const cliente = clientes.find((c) => c.id === clienteArrastado);
    if (!cliente) return;
    await atualizar(cliente.id, coluna.dados);
    setClienteArrastado(null);
    setColunaSobre(null);
  };
  return (
    <div className="credit-report">
      <div className="breadcrumb">
        <span>Comercial</span>
        <ChevronRight size={14} />
        <span>Crédito</span>
      </div>
      <section className="page-heading">
        <div>
          <span className="eyebrow">FLUXO OPERACIONAL</span>
          <h1>Kanban de clientes</h1>
          <p>
            Acompanhe crédito, conformidade, assinatura e repasse em uma única
            visão.
          </p>
        </div>
      </section>
      <section className="content-card credit-kanban-shell">
        <div className="credit-kanban-toolbar">
          <label className="search-box">
            <Search size={18} />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar reserva, cliente ou corretor"
            />
          </label>
          <label className="month-filter" title="Campo Repasse no mês da planilha">
            <CircleDollarSign size={16} />
            <select value={contarMesFiltro} onChange={(e)=>setContarMesFiltro(e.target.value)}>
              <option value="todos">Contar para o mês: todos</option>
              {opcoesContarMes.map(opcao=><option key={opcao} value={opcao}>Contar para o mês: {opcao}</option>)}
            </select>
            <ChevronDown size={14}/>
          </label>
          <div className="kanban-help">
            <span>
              <b>Botão esquerdo + arrastar</b> para navegar
            </span>
            <span>
              <b>Ctrl + arrastar cartão</b> para alterar status
            </span>
          </div>
          <span>
            <strong>{filtrados.length}</strong> {contarMesFiltro === 'todos' ? 'clientes' : 'no filtro'}
          </span>
        </div>
        <div
          ref={scrollRef}
          className={`credit-kanban-scroll ${rolando ? "drag-scrolling" : ""}`}
          onMouseDown={(e) => {
            if (
              e.button !== 0 ||
              e.target.closest(
                ".credit-kanban-card,button,input,textarea,details",
              )
            )
              return;
            e.preventDefault();
            dragScrollRef.current = {
              x: e.clientX,
              left: e.currentTarget.scrollLeft,
            };
            setRolando(true);
          }}
          onMouseMove={(e) => {
            if (!dragScrollRef.current) return;
            e.currentTarget.scrollLeft =
              dragScrollRef.current.left -
              (e.clientX - dragScrollRef.current.x);
          }}
          onMouseUp={() => {
            dragScrollRef.current = null;
            setRolando(false);
          }}
          onMouseLeave={() => {
            dragScrollRef.current = null;
            setRolando(false);
          }}
        >
          <div className="credit-kanban-board">
            {colunas.map((coluna) => {
              const cards = filtrados.filter(coluna.teste);
              return (
                <section
                  className={`credit-kanban-column ${colunaSobre === coluna.nome ? "drop-target" : ""}`}
                  key={coluna.nome}
                  onDragOver={(e) => {
                    if (!clienteArrastado) return;
                    e.preventDefault();
                    setColunaSobre(coluna.nome);
                  }}
                  onDragLeave={() => setColunaSobre(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    moverCliente(coluna);
                  }}
                >
                  <header style={{ "--column-color": coluna.cor }}>
                    <div>
                      <strong>{coluna.nome}</strong>
                      <span>
                        {cards.length} cliente{cards.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <b>{cards.length}</b>
                  </header>
                  <div className="credit-kanban-cards">
                    {cards.map((c) => {
                      const dias = diasSla(c),
                        situacao = situacaoConformidade(c),
                        faltantes = faltantesDoCliente(c);
                      return (
                        <article
                          draggable
                          className={`credit-kanban-card ${clienteArrastado === c.id ? "dragging-card" : ""}`}
                          key={c.id}
                          onDragStart={(e) => {
                            if (!e.ctrlKey) {
                              e.preventDefault();
                              return;
                            }
                            setClienteArrastado(c.id);
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", c.id);
                          }}
                          onDragEnd={() => {
                            setClienteArrastado(null);
                            setColunaSobre(null);
                          }}
                        >
                          <button
                            className="credit-card-title"
                            onClick={() => abrir(c)}
                          >
                            <strong>#{c.reserva}</strong>
                            <span>{c.cliente}</span>
                            <ChevronRight size={15} />
                          </button>
                          <small className="credit-card-owner">
                            {c.corretor || "Corretor não informado"}
                          </small>
                          <div className="credit-card-meta">
                            <span
                              className={`sla-badge ${dias > 5 ? "late" : dias > 2 ? "warning" : "ok"}`}
                            >
                              <b>{dias}</b> dia{dias === 1 ? "" : "s"} de SLA
                            </span>
                            <span
                              className={`conformity-status ${situacao === "Conforme" ? "approved" : situacao === "Inconforme" ? "rejected" : situacao.includes("envio") ? "waiting-send" : "waiting"}`}
                            >
                              {situacao}
                            </span>
                          </div>
                          <div className="missing-documents">
                            <span>Documentos faltantes</span>
                            <details>
                              <summary
                                className={
                                  faltantes.length ? "has-pending" : "complete"
                                }
                              >
                                {faltantes.length
                                  ? `${faltantes.length} pendentes`
                                  : "Documentação completa"}
                              </summary>
                              {faltantes.length > 0 && (
                                <ul>
                                  {faltantes.map((documento) => (
                                    <li key={documento}>{documento}</li>
                                  ))}
                                </ul>
                              )}
                            </details>
                          </div>
                          <label>
                            <span>Observação</span>
                            <textarea
                              className="credit-inline-text"
                              defaultValue={c.observacoes || ""}
                              placeholder="Adicionar observação"
                              onBlur={(e) =>
                                atualizar(c.id, { observacoes: e.target.value })
                              }
                            />
                          </label>
                          <button
                            className="open-credit-card"
                            onClick={() => abrir(c)}
                          >
                            Abrir cadastro <ChevronRight size={14} />
                          </button>
                        </article>
                      );
                    })}
                    {!cards.length && (
                      <div className="credit-column-empty">
                        <Users size={20} />
                        <span>Nenhum cliente</span>
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

function RelatoriosExecutivos({ clientes }) {
  const normalizar = valor => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const cancelada = cliente => normalizar(cliente.status).includes('cancel');
  const conforme = cliente => situacaoConformidade(cliente) === 'Conforme';
  const enviada = cliente => Boolean(cliente.dataEnvioCehop || cliente.envioCehop);
  const diferencaDias = (inicio, fim) => {
    const a = inicio ? new Date(`${inicio}T12:00:00`) : null, b = fim ? new Date(`${fim}T12:00:00`) : new Date();
    return a && !Number.isNaN(a.valueOf()) ? Math.max(0,(b-a)/86400000) : null;
  };
  const baseAtivaTotal = clientes.filter(c => !cancelada(c)).length;
  const calcular = lista => {
    const canceladas = lista.filter(cancelada).length, ativas = lista.length - canceladas;
    const enviadas = lista.filter(c => !cancelada(c) && enviada(c)).length;
    const conformes = lista.filter(c => !cancelada(c) && conforme(c)).length;
    const prazos = lista.filter(c => !cancelada(c) && enviada(c)).map(c => diferencaDias(c.dataReenvioCehop || c.dataEnvioCehop || c.envioCehop, c.dataConformidadeCehop || c.conformidadeCehop)).filter(v => v != null);
    return { reservas: lista.length, canceladas, ativas, enviadas, conformes,
      percentualEnvio: ativas ? enviadas/ativas*100 : 0, percentualConforme: enviadas ? conformes/enviadas*100 : 0,
      share: baseAtivaTotal ? ativas/baseAtivaTotal*100 : 0, media: prazos.length ? prazos.reduce((a,b)=>a+b,0)/prazos.length : 0 };
  };
  const total = calcular(clientes);
  const agrupar = seletor => Object.entries(clientes.reduce((mapa,cliente)=>{const chave=seletor(cliente)||'Não informado';(mapa[chave] ||= []).push(cliente);return mapa},{})).map(([grupo,lista])=>({grupo,...calcular(lista)})).sort((a,b)=>b.reservas-a.reservas);
  const porImobiliaria = agrupar(c => c.imobiliaria);
  const porCca = agrupar(c => c.empresaCorrespondente || c.planilha?.['Empresa correspondente']);
  const porCorretor = agrupar(c => `${c.imobiliaria || 'Não informado'} | ${c.corretor || 'Sem corretor'}`);
  const statusCreditu = c => normalizar(c.situacaoCreditu || c.planilha?.['Situação Creditú']);
  const comCreditu = clientes.filter(c => c.creditu || (statusCreditu(c) && !statusCreditu(c).includes('nao tem'))).length;
  const credituPendente = clientes.filter(c => statusCreditu(c).includes('pendente')).length;
  const credituAnalise = clientes.filter(c => statusCreditu(c).includes('analise') || statusCreditu(c).includes('ag.')).length;
  const credituOk = clientes.filter(c => ['ok','aprovado'].some(x => statusCreditu(c).includes(x))).length;
  const percentual = valor => `${valor.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})}%`;
  const TabelaResumo = ({ titulo, linhas }) => <section className="executive-table-card"><header><h2>{titulo}</h2></header><div className="executive-table-scroll"><table><thead><tr><th>Grupo</th><th>Reservas</th><th>Canceladas</th><th>Base ativa</th><th>Enviadas conf.</th><th>% envio real</th><th>Conformes</th><th>% conforme</th><th>Share base ativa</th><th>Média prazo</th></tr></thead><tbody>{linhas.map(linha=><tr key={linha.grupo}><td>{linha.grupo}</td><td>{linha.reservas}</td><td>{linha.canceladas}</td><td>{linha.ativas}</td><td>{linha.enviadas}</td><td>{percentual(linha.percentualEnvio)}</td><td>{linha.conformes}</td><td>{percentual(linha.percentualConforme)}</td><td>{percentual(linha.share)}</td><td>{linha.media.toLocaleString('pt-BR',{maximumFractionDigits:1})}</td></tr>)}</tbody><tfoot><tr><td>Total</td><td>{total.reservas}</td><td>{total.canceladas}</td><td>{total.ativas}</td><td>{total.enviadas}</td><td>{percentual(total.percentualEnvio)}</td><td>{total.conformes}</td><td>{percentual(total.percentualConforme)}</td><td>100,00%</td><td>{total.media.toLocaleString('pt-BR',{maximumFractionDigits:1})}</td></tr></tfoot></table></div></section>;
  return <div className="executive-report"><div className="breadcrumb"><span>Gestão</span><ChevronRight size={14}/><span>Relatórios</span></div><section className="page-heading"><div><span className="eyebrow">DASHBOARD EXECUTIVO</span><h1>Conformidade e operação</h1><p>Atualizado em {new Date().toLocaleString('pt-BR')} · filtro: todos</p></div></section><section className="executive-dashboard"><div className="executive-main-metrics">{[
    ['Total reservas',total.reservas,ClipboardList],['Canceladas',total.canceladas,X],['Base ativa',total.ativas,Users],['Enviadas conf.',total.enviadas,UploadCloud],['Conformes',total.conformes,CheckCircle2],['% envio real',percentual(total.percentualEnvio),TrendingUp],['Média prazo',total.media.toLocaleString('pt-BR',{maximumFractionDigits:1}),CalendarDays]
  ].map(([label,value,Icon])=><article key={label}><Icon size={18}/><span>{label}</span><strong>{value}</strong></article>)}</div><div className="creditu-report-metrics"><div><span>INDICADORES CREDITÚ</span><small>Situação atual da carteira</small></div>{[['Com Creditú',comCreditu,CircleDollarSign,'total'],['Pendentes',credituPendente,HelpCircle,'pending'],['Em análise',credituAnalise,CalendarDays,'analysis'],['OK',credituOk,CheckCircle2,'ok']].map(([label,value,Icon,tone])=><article className={tone} key={label}><Icon size={18}/><span>{label}</span><strong>{value}</strong></article>)}</div></section><TabelaResumo titulo="Resumo por imobiliária" linhas={porImobiliaria}/><TabelaResumo titulo="Resumo por CCA" linhas={porCca}/><TabelaResumo titulo="Resumo por imobiliária e seus corretores" linhas={porCorretor}/></div>;
}

function VisaoGeral({ clientes, etapas, abrirReserva, abrirRepasse }) {
  const [faseComercialAberta, setFaseComercialAberta] = useState(null);
  const [faseRepasseAberta, setFaseRepasseAberta] = useState(null);
  const comerciais = [
    {
      nome: "Em processo",
      detalhe: "Entrada e conferência inicial",
      indices: [0, 1],
      cor: "emerald",
      icon: ClipboardList,
    },
    {
      nome: "Secretaria",
      detalhe: "Validação pela secretaria",
      indices: [2],
      cor: "blue",
      icon: Users,
    },
    {
      nome: "SIENGE",
      detalhe: "Importação no sistema",
      indices: [3],
      cor: "violet",
      icon: Building2,
    },
    {
      nome: "Crédito",
      detalhe: "Análise e conformidade",
      indices: [4, 5],
      cor: "amber",
      icon: CreditCard,
    },
    {
      nome: "Creditú",
      detalhe: "Processo com a Creditú",
      indices: [6],
      cor: "violet",
      icon: CircleDollarSign,
    },
    {
      nome: "Assinatura 7LM",
      detalhe: "Liberados para repasse",
      indices: [7, 8],
      cor: "blue",
      icon: FileText,
    },
    {
      nome: "Venda finalizada",
      detalhe: "Jornada comercial concluída",
      indices: [9],
      cor: "green",
      icon: CheckCircle2,
    },
  ].map((item) => ({
    ...item,
    clientes: clientes.filter((c) =>
      item.indices.includes(Number(c.etapaAtual)),
    ),
  }));
  const elegiveisRepasse = clientes.filter((c) => Number(c.etapaAtual) >= 7);
  const statusAssinaturaCaixa = (c) =>
    /assinatura caixa/i.test(statusRepasseDoCliente(c));
  const repasses = [
    {
      nome: "Início do repasse",
      detalhe: "Entraram após Assinatura 7LM",
      cor: "emerald",
      icon: TrendingUp,
      clientes: elegiveisRepasse.filter((c) =>
        /início|inicio/i.test(statusRepasseDoCliente(c)),
      ),
    },
    {
      nome: "Em andamento",
      detalhe: "Repasse em processamento",
      cor: "blue",
      icon: CircleDollarSign,
      clientes: elegiveisRepasse.filter((c) =>
        /andamento/i.test(statusRepasseDoCliente(c)),
      ),
    },
    {
      nome: "Autorizados a assinar",
      detalhe: "Assinatura Caixa sem data",
      cor: "amber",
      icon: FileText,
      clientes: elegiveisRepasse.filter(
        (c) => statusAssinaturaCaixa(c) && !c.dataAssinatura,
      ),
    },
    {
      nome: "Assinados",
      detalhe: "Assinatura Caixa com data",
      cor: "green",
      icon: CheckCircle2,
      clientes: elegiveisRepasse.filter(
        (c) => statusAssinaturaCaixa(c) && Boolean(c.dataAssinatura),
      ),
    },
  ];
  const faseComercialSelecionada = comerciais.find(
    (item) => item.nome === faseComercialAberta,
  );
  const faseRepasseSelecionada = repasses.find(
    (item) => item.nome === faseRepasseAberta,
  );
  const ListaFase = ({ fase, abrir, tipo }) => (
    <div className="stage-client-list">
      <div className="stage-client-list-head">
        <div>
          <strong>{fase.nome}</strong>
          <span>
            {fase.clientes.length} cliente
            {fase.clientes.length === 1 ? "" : "s"} nesta fase
          </span>
        </div>
        <button
          type="button"
          aria-label="Fechar lista"
          onClick={() =>
            tipo === "comercial"
              ? setFaseComercialAberta(null)
              : setFaseRepasseAberta(null)
          }
        >
          <X size={17} />
        </button>
      </div>
      {fase.clientes.length ? (
        <div className="stage-client-rows">
          {fase.clientes.map((cliente) => (
            <button
              type="button"
              key={cliente.id}
              onClick={() => abrir(cliente)}
            >
              <div className="client-avatar">
                {cliente.cliente
                  .split(" ")
                  .slice(0, 2)
                  .map((nome) => nome[0])
                  .join("")}
              </div>
              <div>
                <strong>{cliente.cliente}</strong>
                <span>
                  Reserva #{cliente.reserva} ·{" "}
                  {cliente.corretor || "Corretor não definido"}
                </span>
              </div>
              <span
                className={`priority ${cliente.prioridade === "vermelha" ? "high" : cliente.prioridade === "amarela" ? "medium" : "low"}`}
              >
                <i />
                {cliente.prioridade === "vermelha"
                  ? "Atrasado"
                  : cliente.prioridade === "amarela"
                    ? "Atenção"
                    : "No prazo"}
              </span>
              <ChevronRight size={17} />
            </button>
          ))}
        </div>
      ) : (
        <div className="stage-client-empty">
          <Users size={20} />
          <span>Nenhum cliente nesta fase.</span>
        </div>
      )}
    </div>
  );
  return (
    <div className="overview-dashboard">
      <div className="breadcrumb">
        <span>Comercial</span>
        <ChevronRight size={14} />
        <span>Visão geral</span>
      </div>
      <section className="page-heading dashboard-heading">
        <div>
          <span className="eyebrow">PAINEL OPERACIONAL</span>
          <h1>Visão geral</h1>
          <p>
            Acompanhe o funil comercial e a evolução dos repasses em tempo real.
          </p>
        </div>
        <div className="dashboard-total">
          <strong>{clientes.length}</strong>
          <span>clientes na carteira</span>
        </div>
      </section>
      <section className="dashboard-section">
        <div className="dashboard-section-heading">
          <div>
            <h2>Jornada comercial</h2>
            <p>Distribuição dos clientes por etapa atual</p>
          </div>
          <strong>{clientes.length} clientes</strong>
        </div>
        <div className="stage-metric-grid">
          {comerciais.map((item) => (
            <button
              type="button"
              className={`stage-metric-card ${faseComercialAberta === item.nome ? "expanded" : ""}`}
              key={item.nome}
              aria-expanded={faseComercialAberta === item.nome}
              onClick={() =>
                setFaseComercialAberta((atual) =>
                  atual === item.nome ? null : item.nome,
                )
              }
            >
              <div className={`metric-icon ${item.cor}`}>
                <item.icon size={20} />
              </div>
              <div>
                <span>{item.nome}</span>
                <strong>{item.clientes.length}</strong>
                <small>{item.detalhe}</small>
              </div>
              <ChevronRight className="stage-arrow" size={17} />
            </button>
          ))}
        </div>
        {faseComercialSelecionada && (
          <ListaFase
            fase={faseComercialSelecionada}
            abrir={abrirReserva}
            tipo="comercial"
          />
        )}
      </section>
      <section className="dashboard-section transfer-overview">
        <div className="dashboard-section-heading">
          <div>
            <h2>Jornada de repasse</h2>
            <p>Clientes entram neste fluxo ao alcançar Assinatura 7LM</p>
          </div>
          <strong>{elegiveisRepasse.length} repasses</strong>
        </div>
        <div className="transfer-metric-grid">
          {repasses.map((item) => (
            <button
              type="button"
              className={`stage-metric-card ${faseRepasseAberta === item.nome ? "expanded" : ""}`}
              key={item.nome}
              aria-expanded={faseRepasseAberta === item.nome}
              onClick={() =>
                setFaseRepasseAberta((atual) =>
                  atual === item.nome ? null : item.nome,
                )
              }
            >
              <div className={`metric-icon ${item.cor}`}>
                <item.icon size={20} />
              </div>
              <div>
                <span>{item.nome}</span>
                <strong>{item.clientes.length}</strong>
                <small>{item.detalhe}</small>
              </div>
              <ChevronRight className="stage-arrow" size={17} />
            </button>
          ))}
        </div>
        {faseRepasseSelecionada && (
          <ListaFase
            fase={faseRepasseSelecionada}
            abrir={abrirRepasse}
            tipo="repasse"
          />
        )}
        <div className="dashboard-rule">
          <CheckCircle2 size={18} />
          <div>
            <strong>Regra de assinatura</strong>
            <span>
              Um cliente só é contado como assinado quando o status está em
              “Assinatura Caixa” e a data da assinatura foi preenchida.
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}

function Cadastro({ form, setForm, salvar, fechar }) {
  const campo = (nome, valor) =>
    setForm((atual) => ({ ...atual, [nome]: valor }));
  return (
    <section className="content-card new-client-card">
      <div className="card-heading">
        <div>
          <span className="eyebrow">NOVO REGISTRO</span>
          <h2>Cadastrar cliente</h2>
          <p>Preencha os dados principais da reserva.</p>
        </div>
        <button className="close-button" onClick={fechar}>
          <X size={20} />
        </button>
      </div>
      <form className="client-form" onSubmit={salvar}>
        <label>
          <span>Reserva</span>
          <input
            required
            placeholder="Ex.: 7212"
            value={form.reserva}
            onChange={(e) => campo("reserva", e.target.value)}
          />
        </label>
        <label className="span-2">
          <span>Nome do cliente</span>
          <input
            required
            placeholder="Nome completo"
            value={form.cliente}
            onChange={(e) => campo("cliente", e.target.value)}
          />
        </label>
        <label>
          <span>Telefone</span>
          <input
            placeholder="(00) 00000-0000"
            value={form.telefone}
            onChange={(e) => campo("telefone", e.target.value)}
          />
        </label>
        <label>
          <span>Corretor responsável</span>
          <input
            placeholder="Nome do corretor"
            value={form.corretor}
            onChange={(e) => campo("corretor", e.target.value)}
          />
        </label>
        <label>
          <span>Imobiliária</span>
          <select
            value={form.imobiliaria}
            onChange={(e) => campo("imobiliaria", e.target.value)}
          >
            <option>Equipe Própria | CAT</option>
            <option>Canal Virtual 3</option>
            <option>Imobiliárias | CAT</option>
          </select>
        </label>
        <label>
          <span>Prioridade</span>
          <select
            value={form.prioridade}
            onChange={(e) => campo("prioridade", e.target.value)}
          >
            <option value="verde">No prazo</option>
            <option value="amarela">Atenção</option>
            <option value="vermelha">Atrasado</option>
          </select>
        </label>
        <label className="span-full">
          <span>Observações</span>
          <textarea
            placeholder="Informações importantes para o acompanhamento..."
            value={form.observacoes}
            onChange={(e) => campo("observacoes", e.target.value)}
          />
        </label>
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={fechar}>
            Cancelar
          </button>
          <button className="primary-button">Salvar cliente</button>
        </div>
      </form>
    </section>
  );
}

function Reservas({ clientes, etapas, abrir }) {
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState("Todas");
  const [subaba, setSubaba] = useState("gestao");
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [prioridadeFiltro, setPrioridadeFiltro] = useState("Todas");
  const filtrados = clientes.filter((c) => {
    const corresponde =
      `${c.reserva} ${c.cliente} ${c.imobiliaria} ${c.corretor}`
        .toLowerCase()
        .includes(busca.toLowerCase());
    const prioridadeOk =
      prioridadeFiltro === "Todas" || c.prioridade === prioridadeFiltro;
    if (situacao === "Ativas")
      return corresponde && prioridadeOk && c.etapaAtual < etapas.length - 1;
    if (situacao === "Pendentes")
      return corresponde && prioridadeOk && /pend/i.test(c.status);
    if (situacao === "Finalizadas")
      return corresponde && prioridadeOk && c.etapaAtual === etapas.length - 1;
    return corresponde && prioridadeOk;
  });
  const pendentes = clientes.filter((c) => /pend/i.test(c.status)).length;
  const finalizadas = clientes.filter(
    (c) => c.etapaAtual === etapas.length - 1,
  ).length;

  return (
    <div className="reservations-view">
      <div className="breadcrumb">
        <span>Comercial</span>
        <ChevronRight size={14} />
        <span>Reservas</span>
      </div>
      <section className="page-heading reservations-heading">
        <div>
          <span className="eyebrow">OPERAÇÃO COMERCIAL</span>
          <h1>
            {subaba === "andamento"
              ? "Andamento das reservas"
              : "Gestão de reservas"}
          </h1>
          <p>
            {subaba === "andamento"
              ? "Visualize o fluxo comercial por etapa e prioridade."
              : "Consulte e acompanhe todas as reservas da operação."}
          </p>
        </div>
        <button className="primary-button">
          <Plus size={17} /> Nova reserva
        </button>
      </section>

      <div className="reservation-nav">
        <button
          className={subaba === "gestao" ? "active" : ""}
          onClick={() => setSubaba("gestao")}
        >
          <ClipboardList size={16} /> Gestão de reservas
        </button>
        <button
          className={subaba === "andamento" ? "active" : ""}
          onClick={() => setSubaba("andamento")}
        >
          <TrendingUp size={16} /> Andamento
        </button>
        <button>
          <Building2 size={16} /> Mapa de reservas
        </button>
        <button>
          <Users size={16} /> Distribuição
        </button>
        <button>
          <Check size={16} /> Aprovações
        </button>
      </div>

      {subaba === "gestao" ? (
        <section className="content-card reservation-list-card">
          <div className="reservation-toolbar">
            <label className="search-box">
              <Search size={18} />
              <input
                placeholder="Buscar reserva, cliente ou unidade"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </label>
            <button
              className={`filter-button ${filtrosAbertos ? "active" : ""}`}
              onClick={() => setFiltrosAbertos((v) => !v)}
            >
              <Filter size={17} /> Filtrar{" "}
              {prioridadeFiltro !== "Todas" && <span>1</span>}
            </button>
            <div className="status-counters">
              {[
                ["Todas", clientes.length],
                ["Ativas", clientes.length - finalizadas],
                ["Pendentes", pendentes],
                ["Finalizadas", finalizadas],
              ].map(([nome, total]) => (
                <button
                  key={nome}
                  className={situacao === nome ? "active" : ""}
                  onClick={() => setSituacao(nome)}
                >
                  <b>{total}</b>
                  <span>{nome}</span>
                </button>
              ))}
            </div>
          </div>
          {filtrosAbertos && (
            <div className="advanced-filters">
              <div>
                <strong>Prioridade</strong>
                {[
                  ["Todas", "Todas"],
                  ["verde", "No prazo"],
                  ["amarela", "Atenção"],
                  ["vermelha", "Atrasado"],
                ].map(([valor, texto]) => (
                  <button
                    key={valor}
                    className={prioridadeFiltro === valor ? "active" : ""}
                    onClick={() => setPrioridadeFiltro(valor)}
                  >
                    {texto}
                  </button>
                ))}
              </div>
              <button
                className="clear-filters"
                onClick={() => {
                  setPrioridadeFiltro("Todas");
                  setSituacao("Todas");
                  setBusca("");
                }}
              >
                Limpar filtros
              </button>
            </div>
          )}
          <div className="results-label">
            <strong>{filtrados.length}</strong> resultados encontrados
          </div>
          <div className="reservation-table-wrap">
            <table className="reservation-table">
              <thead>
                <tr>
                  <th>Reserva</th>
                  <th>Cliente / corretor</th>
                  <th>Unidade</th>
                  <th>Status Creditú</th>
                  <th>Situação</th>
                  <th>Prazo</th>
                  <th>Opções</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((c, index) => {
                  const etapa = etapas[c.etapaAtual] || "Em processo";
                  return (
                    <tr key={c.id}>
                      <td>
                        <div className="reservation-number">
                          <strong>#{c.reserva}</strong>
                          <span>Cadastrada em</span>
                          <small>
                            {index % 2 ? "03/07/2026" : "04/07/2026"}
                          </small>
                        </div>
                      </td>
                      <td>
                        <div className="reservation-client">
                          <strong>{c.cliente}</strong>
                          <span>Corretor responsável</span>
                          <small className="broker-name">
                            <UserRound size={12} />
                            {c.corretor || "Não definido"}
                          </small>
                        </div>
                      </td>
                      <td>
                        <div className="reservation-unit">
                          <strong>
                            {c.empreendimento || "CAT001 - Residencial Vivaz"}
                          </strong>
                          <span>
                            {c.unidade ||
                              `BLOCO ${20 + index} · 000${index + 1}`}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="creditu-cell">
                          <span
                            className={`creditu-status ${c.creditu ? "active" : "inactive"}`}
                          >
                            {c.creditu
                              ? c.situacaoCreditu || "Aguardando análise"
                              : "Sem Creditú"}
                          </span>
                          <small>
                            {c.creditu
                              ? "Processo vinculado"
                              : "Não contratado"}
                          </small>
                        </div>
                      </td>
                      <td>
                        <span
                          className={`situation-pill ${/pend/i.test(c.status) ? "pending" : "process"}`}
                        >
                          {etapa}
                        </span>
                      </td>
                      <td>
                        <span className={`deadline-dot ${c.prioridade}`} />
                        <span className="deadline-text">
                          {c.prioridade === "vermelha"
                            ? "Atrasado"
                            : c.prioridade === "amarela"
                              ? "Atenção"
                              : "No prazo"}
                        </span>
                      </td>
                      <td>
                        <div className="reservation-options">
                          <button className="comment-option">
                            <MessageCircle size={15} />
                            <b>{index + 2}</b>
                          </button>
                          <button
                            className="open-reservation"
                            onClick={() => abrir(c)}
                          >
                            Abrir <ChevronRight size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span>Mostrando {filtrados.length} reservas</span>
            <div>
              <button disabled>Anterior</button>
              <button className="page-number">1</button>
              <button disabled>Próxima</button>
            </div>
          </div>
        </section>
      ) : (
        <KanbanReservas clientes={clientes} etapas={etapas} abrir={abrir} />
      )}
    </div>
  );
}

function KanbanReservas({ clientes, etapas, abrir }) {
  const colunas = [
    { nome: "Em processo", cor: "#d64a43", indices: [0, 1] },
    { nome: "Secretaria de vendas", cor: "#19b8d5", indices: [2] },
    { nome: "Envio SIENGE", cor: "#f04444", indices: [3] },
    { nome: "Crédito", cor: "#24bd5c", indices: [4, 5] },
    { nome: "Fase Creditú", cor: "#c39362", indices: [6] },
    { nome: "Assinatura", cor: "#ded719", indices: [7] },
    { nome: "Aprovado Diretoria", cor: "#e6b91e", indices: [8] },
    { nome: "Venda finalizada", cor: "#17883b", indices: [9] },
  ];
  return (
    <section className="kanban-shell">
      <div className="kanban-toolbar">
        <button className="filter-button">
          <Filter size={16} /> Filtros
        </button>
        <div>
          <span>
            <i className="legend green" /> No prazo
          </span>
          <span>
            <i className="legend amber" /> Atenção
          </span>
          <span>
            <i className="legend red" /> Atrasado
          </span>
        </div>
      </div>
      <div className="kanban-scroll">
        <div className="kanban-board">
          {colunas.map((coluna, colunaIndex) => {
            const cards = clientes.filter((c) =>
              coluna.indices.includes(c.etapaAtual),
            );
            const valor = cards.reduce(
              (total, _, index) => total + 128400 + index * 21650,
              0,
            );
            return (
              <div className="kanban-column" key={coluna.nome}>
                <div
                  className="kanban-column-head"
                  style={{ "--stage-color": coluna.cor }}
                >
                  <strong>{coluna.nome}</strong>
                  <span>
                    {cards.length} reserva{cards.length === 1 ? "" : "s"}
                  </span>
                  <small>
                    {valor.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
                  </small>
                </div>
                <div className="kanban-cards">
                  {cards.length ? (
                    cards.map((c, index) => (
                      <article
                        className="kanban-card"
                        key={c.id}
                        onClick={() => abrir(c)}
                      >
                        <div className="kanban-card-top">
                          <strong>#{c.reserva}</strong>
                          <span className={`mini-priority ${c.prioridade}`}>
                            {c.prioridade === "vermelha"
                              ? "Atrasado"
                              : c.prioridade === "amarela"
                                ? "Atenção"
                                : "No prazo"}
                          </span>
                          <MoreHorizontal size={15} />
                        </div>
                        <h3>{c.cliente}</h3>
                        <p>
                          <Building2 size={13} />
                          {c.unidade ||
                            `Bloco ${20 + colunaIndex} · 000${index + 1}`}
                        </p>
                        <p>
                          <UserRound size={13} />
                          {c.corretor || "Responsável não definido"}
                        </p>
                        <div className="kanban-card-bottom">
                          <b>
                            R${" "}
                            {(128400 + index * 21650).toLocaleString("pt-BR")}
                            ,00
                          </b>
                          <span>
                            <MessageCircle size={13} /> {index + 2}
                          </span>
                        </div>
                      </article>
                    ))
                  ) : (
                    <div className="empty-column">
                      <ClipboardList size={20} />
                      <span>Nenhuma reserva nesta etapa</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Repasses({ clientes, etapas, abrir }) {
  const [subaba, setSubaba] = useState("gestao");
  const [busca, setBusca] = useState("");
  const clientesRepasse = clientes.filter((c) => Number(c.etapaAtual) >= 7);
  const filtrados = clientesRepasse.filter((c) =>
    `${c.reserva} ${c.cliente} ${c.corretor}`
      .toLowerCase()
      .includes(busca.toLowerCase()),
  );
  const statusRepasse = [
    "Início",
    "Em andamento",
    "Assinatura Caixa",
    "Validação",
    "Garantia AGEHAB",
    "Em processo de distrato",
  ];
  return (
    <div className="repasses-view">
      <div className="breadcrumb">
        <span>Financeiro</span>
        <ChevronRight size={14} />
        <span>Repasses</span>
      </div>
      <section className="page-heading reservations-heading">
        <div>
          <span className="eyebrow">OPERAÇÃO FINANCEIRA</span>
          <h1>
            {subaba === "andamento"
              ? "Andamento dos repasses"
              : "Gestão de repasses"}
          </h1>
          <p>Acompanhe valores, prazos e etapas financeiras de cada venda.</p>
        </div>
        <button className="primary-button">
          <Plus size={17} /> Gerar repasse
        </button>
      </section>
      <div className="reservation-nav repasse-nav">
        <button
          className={subaba === "gestao" ? "active" : ""}
          onClick={() => setSubaba("gestao")}
        >
          <CircleDollarSign size={16} /> Gestão de repasses
        </button>
        <button
          className={subaba === "andamento" ? "active" : ""}
          onClick={() => setSubaba("andamento")}
        >
          <TrendingUp size={16} /> Andamento dos repasses
        </button>
        <button>
          <Building2 size={16} /> Mapa de repasses
        </button>
        <button>
          <Users size={16} /> Distribuição
        </button>
      </div>
      {subaba === "gestao" ? (
        <section className="content-card reservation-list-card">
          <div className="reservation-toolbar">
            <label className="search-box">
              <Search size={18} />
              <input
                placeholder="Buscar repasse ou cliente"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
              />
            </label>
            <button className="filter-button">
              <Filter size={17} /> Filtrar
            </button>
            <div className="status-counters">
              <button className="active">
                <b>{clientesRepasse.length}</b>
                <span>Ativos</span>
              </button>
              <button>
                <b>
                  {
                    clientesRepasse.filter((c) =>
                      /andamento/i.test(statusRepasseDoCliente(c)),
                    ).length
                  }
                </b>
                <span>Em andamento</span>
              </button>
              <button>
                <b>
                  {
                    clientesRepasse.filter(
                      (c) =>
                        /assinatura caixa/i.test(statusRepasseDoCliente(c)) &&
                        c.dataAssinatura,
                    ).length
                  }
                </b>
                <span>Assinados</span>
              </button>
            </div>
          </div>
          <div className="results-label">
            <strong>{filtrados.length}</strong> repasses encontrados
          </div>
          <div className="reservation-table-wrap">
            <table className="reservation-table transfer-table">
              <thead>
                <tr>
                  <th>Repasse</th>
                  <th>Cliente</th>
                  <th>Unidade</th>
                  <th>Responsável</th>
                  <th>Situação do repasse</th>
                  <th>Situação da reserva</th>
                  <th>Opções</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((c, index) => (
                  <tr key={c.id}>
                    <td>
                      <div className="reservation-number">
                        <strong>#{5655 - index}</strong>
                        <span>Cadastrado em 03/07/2026</span>
                        <small>
                          {index % 3
                            ? "Sem alterações"
                            : "Alterado recentemente"}
                        </small>
                      </div>
                    </td>
                    <td>
                      <div className="reservation-client">
                        <strong>{c.cliente}</strong>
                        <span>{c.telefone}</span>
                      </div>
                    </td>
                    <td>
                      <div className="reservation-unit">
                        <strong>
                          {c.empreendimento || "CAT001 - Residencial Vivaz"}
                        </strong>
                        <span>
                          {c.unidade || `Bloco ${20 + index} · 000${index + 1}`}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="reservation-owner">
                        <span>Empresa / Usuário</span>
                        <strong>{c.corretor}</strong>
                      </div>
                    </td>
                    <td>
                      <span className={`transfer-status s${index % 6}`}>
                        {statusRepasseDoCliente(c)}
                      </span>
                      <small className="status-time">
                        {/assinatura caixa/i.test(statusRepasseDoCliente(c)) &&
                        !c.dataAssinatura
                          ? "Autorizado a assinar"
                          : c.dataAssinatura
                            ? `Assinado em ${new Date(`${c.dataAssinatura}T12:00:00`).toLocaleDateString("pt-BR")}`
                            : `Tempo na situação: ${(index % 3) + 1} dia(s)`}
                      </small>
                    </td>
                    <td>
                      <span className="reservation-stage">
                        {etapas[c.etapaAtual] || "Em processo"}
                      </span>
                      <small className="status-time">
                        Reserva: #{c.reserva}
                      </small>
                    </td>
                    <td>
                      <div className="reservation-options">
                        <button className="comment-option">Ficha</button>
                        <button
                          className="open-reservation"
                          onClick={() => abrir(c)}
                        >
                          Abrir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span>Mostrando {filtrados.length} repasses</span>
            <div>
              <button disabled>Anterior</button>
              <button className="page-number">1</button>
              <button disabled>Próxima</button>
            </div>
          </div>
        </section>
      ) : (
        <KanbanRepasses clientes={clientesRepasse} abrir={abrir} />
      )}
    </div>
  );
}

function KanbanRepasses({ clientes, abrir }) {
  const colunas = [
    ["Início do repasse", "#8fa7aa"],
    ["Em andamento", "#19c3d2"],
    ["Assinatura Caixa", "#e6a9aa"],
    ["Validação assinatura", "#16a8e0"],
    ["Em andamento · Garantia", "#4e4e50"],
    ["Garantia AGEHAB", "#254a46"],
    ["Em processo de distrato", "#eab420"],
    ["Venda direta", "#8b5ca8"],
  ];
  return (
    <section className="kanban-shell repasse-kanban">
      <div className="kanban-toolbar">
        <button className="filter-button">
          <Filter size={16} /> Filtros
        </button>
        <div>
          <span>Valor financiado</span>
          <span>Valor previsto</span>
          <span>Saldo devedor</span>
        </div>
      </div>
      <div className="kanban-scroll">
        <div className="kanban-board repasse-board">
          {colunas.map(([nome, cor], colunaIndex) => {
            const cards = clientes.filter(
              (_, index) => index % colunas.length === colunaIndex,
            );
            const valor = cards.reduce(
              (total, _, index) => total + 168650 + index * 12400,
              0,
            );
            return (
              <div className="kanban-column" key={nome}>
                <div
                  className="kanban-column-head"
                  style={{ "--stage-color": cor }}
                >
                  <strong>{nome}</strong>
                  <span>
                    {cards.length} repasse{cards.length === 1 ? "" : "s"}
                  </span>
                  <small>
                    {valor.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    })}
                  </small>
                </div>
                <div className="kanban-cards">
                  {cards.map((c, index) => (
                    <article
                      className="kanban-card transfer-card"
                      key={c.id}
                      onClick={() => abrir(c)}
                    >
                      <div className="kanban-card-top">
                        <strong>#{5664 - colunaIndex - index}</strong>
                        <span className="mini-priority verde">{nome}</span>
                        <MoreHorizontal size={15} />
                      </div>
                      <h3>{c.cliente}</h3>
                      <p>
                        <Building2 size={13} />
                        {c.unidade || `Bloco ${20 + index} · 000${index + 1}`}
                      </p>
                      <p>
                        <UserRound size={13} />
                        {c.corretor}
                      </p>
                      <div className="kanban-card-bottom">
                        <b>
                          R$ {(168650 + index * 12400).toLocaleString("pt-BR")}
                          ,00
                        </b>
                        <span>
                          <MessageCircle size={13} /> {index + 1}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function DetalheRepasse({ cliente, voltar, atualizar }) {
  const [aba, setAba] = useState("valores");
  const [salvo, setSalvo] = useState(false);
  const [dados, setDados] = useState({
    numeroRepasse: cliente.numeroRepasse || "5664",
    empreendimento: cliente.empreendimento || "CAT001 - Residencial Vivaz",
    unidade: cliente.unidade || "BLOCO 20 - 0004",
    situacaoRepasse: statusRepasseDoCliente(cliente),
    correspondente: "SUPER A - CCA",
    usuarioCorrespondente: "Windson Yule Silva Lima",
    agencia: "",
    valorPrevisto: "168.669,11",
    valorDivida: "144.202,11",
    valorSubsidio: "24.467,00",
    valorFgts: "0,00",
    valorFinanciado: "168.669,11",
    saldoDevedor: "0,00",
    parcelaConclusao: "713,99",
    valorContrato: "230.000,11",
    parcelaBaixada: "Não",
    fgtsFuturo: "",
    situacaoSinal: "",
    obsSinal: "",
    valorRegistro: "",
    registroPago: "Não",
    dataRegistro: "",
    recebimentoCef: "",
    unidadeContratoConfere: "Sim",
    protocoloOnr: "",
    protocoloCartorio: "",
    excedenteCobranca: "",
    pagamentoRegistro: "",
    dataExigencia: "",
    kitRegistroOk: "",
    cumprimentoExigencia: "",
    envioGarantia: "",
    conformidadeGarantia: "",
    obsGarantia: "",
    solicitacaoPagamentoRegistro: "",
    tituloPrenotacao: "",
    situacaoPrenotacao: "",
    tituloTaxaRegistro: "",
    situacaoTaxaRegistro: "",
    obsCartorio: "",
    onr: "",
    numeroContrato: "",
    situacaoContrato: "Contrato adimplente",
    contratoQuitado: "Não",
    contratoLiquidado: "Não",
    contratoContabilizado: "2026-07-03",
    contratoLiberado: "",
    proximaAcao: "",
    dataConfissao: "",
    dataAprovacaoSv: "",
    dataEnvioConfissao: "2026-06-25",
    dataAssinaturaConfissao: "2026-06-25",
    confissaoExcecao: "Não",
    tipoExcecao: "",
    scoreFiador: "",
    obsFiador: "",
    liberarAssinatura: "Não",
    numeroMatricula: "",
    dataAssinatura: "",
    financiamentoRecebido: "Não",
    inconformidadeCehop: "",
    reenvioCehop: "",
    espelhoAnexado: "2026-06-26",
    validacaoEspelho: "2026-06-26",
    espelhoAprovado: "Sim",
    envioComiteCef: "",
    emissaoMinuta: "",
    envioCehop: "2026-06-02",
    conformidadeCehop: "2026-06-09",
    itbiPago: "Não",
    laudemioPago: "Não",
    unidadeLiberada: "",
    valorProdutoCaixa: "",
    pagamentoProdutoCaixa: "",
    vencimentoProdutoCaixa: "",
    tituloProduto: "",
    pagamentoItbi: "",
    solicitacaoItbi: "",
    solicitacaoPagamentoItbi: "",
    protocoloItbi: "",
    valorItbi: "",
    obsPrefeitura: "",
    tituloItbi: "",
    fichaAgehab: "",
    cadastroFichaAgehab: "",
    envioFichaAgehab: "",
    aprovacaoFichaAgehab: "",
    solicitacaoContratoAgehab: "",
    recebimentoContratoAgehab: "",
    envioContratoRepasse: "",
    recebimentoContratoRepasse: "",
    assinaturaContratoAgehab: "",
    envioContratoAgehab: "",
    contratoValidadoAgehab: "",
    obsAgehab: "",
    ...cliente,
  });
  const campo = (nome, valor) => {
    setDados((atual) => ({ ...atual, [nome]: valor }));
    setSalvo(false);
  };
  async function salvar(e) {
    e.preventDefault();
    await atualizar(cliente.id, dados);
    setSalvo(true);
  }

  return (
    <div className="reservation-detail transfer-detail">
      <div className="detail-topline">
        <button className="back-button" onClick={voltar}>
          <ArrowLeft size={17} /> Voltar para repasses
        </button>
        <div className="breadcrumb">
          <span>Financeiro</span>
          <ChevronRight size={14} />
          <span>Repasse #{dados.numeroRepasse}</span>
        </div>
      </div>
      <section className="detail-hero transfer-hero">
        <div className="reservation-badge">
          <CircleDollarSign size={22} />
        </div>
        <div className="detail-title">
          <span className="eyebrow">REPASSE #{dados.numeroRepasse}</span>
          <h1>{dados.cliente}</h1>
          <p>Aberto em 03/07/2026 às 11h29 · Operação financeira</p>
        </div>
        <div className="hero-meta">
          <span>EMPREENDIMENTO</span>
          <strong>{dados.empreendimento}</strong>
          <small>Unidade {dados.unidade}</small>
        </div>
        <span className="hero-status">
          <i /> {dados.situacaoRepasse}
        </span>
      </section>
      <section className="detail-summary transfer-summary">
        <div>
          <span>Valor financiado</span>
          <strong>R$ {dados.valorFinanciado}</strong>
        </div>
        <div>
          <span>Saldo devedor</span>
          <strong>R$ {dados.saldoDevedor}</strong>
        </div>
        <div>
          <span>Correspondente</span>
          <strong>{dados.correspondente}</strong>
        </div>
        <div>
          <span>Situação da reserva</span>
          <strong>{dados.status}</strong>
        </div>
      </section>
      <div className="detail-tabs transfer-tabs">
        <button
          className={aba === "valores" ? "active" : ""}
          onClick={() => setAba("valores")}
        >
          <CircleDollarSign size={17} /> Valores e cliente
        </button>
        <button
          className={aba === "registro" ? "active" : ""}
          onClick={() => setAba("registro")}
        >
          <FileText size={17} /> Registro
        </button>
        <button
          className={aba === "contrato" ? "active" : ""}
          onClick={() => setAba("contrato")}
        >
          <ClipboardList size={17} /> Contrato e assinatura
        </button>
        <button
          className={aba === "impostos" ? "active" : ""}
          onClick={() => setAba("impostos")}
        >
          <Building2 size={17} /> Impostos e AGEHAB
        </button>
      </div>
      <form className="detail-form" onSubmit={salvar}>
        {aba === "valores" && (
          <>
            <DetailSection
              titulo="Valores do repasse"
              subtitulo="Composição financeira da operação"
            >
              <Campo
                label="Situação do repasse"
                nome="situacaoRepasse"
                dados={dados}
                campo={campo}
                opcoes={[
                  "Início do repasse",
                  "Em andamento",
                  "Assinatura Caixa",
                ]}
              />
              <Campo
                label="Valor previsto"
                nome="valorPrevisto"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Valor da dívida"
                nome="valorDivida"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Valor do subsídio"
                nome="valorSubsidio"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Valor do FGTS"
                nome="valorFgts"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Valor financiado"
                nome="valorFinanciado"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Saldo devedor"
                nome="saldoDevedor"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Parcela de conclusão"
                nome="parcelaConclusao"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Valor do contrato"
                nome="valorContrato"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Parcela baixada"
                nome="parcelaBaixada"
                dados={dados}
                campo={campo}
                opcoes={["Não", "Sim"]}
              />
            </DetailSection>
            <DetailSection
              titulo="Responsáveis"
              subtitulo="Correspondente e agência bancária"
            >
              <Campo
                label="Correspondente"
                nome="correspondente"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Usuário correspondente"
                nome="usuarioCorrespondente"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Agência"
                nome="agencia"
                dados={dados}
                campo={campo}
              />
            </DetailSection>
          </>
        )}
        {aba === "registro" && (
          <DetailSection
            titulo="Registro e cartório"
            subtitulo="Protocolos, pagamentos e exigências"
          >
            <Campo
              label="Valor do registro"
              nome="valorRegistro"
              dados={dados}
              campo={campo}
            />
            <Campo
              label="Registro pago"
              nome="registroPago"
              dados={dados}
              campo={campo}
              opcoes={["Não", "Sim"]}
            />
            <Campo
              label="Data do registro"
              nome="dataRegistro"
              dados={dados}
              campo={campo}
              tipo="date"
            />
            <Campo
              label="Recebimento contrato CEF"
              nome="recebimentoCef"
              dados={dados}
              campo={campo}
              tipo="date"
            />
            <Campo
              label="Unidade confere com contrato CEF?"
              nome="unidadeContratoConfere"
              dados={dados}
              campo={campo}
              opcoes={["Sim", "Não"]}
            />
            <Campo
              label="Protocolo ONR"
              nome="protocoloOnr"
              dados={dados}
              campo={campo}
            />
            <Campo
              label="Protocolo no cartório"
              nome="protocoloCartorio"
              dados={dados}
              campo={campo}
            />
            <Campo
              label="Excedente de cobrança"
              nome="excedenteCobranca"
              dados={dados}
              campo={campo}
            />
            <Campo
              label="Pagamento do registro"
              nome="pagamentoRegistro"
              dados={dados}
              campo={campo}
              tipo="date"
            />
            <Campo
              label="Data da exigência"
              nome="dataExigencia"
              dados={dados}
              campo={campo}
              tipo="date"
            />
            <Campo
              label="Kit registro OK"
              nome="kitRegistroOk"
              dados={dados}
              campo={campo}
              tipo="date"
            />
            <Campo
              label="Cumprimento da exigência"
              nome="cumprimentoExigencia"
              dados={dados}
              campo={campo}
              tipo="date"
            />
            <Campo
              label="Título prenotação"
              nome="tituloPrenotacao"
              dados={dados}
              campo={campo}
            />
            <Campo
              label="Situação prenotação"
              nome="situacaoPrenotacao"
              dados={dados}
              campo={campo}
            />
            <Campo
              label="Observação cartório"
              nome="obsCartorio"
              dados={dados}
              campo={campo}
            />
          </DetailSection>
        )}
        {aba === "contrato" && (
          <>
            <DetailSection
              titulo="Contrato"
              subtitulo="Situação contratual e confissão de dívida"
            >
              <Campo
                label="Número do contrato"
                nome="numeroContrato"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Situação do contrato"
                nome="situacaoContrato"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Contrato quitado"
                nome="contratoQuitado"
                dados={dados}
                campo={campo}
                opcoes={["Não", "Sim"]}
              />
              <Campo
                label="Contrato liquidado"
                nome="contratoLiquidado"
                dados={dados}
                campo={campo}
                opcoes={["Não", "Sim"]}
              />
              <Campo
                label="Data contabilizada"
                nome="contratoContabilizado"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Liberado para repasse"
                nome="contratoLiberado"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Próxima ação"
                nome="proximaAcao"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Envio confissão de dívida"
                nome="dataEnvioConfissao"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Assinatura confissão"
                nome="dataAssinaturaConfissao"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Creditú"
                nome="creditu"
                dados={dados}
                campo={campo}
                opcoes={[true, false]}
                formatar={(v) => (v ? "Sim" : "Não")}
              />
            </DetailSection>
            <DetailSection
              titulo="Assinatura e matrícula"
              subtitulo="Liberação, financiamento e validações"
            >
              <Campo
                label="Liberar assinatura"
                nome="liberarAssinatura"
                dados={dados}
                campo={campo}
                opcoes={["Não", "Sim"]}
              />
              <Campo
                label="Número da matrícula"
                nome="numeroMatricula"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Data da assinatura"
                nome="dataAssinatura"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Financiamento recebido"
                nome="financiamentoRecebido"
                dados={dados}
                campo={campo}
                opcoes={["Não", "Sim"]}
              />
              <Campo
                label="Validação do espelho"
                nome="validacaoEspelho"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Espelho anexado"
                nome="espelhoAnexado"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Envio CEHOP"
                nome="envioCehop"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Conformidade CEHOP"
                nome="conformidadeCehop"
                dados={dados}
                campo={campo}
                tipo="date"
              />
            </DetailSection>
          </>
        )}
        {aba === "impostos" && (
          <>
            <DetailSection
              titulo="Impostos e liberação"
              subtitulo="ITBI, laudêmio e produto Caixa"
            >
              <Campo
                label="ITBI pago"
                nome="itbiPago"
                dados={dados}
                campo={campo}
                opcoes={["Não", "Sim"]}
              />
              <Campo
                label="Laudêmio pago"
                nome="laudemioPago"
                dados={dados}
                campo={campo}
                opcoes={["Não", "Sim"]}
              />
              <Campo
                label="Unidade liberada"
                nome="unidadeLiberada"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Valor produto Caixa"
                nome="valorProdutoCaixa"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Pagamento produto Caixa"
                nome="pagamentoProdutoCaixa"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Vencimento produto Caixa"
                nome="vencimentoProdutoCaixa"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Pagamento do ITBI"
                nome="pagamentoItbi"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Protocolo ITBI"
                nome="protocoloItbi"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Valor ITBI"
                nome="valorItbi"
                dados={dados}
                campo={campo}
              />
            </DetailSection>
            <DetailSection
              titulo="Campos AGEHAB"
              subtitulo="Ficha, contrato e validação"
            >
              <Campo
                label="Nº ficha AGEHAB"
                nome="fichaAgehab"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Cadastro da ficha"
                nome="cadastroFichaAgehab"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Envio da ficha"
                nome="envioFichaAgehab"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Aprovação da ficha"
                nome="aprovacaoFichaAgehab"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Solicitação contrato AGEHAB"
                nome="solicitacaoContratoAgehab"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Recebimento contrato AGEHAB"
                nome="recebimentoContratoAgehab"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Assinatura contrato AGEHAB"
                nome="assinaturaContratoAgehab"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Contrato validado"
                nome="contratoValidadoAgehab"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Observações AGEHAB"
                nome="obsAgehab"
                dados={dados}
                campo={campo}
              />
            </DetailSection>
          </>
        )}
        <div className="detail-actions">
          <span className={salvo ? "saved-message show" : "saved-message"}>
            <Check size={15} /> Alterações salvas
          </span>
          <button type="button" className="secondary-button" onClick={voltar}>
            Cancelar
          </button>
          <button className="primary-button">
            <Save size={16} /> Salvar repasse
          </button>
        </div>
      </form>
    </div>
  );
}

function DetalheReserva({ cliente, etapas, voltar, atualizar }) {
  const [aba, setAba] = useState("gerais");
  const [novaMensagem, setNovaMensagem] = useState("");
  const [mensagens, setMensagens] = useState([
    {
      autor: "Michelle Deisy Pereira da Silva",
      papel: "Correspondente",
      data: "02/07/2026 às 14h02",
      texto:
        "Em caso de fechamento, apresentar os 3 últimos contracheques para validação das bonificações. Dados da avaliação e proposta bancária conferidos.",
    },
    {
      autor: "Bianca de Sousa Ferreira",
      papel: "Corretor",
      data: "02/07/2026 às 13h23",
      texto:
        "Cliente trabalha com serviços gerais desde 2024, com renda aproximada informada e documentação enviada para análise.",
    },
  ]);
  const [contratos, setContratos] = useState([
    ["48943", "Venda", "QR da unidade · Padrão cônjuge"],
    ["48942", "Venda", "Instrumento particular · Creditú"],
    ["48941", "Venda", "Memorial do empreendimento"],
    ["48940", "Venda", "Confissão de dívidas"],
    ["48939", "Venda", "Planta da unidade"],
  ]);
  const [documentos, setDocumentos] = useState([
    ["RG.jpeg", "RG principal"],
    ["RG 2.jpeg", "RG principal"],
    ["CPF.jpeg", "CPF principal"],
    ["CPF 2.jpeg", "CPF principal"],
    ["RESIDÊNCIA.jpeg", "Comprovante de residência"],
    ["RESIDÊNCIA 2.jpeg", "Comprovante de residência"],
    ["CONTRA_CHEQUE.jpeg", "Comprovante de renda"],
    ["Simulação 360 meses.pdf", "Simulação CCA"],
    ["Simulação 420 meses.pdf", "Simulação CCA"],
  ]);
  const [documentosSelecionados, setDocumentosSelecionados] = useState(
    new Set(),
  );
  const [menuDocumento, setMenuDocumento] = useState(null);
  const [arrastandoDocumento, setArrastandoDocumento] = useState(false);
  const [listaDocumentosAberta, setListaDocumentosAberta] = useState(false);
  useEffect(() => {
    if (!supabaseClient) return;
    supabaseClient
      .from("reservation_documents")
      .select(
        "id, file_name, document_type, person_type, storage_path, mime_type, size_bytes, status, created_at",
      )
      .eq("reservation_id", cliente.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data)
          setDocumentos(
            data.map((doc) => [doc.file_name, doc.document_type, doc]),
          );
      });
    supabaseClient
      .from("reservation_messages")
      .select("id, body, created_at, author_id")
      .eq("reservation_id", cliente.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data)
          setMensagens(
            data.map((msg) => ({
              id: msg.id,
              autor: "Usuário da organização",
              papel: "Equipe",
              data: new Date(msg.created_at).toLocaleString("pt-BR"),
              texto: msg.body,
            })),
          );
      });
  }, [cliente.id]);
  const [dados, setDados] = useState({
    empreendimento: "CAT001 - Residencial Vivaz",
    unidade: "BLOCO 20 - 0004",
    previsaoEntrega: "01/05/2029",
    contratoAssinado: "Não",
    mesCompetencia: "Julho / 2026",
    tipoReserva: "Venda direta",
    numeroVenda: "",
    titulo: "",
    dataPosse: "",
    dataContrato: "",
    dataVenda: "",
    dataCarta: "2026-05-31",
    classificacaoPosVenda: "",
    classificacaoCliente: "",
    condicionante: "",
    integracaoComissao: "",
    tresAnosFgts: "Não",
    rendaFormal: "0,01",
    rendaInformal: "2.380,00",
    tipoRenda: "Informal",
    situacaoCreditu: "Aguardando análise",
    quantidadeFilhos: "",
    categoriaFiador: "",
    cidadeOrigem: "",
    bairroOrigem: "",
    contratoPortal: "",
    excecaoCaixa: "",
    bonusAp: "",
    comissaoAp: "",
    dataEnvioCehop: "2026-06-02",
    dataConformidadeCehop: "2026-06-09",
    dataConfissao: "2026-06-25",
    dataAssinaturaConfissao: "2026-06-25",
    dataValidacaoEspelho: "2026-06-26",
    dataEspelhoAnexado: "2026-06-26",
    observacaoFinalizacao: "Entrevista realizada.",
    tabelaPreco: "Tabela padrão",
    seriePagamento: "Entrada / Sinal",
    formaPagamento: "Boleto",
    parcelas: "1",
    valorParcela: "5.400,00",
    primeiroVencimento: "2026-07-07",
    indexador: "REAL",
    juros: "0,16%",
    valorContratoReserva: "248.000,00",
    valorPresente: "248.406,02",
    tipoVendaFinanceiro: "",
    empresaCorrespondente: "Endy Carvalho Consultoria Imobiliária",
    correspondenteFinanceiro: "",
    grupoDocumento: "Documentação pessoal",
    pessoaDocumento: "Titular",
    tipoDocumento: "RG/CPF do proponente",
    ...cliente,
  });
  const [salvo, setSalvo] = useState(false);
  const campo = (nome, valor) => {
    setDados((atual) => ({ ...atual, [nome]: valor }));
    setSalvo(false);
  };
  async function salvar(e) {
    e.preventDefault();
    await atualizar(cliente.id, dados);
    setSalvo(true);
  }
  async function cadastrarMensagem() {
    const body = novaMensagem.trim();
    if (!body) return;
    if (!supabaseClient) {
      setMensagens((atuais) => [
        {
          autor: "Danilo Mendes",
          papel: "Administrador",
          data: "Agora",
          texto: body,
        },
        ...atuais,
      ]);
      setNovaMensagem("");
      return;
    }
    const { user, organizationId } = await currentAccessContext();
    const { data, error } = await supabaseClient
      .from("reservation_messages")
      .insert({
        organization_id: organizationId,
        reservation_id: cliente.id,
        author_id: user.id,
        body,
        audience: ["imobiliaria", "corretor", "correspondente", "repasse"],
      })
      .select("id, body, created_at")
      .single();
    if (error) return alert(error.message);
    setMensagens((atuais) => [
      {
        id: data.id,
        autor: user.user_metadata?.full_name || user.email,
        papel: "Equipe",
        data: "Agora",
        texto: data.body,
      },
      ...atuais,
    ]);
    setNovaMensagem("");
  }
  const progresso = etapas.length
    ? Math.round(((dados.etapaAtual + 1) / etapas.length) * 100)
    : 0;
  const progressoDocumentos = Math.min((documentos.length / 14) * 100, 100);
  const gruposDoTipoDocumento = (tipo) => {
    const equivalentes = equivalentesDoDocumento(tipo);
    const grupos = gruposDocumentos.filter((grupo) => grupo.documentos.some((documento) => equivalentes.includes(documento))).map((grupo) => grupo.nome);
    return grupos.length ? grupos : ["Documentos anteriores"];
  };
  const documentosAgrupados = [
    ...gruposDocumentos.map((grupo) => grupo.nome),
    "Documentos anteriores",
  ]
    .map((nome) => ({
      nome,
      documentos: documentos
        .map((doc, index) => ({ doc, index }))
        .filter((item) => gruposDoTipoDocumento(item.doc[1]).includes(nome)),
    }))
    .filter((grupo) => grupo.documentos.length);
  const documentosOrdenados = documentosAgrupados.flatMap((grupo) =>
    grupo.documentos.map((item) => ({
      ...item,
      grupo: grupo.nome,
      totalGrupo: grupo.documentos.length,
    })),
  );
  const chaveDocumento = (doc, index) => doc[2]?.id || `${doc[0]}-${index}`;
  async function adicionarDocumentos(files) {
    const permitidos = /\.(jpe?g|gif|png|bmp|pdf|xls|xlsx|rar|zip|doc|docx)$/i;
    const validos = [...files].filter(
      (file) => permitidos.test(file.name) && file.size <= 24 * 1024 * 1024,
    );
    if (!validos.length)
      throw new Error("Selecione arquivos suportados com até 24 MB.");
    const novos = supabaseClient
      ? await uploadReservationDocuments(
          validos,
          cliente.id,
          dados.pessoaDocumento,
          dados.tipoDocumento,
        )
      : await Promise.all(validos.map(async (file) => {
          const { conteudo, comprimido } = await compactarArquivo(file);
          return [file.name, dados.tipoDocumento || "Documento adicional", {
            local_file: conteudo, compressed: comprimido, mime_type: file.type,
            person_type: dados.pessoaDocumento || "Titular", status: "pending", created_at: new Date().toISOString(),
          }];
        }));
    setDocumentos((atuais) => [...novos, ...atuais]);
    if (validos.length !== files.length)
      alert("Alguns arquivos foram ignorados por formato ou tamanho.");
  }
  async function urlDocumento(doc) {
    if (doc[2]?.local_file) {
      if (!doc[2].compressed) return URL.createObjectURL(doc[2].local_file);
      const stream = doc[2].local_file.stream().pipeThrough(new DecompressionStream('gzip'));
      const blob = await new Response(stream).blob();
      return URL.createObjectURL(new Blob([blob], { type: doc[2].mime_type || 'application/octet-stream' }));
    }
    if (supabaseClient && doc[2]?.storage_path) {
      const { data, error } = await supabaseClient.storage
        .from("reservation-documents")
        .createSignedUrl(doc[2].storage_path, 60);
      if (error) throw error;
      if (doc[2].storage_path.endsWith('.gz')) {
        const response = await fetch(data.signedUrl);
        if (!response.ok) throw new Error('Não foi possível carregar o arquivo comprimido.');
        const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
        const blob = await new Response(stream).blob();
        return URL.createObjectURL(new Blob([blob], { type: doc[2].mime_type || 'application/octet-stream' }));
      }
      return data.signedUrl;
    }
    throw new Error("Arquivo demonstrativo sem conteúdo vinculado.");
  }
  async function abrirDocumento(doc, baixar = false) {
    try {
      const url = await urlDocumento(doc);
      const link = document.createElement("a");
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      if (baixar) link.download = doc[0];
      link.click();
      if (doc[2]?.local_file || doc[2]?.storage_path?.endsWith('.gz')) setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      alert(error.message);
    }
    setMenuDocumento(null);
  }
  async function revisarDocumento(doc, index, status) {
    try {
      if (supabaseClient && doc[2]?.id) {
        const { user } = await currentAccessContext();
        const { error } = await supabaseClient
          .from("reservation_documents")
          .update({
            status,
            reviewed_by: user.id,
            reviewed_at: new Date().toISOString(),
          })
          .eq("id", doc[2].id);
        if (error) throw error;
      }
      setDocumentos((atuais) =>
        atuais.map((item, i) =>
          i === index ? [item[0], item[1], { ...item[2], status }] : item,
        ),
      );
    } catch (error) {
      alert(error.message);
    }
    setMenuDocumento(null);
  }
  async function excluirDocumento(doc, index) {
    try {
      if (supabaseClient && doc[2]?.id) {
        const { role } = await currentAccessContext();
        if (!["owner", "admin"].includes(role))
          throw new Error("Apenas administradores podem excluir documentos");
        await supabaseClient.storage
          .from("reservation-documents")
          .remove([doc[2].storage_path]);
        const { error } = await supabaseClient
          .from("reservation_documents")
          .delete()
          .eq("id", doc[2].id);
        if (error) throw error;
      }
      const chave = chaveDocumento(doc, index);
      setDocumentos((atuais) => atuais.filter((_, i) => i !== index));
      setDocumentosSelecionados((atuais) => {
        const novos = new Set(atuais);
        novos.delete(chave);
        return novos;
      });
    } catch (error) {
      alert(error.message);
    }
    setMenuDocumento(null);
  }

  return (
    <div className="reservation-detail">
      <div className="detail-topline">
        <button className="back-button" onClick={voltar}>
          <ArrowLeft size={17} /> Voltar para clientes
        </button>
        <div className="breadcrumb">
          <span>Comercial</span>
          <ChevronRight size={14} />
          <span>Reserva #{dados.reserva}</span>
        </div>
      </div>
      <section className="detail-hero">
        <div className="reservation-badge">
          <FileText size={21} />
        </div>
        <div className="detail-title">
          <span className="eyebrow">RESERVA #{dados.reserva}</span>
          <h1>{dados.cliente}</h1>
          <p>Criada em 31/05/2026 às 10h39 · Atualizada recentemente</p>
        </div>
        <div className="hero-meta">
          <span>EMPREENDIMENTO</span>
          <strong>{dados.empreendimento}</strong>
          <small>Unidade {dados.unidade}</small>
        </div>
        <span className="hero-status">
          <i /> {dados.status}
        </span>
      </section>

      <section className="detail-summary">
        <div>
          <span>Etapa atual</span>
          <strong>{etapas[dados.etapaAtual] || "Em processo"}</strong>
        </div>
        <div className="summary-progress">
          <span>
            Progresso da jornada <b>{progresso}%</b>
          </span>
          <div>
            <i style={{ width: `${progresso}%` }} />
          </div>
        </div>
        <div>
          <span>Corretor responsável</span>
          <strong>{dados.corretor || "Não informado"}</strong>
        </div>
        <div>
          <span>Repasse no mês</span>
          <strong>{dados.repasseMes ? "Sim" : "Não"}</strong>
        </div>
      </section>

      <div className="detail-tabs">
        <button
          className={aba === "gerais" ? "active" : ""}
          onClick={() => setAba("gerais")}
        >
          <UserRound size={17} /> Dados gerais
        </button>
        <button
          className={aba === "credito" ? "active" : ""}
          onClick={() => setAba("credito")}
        >
          <CreditCard size={17} /> Crédito e renda
        </button>
        <button
          className={aba === "financeiro" ? "active" : ""}
          onClick={() => setAba("financeiro")}
        >
          <CircleDollarSign size={17} /> Financeiro
        </button>
        <button
          className={aba === "contratos" ? "active" : ""}
          onClick={() => setAba("contratos")}
        >
          <ClipboardList size={17} /> Contratos
        </button>
        <button
          className={aba === "documentos" ? "active" : ""}
          onClick={() => setAba("documentos")}
        >
          <FileText size={17} /> Documentos e datas
        </button>
        <button
          className={aba === "mensagens" ? "active" : ""}
          onClick={() => setAba("mensagens")}
        >
          <MessageCircle size={17} /> Mensagens
        </button>
        <button
          className={aba === "historico" ? "active" : ""}
          onClick={() => setAba("historico")}
        >
          <TrendingUp size={17} /> Histórico
        </button>
      </div>

      <form className="detail-form" onSubmit={salvar}>
        {aba === "gerais" && (
          <>
            <DetailSection
              titulo="Dados da reserva"
              subtitulo="Informações comerciais e identificação da unidade"
            >
              <Campo
                label="Empreendimento"
                nome="empreendimento"
                dados={dados}
                campo={campo}
                largo
              />
              <Campo
                label="Unidade"
                nome="unidade"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Previsão de entrega"
                nome="previsaoEntrega"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Nome do cliente"
                nome="cliente"
                dados={dados}
                campo={campo}
                largo
              />
              <Campo
                label="Telefone"
                nome="telefone"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Imobiliária"
                nome="imobiliaria"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Corretor"
                nome="corretor"
                dados={dados}
                campo={campo}
                largo
              />
            </DetailSection>
            <DetailSection
              titulo="Informações comerciais"
              subtitulo="Dados de venda, contrato e classificação"
            >
              <Campo
                label="Número da venda"
                nome="numeroVenda"
                dados={dados}
                campo={campo}
              />
              <Campo label="Título" nome="titulo" dados={dados} campo={campo} />
              <Campo
                label="Contrato assinado"
                nome="contratoAssinado"
                dados={dados}
                campo={campo}
                opcoes={["Não", "Sim"]}
              />
              <Campo
                label="Mês de competência"
                nome="mesCompetencia"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Classificação pós-venda"
                nome="classificacaoPosVenda"
                dados={dados}
                campo={campo}
                opcoes={["", "Em acompanhamento", "Finalizado", "Pendente"]}
              />
              <Campo
                label="Classificação do cliente"
                nome="classificacaoCliente"
                dados={dados}
                campo={campo}
                opcoes={["", "Regular", "Preferencial", "Com pendência"]}
              />
              <Campo
                label="Tipo de reserva"
                nome="tipoReserva"
                dados={dados}
                campo={campo}
                opcoes={["Venda direta", "Permuta", "Cessão"]}
              />
              <Campo
                label="Condicionante para liberação"
                nome="condicionante"
                dados={dados}
                campo={campo}
              />
            </DetailSection>
          </>
        )}

        {aba === "credito" && (
          <>
            <DetailSection
              titulo="Análise de crédito"
              subtitulo="Renda, FGTS e situação da análise bancária"
            >
              <Campo
                label="Possui 3 anos de FGTS?"
                nome="tresAnosFgts"
                dados={dados}
                campo={campo}
                opcoes={["Não", "Sim"]}
              />
              <Campo
                label="Creditú"
                nome="creditu"
                dados={dados}
                campo={campo}
                opcoes={[true, false]}
                formatar={(v) => (v ? "Sim" : "Não")}
              />
              <Campo
                label="Situação Creditú"
                nome="situacaoCreditu"
                dados={dados}
                campo={campo}
                opcoes={[
                  "Aguardando análise",
                  "Aprovado",
                  "Pendente",
                  "Reprovado",
                ]}
              />
              <Campo
                label="Tipo de renda"
                nome="tipoRenda"
                dados={dados}
                campo={campo}
                opcoes={["Formal", "Informal", "Mista"]}
              />
              <Campo
                label="Renda bruta formal"
                nome="rendaFormal"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Renda informal"
                nome="rendaInformal"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Quantidade de filhos"
                nome="quantidadeFilhos"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Categoria de renda do fiador"
                nome="categoriaFiador"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Cidade onde mais residiu"
                nome="cidadeOrigem"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Bairro onde mais residiu"
                nome="bairroOrigem"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Bônus AP"
                nome="bonusAp"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Comissão AP"
                nome="comissaoAp"
                dados={dados}
                campo={campo}
              />
            </DetailSection>
          </>
        )}

        {aba === "financeiro" && (
          <>
            <DetailSection
              titulo="Condição de pagamento"
              subtitulo="Tabela ativa e composição financeira da venda"
            >
              <Campo
                label="Tabela de preço"
                nome="tabelaPreco"
                dados={dados}
                campo={campo}
                opcoes={[
                  "Tabela padrão",
                  "Tabela promocional",
                  "Tabela FSA014",
                ]}
              />
              <Campo
                label="Série"
                nome="seriePagamento"
                dados={dados}
                campo={campo}
                opcoes={[
                  "Entrada / Sinal",
                  "Financiamento",
                  "Cheque moradia",
                  "Financiamento Creditú",
                ]}
              />
              <Campo
                label="Forma de pagamento"
                nome="formaPagamento"
                dados={dados}
                campo={campo}
                opcoes={["Boleto", "Transferência bancária", "Financiamento"]}
              />
              <Campo
                label="Parcelas"
                nome="parcelas"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Valor da parcela"
                nome="valorParcela"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Primeiro vencimento"
                nome="primeiroVencimento"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Indexador"
                nome="indexador"
                dados={dados}
                campo={campo}
                opcoes={["REAL", "INCC", "IPCA"]}
              />
              <Campo
                label="Juros da condição"
                nome="juros"
                dados={dados}
                campo={campo}
              />
            </DetailSection>
            <section className="detail-section payment-section">
              <div className="section-heading">
                <div>
                  <h2>Parcelas da proposta</h2>
                  <p>Composição do valor presente e nominal</p>
                </div>
                <button type="button" className="add-condition">
                  <Plus size={14} /> Adicionar condição
                </button>
              </div>
              <div className="finance-table-wrap">
                <table className="finance-table">
                  <thead>
                    <tr>
                      <th>Série</th>
                      <th>Tipo</th>
                      <th>Parcelas</th>
                      <th>Valor</th>
                      <th>Subtotal</th>
                      <th>Vencimento</th>
                      <th>Indexador</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      [
                        "Entrada / Sinal",
                        "Boleto",
                        "1",
                        "R$ 5.400,00",
                        "R$ 5.400,00",
                        "07/07/2026",
                      ],
                      [
                        "Financiamento",
                        "Transferência",
                        "1",
                        "R$ 180.000,00",
                        "R$ 180.000,00",
                        "15/09/2026",
                      ],
                      [
                        "Cheque moradia",
                        "Transferência",
                        "1",
                        "R$ 47.400,00",
                        "R$ 47.400,00",
                        "15/09/2026",
                      ],
                      [
                        "Financiamento Creditú",
                        "Transferência",
                        "1",
                        "R$ 20.200,00",
                        "R$ 20.200,00",
                        "15/09/2026",
                      ],
                    ].map((linha, index) => (
                      <tr key={linha[0]}>
                        {linha.map((celula) => (
                          <td key={celula}>{celula}</td>
                        ))}
                        <td>
                          <span className="index-badge">REAL</span>
                        </td>
                        <td>
                          <button type="button" className="delete-button">
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan="4">Total da proposta</td>
                      <td>R$ 248.000,00</td>
                      <td colSpan="3">Valor presente: R$ 248.406,02</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
            <div className="financial-overview">
              <article>
                <span>Valor do contrato</span>
                <strong>R$ {dados.valorContratoReserva}</strong>
                <small>Valor nominal bruto</small>
              </article>
              <article>
                <span>Valor presente</span>
                <strong>R$ {dados.valorPresente}</strong>
                <small>Juros futuros incluídos</small>
              </article>
              <article>
                <span>Valor aprovado</span>
                <strong>R$ 180.000,00</strong>
                <small>Financiamento</small>
              </article>
              <article>
                <span>Subsídio + FGTS</span>
                <strong>R$ 0,00</strong>
                <small>Pré-cadastro</small>
              </article>
            </div>
            <DetailSection
              titulo="Comissão e geração de repasse"
              subtitulo="Dados da operação financeira e correspondente"
            >
              <Campo
                label="Tipo de venda"
                nome="tipoVendaFinanceiro"
                dados={dados}
                campo={campo}
                opcoes={["", "Venda direta", "Financiamento", "Permuta"]}
              />
              <Campo
                label="Empresa correspondente"
                nome="empresaCorrespondente"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Correspondente"
                nome="correspondenteFinanceiro"
                dados={dados}
                campo={campo}
              />
              <div className="inline-action field-wide">
                <div>
                  <span>Repasse financeiro</span>
                  <small>
                    Gere o repasse após validar a condição de pagamento.
                  </small>
                </div>
                <button type="button" className="primary-button">
                  Gerar repasse
                </button>
              </div>
            </DetailSection>
          </>
        )}

        {aba === "contratos" && (
          <>
            <DetailSection
              titulo="Gerar e enviar contrato"
              subtitulo="Prepare os documentos para assinatura eletrônica"
            >
              <Campo
                label="Modelo de contrato"
                nome="modeloContrato"
                dados={dados}
                campo={campo}
                opcoes={[
                  "",
                  "Contrato de venda",
                  "Instrumento particular",
                  "Confissão de dívida",
                  "Memorial",
                ]}
              />
              <div className="inline-action field-wide">
                <div>
                  <span>Gerar novo documento</span>
                  <small>
                    O contrato será preenchido com os dados desta reserva.
                  </small>
                </div>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => {
                    if (!dados.modeloContrato) return;
                    setContratos((atuais) => [
                      [
                        String(49000 + atuais.length),
                        "Venda",
                        dados.modeloContrato,
                      ],
                      ...atuais,
                    ]);
                  }}
                >
                  <Plus size={15} /> Gerar
                </button>
              </div>
              <div className="upload-zone field-wide">
                <FileText size={24} />
                <strong>Adicione ou solte o arquivo aqui</strong>
                <span>Arquivos suportados: PDF, DOC e DOCX</span>
                <label className="secondary-button file-picker">
                  Selecionar arquivo
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx"
                    multiple
                    onChange={(e) => {
                      const novos = [...e.target.files].map((f, index) => [
                        String(49500 + contratos.length + index),
                        "Anexo",
                        f.name,
                      ]);
                      setContratos((atuais) => [...novos, ...atuais]);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </DetailSection>
            <section className="detail-section contracts-section">
              <div className="section-heading">
                <div>
                  <h2>Contratos da reserva</h2>
                  <p>{contratos.length} documentos vinculados</p>
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    alert("Contratos selecionados enviados para assinatura.")
                  }
                >
                  Enviar selecionados para assinatura
                </button>
              </div>
              <div className="finance-table-wrap">
                <table className="finance-table contracts-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Número</th>
                      <th>Tipo</th>
                      <th>Nome</th>
                      <th>Assinatura</th>
                      <th>Validação</th>
                      <th>Opções</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contratos.map((doc) => (
                      <tr key={doc[0]}>
                        <td>
                          <input type="checkbox" defaultChecked />
                        </td>
                        <td>{doc[0]}</td>
                        <td>{doc[1]}</td>
                        <td>
                          <strong>{doc[2]}</strong>
                          <small>Gerado agora</small>
                        </td>
                        <td>
                          <span className="contract-status">
                            Aguardando assinatura
                          </span>
                        </td>
                        <td>
                          <span className="contract-status">
                            Aguardando validação
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="delete-button"
                            title="Excluir"
                            onClick={() =>
                              setContratos((atuais) =>
                                atuais.filter((item) => item[0] !== doc[0]),
                              )
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {aba === "mensagens" && (
          <section className="detail-section messages-section">
            <div className="section-heading">
              <div>
                <h2>Mensagens da reserva</h2>
                <p>
                  Comunicação entre gestão, corretor, imobiliária e
                  correspondente
                </p>
              </div>
              <span>{mensagens.length} mensagens</span>
            </div>
            <div className="message-composer">
              <div className="composer-avatar">DM</div>
              <textarea
                value={novaMensagem}
                onChange={(e) => setNovaMensagem(e.target.value)}
                placeholder="Escreva uma atualização sobre esta reserva..."
              />
              <div className="composer-actions">
                <span>A mensagem ficará registrada no histórico.</span>
                <button
                  type="button"
                  className="primary-button"
                  onClick={cadastrarMensagem}
                >
                  <MessageCircle size={15} /> Cadastrar mensagem
                </button>
              </div>
            </div>
            <div className="message-timeline">
              {mensagens.map((msg, index) => (
                <article className="message-item" key={`${msg.autor}-${index}`}>
                  <div className="timeline-avatar">
                    {msg.autor
                      .split(" ")
                      .slice(0, 2)
                      .map((n) => n[0])
                      .join("")}
                  </div>
                  <div className="message-content">
                    <div className="message-meta">
                      <div>
                        <strong>{msg.autor}</strong>
                        <span>{msg.papel}</span>
                      </div>
                      <time>{msg.data}</time>
                    </div>
                    <p>{msg.texto}</p>
                    <div className="message-audience">
                      <span>Imobiliária</span>
                      <span>Corretor</span>
                      <span>Correspondente</span>
                      <span>Repasse</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {aba === "historico" && (
          <section className="detail-section history-section">
            <div className="section-heading">
              <div>
                <h2>Histórico da reserva</h2>
                <p>Auditoria completa das alterações e movimentações</p>
              </div>
              <button type="button" className="secondary-button">
                <Filter size={14} /> Filtrar eventos
              </button>
            </div>
            <div className="history-layout">
              <div className="history-timeline">
                {[
                  [
                    "03/07/2026 às 19h06",
                    "Enviou os contratos para assinatura eletrônica",
                    "Vivian dos Santos Pereira",
                  ],
                  [
                    "03/07/2026 às 19h05",
                    "Gerou o contrato: QR da unidade · Padrão cônjuge",
                    "Vivian dos Santos Pereira",
                  ],
                  [
                    "03/07/2026 às 19h05",
                    "Gerou o contrato: Instrumento Particular · Creditú",
                    "Vivian dos Santos Pereira",
                  ],
                  [
                    "03/07/2026 às 19h05",
                    "Gerou o contrato: Memorial do empreendimento",
                    "Vivian dos Santos Pereira",
                  ],
                  [
                    "03/07/2026 às 19h04",
                    "Gerou o contrato: Confissão de Dívidas",
                    "Vivian dos Santos Pereira",
                  ],
                  [
                    "03/07/2026 às 19h04",
                    "Gerou o contrato: Planta da unidade",
                    "Vivian dos Santos Pereira",
                  ],
                  [
                    "03/07/2026 às 19h03",
                    "Atualizou os valores de divisão de negócio",
                    "Vivian dos Santos Pereira",
                  ],
                ].map((evento, index) => (
                  <article className="history-event" key={index}>
                    <div className="history-marker">
                      <ChevronRight size={15} />
                    </div>
                    <div>
                      <time>{evento[0]}</time>
                      <span className="history-user">Gestor · {evento[2]}</span>
                      <p>{evento[1]}</p>
                    </div>
                    <span className="event-id">#{754172 - index}</span>
                  </article>
                ))}
              </div>
              <aside className="history-filters">
                <h3>Filtros rápidos</h3>
                <strong>Painel</strong>
                <button type="button">
                  <i /> Gestor
                </button>
                <strong>Usuários</strong>
                <button type="button">
                  <i /> Vivian
                </button>
                <strong>Ações</strong>
                {[
                  "Enviou",
                  "Gerou",
                  "Cadastrou",
                  "Modificou",
                  "Removeu",
                  "Reserva",
                ].map((x) => (
                  <button type="button" key={x}>
                    <i /> {x}
                  </button>
                ))}
              </aside>
            </div>
          </section>
        )}

        {aba === "documentos" && (
          <>
            <section className="detail-section document-manager">
              <div className="document-progress">
                <div>
                  <h2>Documentos obrigatórios</h2>
                  <p>
                    Visualize todos os documentos obrigatórios para esta reserva
                  </p>
                </div>
                <div className="document-progress-actions">
                  <strong>
                    {progressoDocumentos.toLocaleString("pt-BR", {
                      maximumFractionDigits: 2,
                    })}
                    % cadastrados
                  </strong>
                  <button
                    type="button"
                    onClick={() =>
                      setListaDocumentosAberta((aberta) => !aberta)
                    }
                  >
                    {listaDocumentosAberta
                      ? "Ocultar lista"
                      : "Ver lista completa"}
                    <ChevronDown size={15} />
                  </button>
                </div>
                <div className="document-progress-track">
                  <span style={{ width: `${progressoDocumentos}%` }} />
                </div>
              </div>
              {listaDocumentosAberta && (
                <div className="required-documents-catalog">
                  {gruposDocumentos.map((grupo, grupoIndex) => (
                    <section key={grupo.nome}>
                      <div className="required-group-title">
                        <span>{String(grupoIndex + 1).padStart(2, "0")}</span>
                        <h3>{grupo.nome}</h3>
                      </div>
                      <ol>
                        {grupo.documentos.map((documento) => (
                          <li key={documento}>
                            <Check size={13} />
                            <span>{documento}</span>
                          </li>
                        ))}
                      </ol>
                      {grupo.regras && (
                        <div className="required-rules">
                          {grupo.regras.map((regra) => (
                            <p key={regra}>
                              <HelpCircle size={13} />
                              {regra}
                            </p>
                          ))}
                        </div>
                      )}
                    </section>
                  ))}
                </div>
              )}
              <div className="document-upload-area">
                <div
                  className={`upload-zone ${arrastandoDocumento ? "dragging" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setArrastandoDocumento(true);
                  }}
                  onDragLeave={() => setArrastandoDocumento(false)}
                  onDrop={async (e) => {
                    e.preventDefault();
                    setArrastandoDocumento(false);
                    try {
                      await adicionarDocumentos([...e.dataTransfer.files]);
                    } catch (error) {
                      alert(error.message);
                    }
                  }}
                >
                  <UploadCloud size={25} />
                  <strong>Adicione ou solte os arquivos aqui</strong>
                  <span>
                    JPG, JPEG, GIF, PNG, BMP, PDF, XLS, XLSX, RAR, ZIP, DOC e
                    DOCX · até 24 MB
                  </span>
                  <label className="secondary-button file-picker">
                    Selecionar arquivos
                    <input
                      type="file"
                      multiple
                      accept=".jpg,.jpeg,.gif,.png,.bmp,.pdf,.xls,.xlsx,.rar,.zip,.doc,.docx"
                      onChange={async (e) => {
                        try {
                          await adicionarDocumentos([...e.target.files]);
                        } catch (error) {
                          alert(error.message);
                        } finally {
                          e.target.value = "";
                        }
                      }}
                    />
                  </label>
                </div>
                <div className="document-upload-fields">
                  <label className="document-type-field group-filter-field">
                    <span>Grupo de documentos</span>
                    <select
                      value={dados.grupoDocumento}
                      onChange={(e) => {
                        const grupo = gruposDocumentos.find(
                          (item) => item.nome === e.target.value,
                        );
                        campo("grupoDocumento", e.target.value);
                        campo("tipoDocumento", grupo.documentos[0]);
                      }}
                    >
                      {gruposDocumentos.map((grupo) => (
                        <option key={grupo.nome} value={grupo.nome}>
                          {grupo.nome}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="document-type-field">
                    <span>Tipo do documento</span>
                    <select
                      value={dados.tipoDocumento}
                      onChange={(e) => campo("tipoDocumento", e.target.value)}
                    >
                      {gruposDocumentos
                        .find((grupo) => grupo.nome === dados.grupoDocumento)
                        ?.documentos.map((documento) => (
                          <option key={documento} value={documento}>
                            {documento}
                          </option>
                        ))}
                    </select>
                  </label>
                  <Campo
                    label="Pessoa"
                    nome="pessoaDocumento"
                    dados={dados}
                    campo={campo}
                    opcoes={[
                      "Titular",
                      "Cônjuge",
                      "Dependente menor",
                      "Dependente maior",
                      "Segundo proponente",
                      "Beneficiário",
                      "Declarante",
                    ]}
                  />
                </div>
              </div>
              <div className="document-list-head">
                <div>
                  <h3>Documentos da reserva</h3>
                  <span>{documentos.length} arquivos cadastrados</span>
                </div>
                <div className="document-batch-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!documentosSelecionados.size}
                    onClick={() =>
                      documentos.forEach(
                        (doc, index) =>
                          documentosSelecionados.has(
                            chaveDocumento(doc, index),
                          ) && abrirDocumento(doc, true),
                      )
                    }
                  >
                    Baixar selecionados ({documentosSelecionados.size})
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() =>
                      documentos.forEach((doc) => abrirDocumento(doc, true))
                    }
                  >
                    Baixar todos
                  </button>
                </div>
              </div>
              <div className="finance-table-wrap grouped-documents">
                <table className="finance-table documents-table">
                  <thead>
                    <tr>
                      <th>
                        <input
                          type="checkbox"
                          aria-label="Selecionar todos"
                          checked={
                            documentos.length > 0 &&
                            documentosSelecionados.size === documentos.length
                          }
                          onChange={(e) =>
                            setDocumentosSelecionados(
                              e.target.checked
                                ? new Set(documentos.map(chaveDocumento))
                                : new Set(),
                            )
                          }
                        />
                      </th>
                      <th>Documento</th>
                      <th>Tipo</th>
                      <th>Pessoa</th>
                      <th>Cadastro</th>
                      <th>Responsável</th>
                      <th>Situação</th>
                      <th>Validade</th>
                      <th>Opções</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documentosOrdenados.map(
                      ({ doc, index, grupo, totalGrupo }, posicao) => {
                        const chave = chaveDocumento(doc, index);
                        const status = doc[2]?.status || "pending";
                        const novoGrupo =
                          posicao === 0 ||
                          documentosOrdenados[posicao - 1].grupo !== grupo;
                        return (
                          <React.Fragment key={`${chave}-${grupo}`}>
                            {novoGrupo && (
                              <tr className="document-group-row">
                                <td colSpan="9">
                                  <div>
                                    <span>
                                      {String(
                                        documentosAgrupados.findIndex(
                                          (item) => item.nome === grupo,
                                        ) + 1,
                                      ).padStart(2, "0")}
                                    </span>
                                    <strong>{grupo}</strong>
                                    <small>
                                      {totalGrupo} arquivo
                                      {totalGrupo === 1 ? "" : "s"}
                                    </small>
                                  </div>
                                </td>
                              </tr>
                            )}
                            <tr>
                              <td>
                                <input
                                  type="checkbox"
                                  aria-label={`Selecionar ${doc[0]}`}
                                  checked={documentosSelecionados.has(chave)}
                                  onChange={(e) =>
                                    setDocumentosSelecionados((atuais) => {
                                      const novos = new Set(atuais);
                                      e.target.checked
                                        ? novos.add(chave)
                                        : novos.delete(chave);
                                      return novos;
                                    })
                                  }
                                />
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="document-name"
                                  onClick={() => abrirDocumento(doc)}
                                >
                                  {doc[0]}
                                </button>
                              </td>
                              <td>{doc[1]}</td>
                              <td>
                                {doc[2]?.person_type ||
                                  dados.pessoaDocumento ||
                                  "Titular"}
                              </td>
                              <td>
                                {doc[2]?.created_at
                                  ? new Date(doc[2].created_at).toLocaleString(
                                      "pt-BR",
                                    )
                                  : "Agora"}
                              </td>
                              <td>Equipe</td>
                              <td>
                                <span className={`document-status ${status}`}>
                                  {status === "approved"
                                    ? "Aprovado"
                                    : status === "rejected"
                                      ? "Reprovado"
                                      : "Aguardando aprovação"}
                                </span>
                              </td>
                              <td>—</td>
                              <td className="document-actions-cell">
                                <button
                                  type="button"
                                  className="document-actions-trigger"
                                  aria-label={`Ações de ${doc[0]}`}
                                  onClick={() =>
                                    setMenuDocumento(
                                      menuDocumento === chave ? null : chave,
                                    )
                                  }
                                >
                                  Ações <MoreHorizontal size={14} />
                                </button>
                                {menuDocumento === chave && (
                                  <div className="document-actions-menu">
                                    <button
                                      type="button"
                                      onClick={() => abrirDocumento(doc)}
                                    >
                                      <Eye size={15} />
                                      Visualizar documento
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        revisarDocumento(
                                          doc,
                                          index,
                                          status === "approved"
                                            ? "rejected"
                                            : "approved",
                                        )
                                      }
                                    >
                                      <CheckCircle2 size={15} />
                                      {status === "approved"
                                        ? "Reprovar"
                                        : "Aprovar"}{" "}
                                      documento
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => abrirDocumento(doc, true)}
                                    >
                                      <Download size={15} />
                                      Baixar documento
                                    </button>
                                    <button
                                      type="button"
                                      className="danger"
                                      onClick={() =>
                                        excluirDocumento(doc, index)
                                      }
                                    >
                                      <Trash2 size={15} />
                                      Excluir documento
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          </React.Fragment>
                        );
                      },
                    )}
                  </tbody>
                </table>
              </div>
            </section>
            <DetailSection
              titulo="Datas e documentos"
              subtitulo="Marcos do processo e integrações operacionais"
            >
              <Campo
                label="Data da posse"
                nome="dataPosse"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Data do contrato"
                nome="dataContrato"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Data da venda"
                nome="dataVenda"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Data da carta proposta"
                nome="dataCarta"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Data envio CEHOP"
                nome="dataEnvioCehop"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Conformidade CEHOP"
                nome="dataConformidadeCehop"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Data da inconformidade"
                nome="dataInconformidadeCehop"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Data de reenvio para CEHOP"
                nome="dataReenvioCehop"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Envio confissão de dívida"
                nome="dataConfissao"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Assinatura da confissão"
                nome="dataAssinaturaConfissao"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Validação do espelho"
                nome="dataValidacaoEspelho"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Espelho anexado"
                nome="dataEspelhoAnexado"
                dados={dados}
                campo={campo}
                tipo="date"
              />
              <Campo
                label="Contrato no portal do cliente"
                nome="contratoPortal"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Exceção assinatura contrato Caixa"
                nome="excecaoCaixa"
                dados={dados}
                campo={campo}
              />
              <Campo
                label="Observação de finalização"
                nome="observacaoFinalizacao"
                dados={dados}
                campo={campo}
                largo
              />
              <Campo
                label="Observações gerais"
                nome="observacoes"
                dados={dados}
                campo={campo}
                largo
              />
            </DetailSection>
          </>
        )}
        <div className="detail-actions">
          <span className={salvo ? "saved-message show" : "saved-message"}>
            <Check size={15} /> Alterações salvas
          </span>
          <button type="button" className="secondary-button" onClick={voltar}>
            Cancelar
          </button>
          <button className="primary-button">
            <Save size={16} /> Salvar alterações
          </button>
        </div>
      </form>
    </div>
  );
}

function DetailSection({ titulo, subtitulo, children }) {
  return (
    <section className="detail-section">
      <div className="section-heading">
        <div>
          <h2>{titulo}</h2>
          <p>{subtitulo}</p>
        </div>
        <span>
          <Check size={14} /> Atualizado
        </span>
      </div>
      <div className="detail-fields">{children}</div>
    </section>
  );
}

function Campo({
  label,
  nome,
  dados,
  campo,
  opcoes,
  tipo = "text",
  largo,
  formatar,
}) {
  const valor = dados[nome] ?? "";
  return (
    <label className={largo ? "field-wide" : ""}>
      <span>{label}</span>
      {opcoes ? (
        <div className="field-select">
          <select
            value={String(valor)}
            onChange={(e) => {
              const original = opcoes.find((o) => String(o) === e.target.value);
              campo(nome, original ?? e.target.value);
            }}
          >
            {opcoes.map((o) => (
              <option value={String(o)} key={String(o)}>
                {formatar ? formatar(o) : o || "Selecione"}
              </option>
            ))}
          </select>
          <ChevronDown size={15} />
        </div>
      ) : (
        <input
          type={tipo}
          value={valor}
          onChange={(e) => campo(nome, e.target.value)}
          placeholder="Não informado"
        />
      )}
    </label>
  );
}

function ClienteRow({ cliente: c, etapas, atualizar, excluir, abrir }) {
  const percentual = etapas.length
    ? Math.round(((c.etapaAtual + 1) / etapas.length) * 100)
    : 0;
  const iniciais =
    c.cliente
      ?.split(" ")
      .slice(0, 2)
      .map((n) => n[0])
      .join("")
      .toUpperCase() || "--";
  const prioridade = {
    verde: ["No prazo", "low"],
    amarela: ["Atenção", "medium"],
    vermelha: ["Atrasado", "high"],
  }[c.prioridade] || ["Normal", "low"];
  return (
    <tr>
      <td>
        <button className="client-cell client-link" onClick={() => abrir(c)}>
          <div className="client-avatar">{iniciais}</div>
          <div>
            <strong>{c.cliente}</strong>
            <span>Reserva #{c.reserva}</span>
          </div>
        </button>
      </td>
      <td>
        <div className="origin-cell">
          <strong>{c.imobiliaria}</strong>
          <span>{c.corretor || "Sem corretor"}</span>
        </div>
      </td>
      <td>
        <div className="inline-select">
          <select
            value={c.etapaAtual}
            onChange={(e) =>
              atualizar(c.id, { etapaAtual: Number(e.target.value) })
            }
          >
            {etapas.map((x, i) => (
              <option value={i} key={x}>
                {x}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
      </td>
      <td>
        <div className="progress-cell">
          <div className="progress-track">
            <span style={{ width: `${percentual}%` }} />
          </div>
          <b>{percentual}%</b>
        </div>
      </td>
      <td>
        <span className={`priority ${prioridade[1]}`}>
          <i />
          {prioridade[0]}
        </span>
      </td>
      <td>
        <input
          className="table-input status-input"
          value={c.status}
          onChange={(e) => atualizar(c.id, { status: e.target.value })}
        />
      </td>
      <td>
        <input
          className="table-input notes-input"
          value={c.observacoes || ""}
          placeholder="Adicionar nota"
          onChange={(e) => atualizar(c.id, { observacoes: e.target.value })}
        />
      </td>
      <td>
        <button
          className="delete-button"
          onClick={() => excluir(c.id)}
          title="Excluir cliente"
        >
          <Trash2 size={17} />
        </button>
      </td>
    </tr>
  );
}

createRoot(document.getElementById("root")).render(<AuthGate />);
