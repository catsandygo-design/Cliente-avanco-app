
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

const STATUS_PADRAO = {
  reserva: ["Em processo", "Pendente", "Em análise", "Aprovada", "Cancelada"],
  repasse: ["Início do repasse", "Em andamento", "Assinatura Caixa", "Validação", "Garantia AGEHAB", "Em processo de distrato"],
};

function carregarStatus(tipo) {
  try {
    const salvos = JSON.parse(localStorage.getItem(`avanco-status-${tipo}`) || "null");
    if (Array.isArray(salvos) && salvos.length) return salvos;
  } catch {}
  return STATUS_PADRAO[tipo];
}

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
  const sessionUserId = useRef(null);
  useEffect(() => {
    if (!supabaseClient) return;
    supabaseClient.auth
      .getSession()
      .then(({ data }) => {
        sessionUserId.current = data.session?.user?.id || null;
        setSession(data.session);
      });
    const { data } = supabaseClient.auth.onAuthStateChange((_, nextSession) => {
      const nextUserId = nextSession?.user?.id || null;
      if (nextUserId !== sessionUserId.current)
        setMfaMode(nextSession ? 'loading' : 'app');
      sessionUserId.current = nextUserId;
      setSession(nextSession);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!supabaseClient || !session) { if (!session) setMfaMode('app'); return; }
    let active = true;
    (async()=>{try{const factors=await supabaseClient.auth.mfa.listFactors();if(factors.error)throw factors.error;const verified=factors.data.totp.filter(f=>f.status==='verified');if(!active)return;if(!verified.length){setMfaMode('enroll');return}const aal=await supabaseClient.auth.mfa.getAuthenticatorAssuranceLevel();if(aal.error)throw aal.error;setMfaMode(aal.data.currentLevel==='aal2'?'app':{type:'challenge',factorId:verified[0].id})}catch{if(active)setMfaMode('enroll')}})();
    return()=>{active=false};
  }, [session?.user?.id]);
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
  const [capsLockAtivo, setCapsLockAtivo] = useState(false);
  const verificarCapsLock = (event) =>
    setCapsLockAtivo(event.getModifierState("CapsLock"));
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
              onKeyDown={verificarCapsLock}
              onKeyUp={verificarCapsLock}
              onBlur={() => setCapsLockAtivo(false)}
              aria-describedby={capsLockAtivo ? "capslock-warning" : undefined}
              placeholder="Mínimo de 8 caracteres"
            />
            {capsLockAtivo && (
              <small id="capslock-warning" className="capslock-warning" role="status">
                Caps Lock está ativado.
              </small>
            )}
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
  const [erroCarregamento, setErroCarregamento] = useState("");
  const [clienteSelecionado, setClienteSelecionado] = useState(null);
  const [repasseSelecionado, setRepasseSelecionado] = useState(null);
  const [tela, setTela] = useState("clientes");
  const [sidebarRecolhida, setSidebarRecolhida] = useState(false);
  const [suporteAberto, setSuporteAberto] = useState(false);
  const [termoSuporte, setTermoSuporte] = useState("");
  const [buscaSuporte, setBuscaSuporte] = useState("");
  const [nomeSuporte, setNomeSuporte] = useState("Usuário");

  const topicosSuporte = [
    "Como cadastrar e acompanhar clientes",
  …39976 tokens truncated…            <ol>
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
              {camposDatasOrdenados.map((item) => (
                <Campo
                  key={item.nome}
                  label={item.label}
                  nome={item.nome}
                  dados={dados}
                  campo={campo}
                  tipo={item.personalizado
                    ? ({ Data: "date", Número: "number" }[item.tipo] || "text")
                    : item.tipo}
                  opcoes={item.personalizado && item.tipo === "Sim/Não" ? ["", "Sim", "Não"] : undefined}
                  largo={item.largo}
                />
              ))}
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

function ClienteRow({ cliente: c, etapas, atualizar, excluir, abrir, statusOpcoes }) {
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
        <select className="table-input status-input" value={c.status || "Em processo"} onChange={(e) => atualizar(c.id, { status: e.target.value })}>
          {statusOpcoes.map((status) => <option key={status}>{status}</option>)}
        </select>
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

