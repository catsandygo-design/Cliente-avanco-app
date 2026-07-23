
import express from 'express';
import cors from 'cors';
import { v4 as uuid } from 'uuid';
import { createClient } from '@supabase/supabase-js';
import multer from 'multer';
import * as XLSX from 'xlsx';

const app = express();
app.disable('x-powered-by');
const origensPermitidas = new Set([
  'https://cliente-avanco-app.vercel.app',
  'http://localhost:5173',
  'http://localhost:5174',
  process.env.APP_ORIGIN,
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
].filter(Boolean));
app.use(cors({
  origin(origin, callback) {
    if (!origin || origensPermitidas.has(origin)) return callback(null, true);
    return callback(new Error('Origem não permitida'));
  },
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  maxAge: 86400,
}));
app.use(express.json({ limit: '1mb' }));
const limitesPorIp = new Map();
app.use('/api', (req, res, next) => {
  const agora = Date.now();
  const janela = 60 * 1000;
  const limite = 120;
  const ip = String(req.headers['x-forwarded-for'] || req.ip || 'desconhecido').split(',')[0].trim();
  let registro = limitesPorIp.get(ip);
  if (!registro || registro.expiraEm <= agora) registro = { total: 0, expiraEm: agora + janela };
  registro.total += 1;
  limitesPorIp.set(ip, registro);
  res.set('RateLimit-Limit', String(limite));
  res.set('RateLimit-Remaining', String(Math.max(0, limite - registro.total)));
  res.set('RateLimit-Reset', String(Math.ceil(registro.expiraEm / 1000)));
  if (registro.total > limite)
    return res.status(429).json({ erro: 'Muitas solicitações. Aguarde um minuto e tente novamente.' });
  if (limitesPorIp.size > 10000)
    for (const [chave, valor] of limitesPorIp) if (valor.expiraEm <= agora) limitesPorIp.delete(chave);
  next();
});
const responderErroInterno = (res, error, contexto) => {
  console.error(`[${contexto}]`, error);
  return res.status(500).json({
    erro: 'Não foi possível concluir a operação. Tente novamente ou contate o suporte.',
  });
};
const uploadPlanilha = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 }, fileFilter: (_, file, cb) => cb(null, /\.(xls|xlsx)$/i.test(file.originalname)) });

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
let organizationId;

const etapas = [
  'Em processo',
  'Secretaria de Vendas',
  'Envio Sienge',
  'Crédito',
  'Creditú',
  'Assinatura 7LM',
  'Aprovado Diretoria',
  'Venda Finalizada'
];

let clientes = [
  {
    id: uuid(), reserva: '7228', cliente: 'Lorena Martins', corretor: 'Viviane Machado',
    imobiliaria: 'Equipe Própria | CAT', telefone: '+55 64 99999-0000', creditu: true,
    etapaAtual: 4, status: 'Em análise', prioridade: 'amarela', repasseMes: true,
    observacoes: 'Aguardando análise.', atualizadoEm: new Date().toISOString()
  },
  {
    id: uuid(), reserva: '7236', cliente: 'Marcos Vinicius', corretor: 'José Ribamar',
    imobiliaria: 'Canal Virtual 3', telefone: '+55 64 98888-0000', creditu: true,
    etapaAtual: 6, status: 'Pendente', prioridade: 'vermelha', repasseMes: true,
    observacoes: 'Falta fiador.', atualizadoEm: new Date().toISOString()
  }
];

const clientesDemonstracao = [
  ['7440', 'Danielson Andrade', 'Bianca de Sousa', 'Equipe Própria | FSA', 1, 'Em processo', 'verde'],
  ['7430', 'Bibiana da Silva Costa', 'Viviane Machado', 'Equipe Própria | CAT', 2, 'Secretaria de vendas', 'verde'],
  ['7416', 'Cleide dos Santos Costa', 'José Ribamar', 'Canal Virtual 3', 3, 'Envio SIENGE', 'amarela'],
  ['7413', 'Érica de Jesus Ferreira', 'Murielli de Sousa', 'Imobiliárias | CAT', 4, 'Análise de crédito', 'verde'],
  ['7389', 'Sandro Rodrigues Pereira', 'Viviane Machado', 'Equipe Própria | CAT', 6, 'Fase Creditú', 'amarela'],
  ['7382', 'Thaíse Camilo Guedes', 'Bianca de Sousa', 'Equipe Própria | FSA', 7, 'Assinatura 7LM', 'verde'],
  ['7354', 'Enaíe Stefany Ferreira', 'José Ribamar', 'Canal Virtual 3', 7, 'Assinatura 7LM', 'amarela'],
  ['7338', 'Alice Alves da Rocha', 'Viviane Machado', 'Equipe Própria | CAT', 8, 'Aprovado Diretoria', 'verde'],
  ['7204', 'Pedro Marco Brasil', 'Murielli de Sousa', 'Imobiliárias | CAT', 9, 'Venda finalizada', 'verde'],
  ['7173', 'Ana Paula Machado', 'Bianca de Sousa', 'Equipe Própria | FSA', 9, 'Venda finalizada', 'verde']
];

clientes.push(...clientesDemonstracao.map(([reserva, cliente, corretor, imobiliaria, etapaAtual, status, prioridade], index) => ({
  id: uuid(), reserva, cliente, corretor, imobiliaria, telefone: `+55 64 999${String(1000 + index).padStart(4, '0')}`,
  creditu: etapaAtual >= 4, etapaAtual, status, prioridade, repasseMes: etapaAtual >= 6,
  observacoes: etapaAtual === 9 ? 'Processo concluído.' : 'Acompanhamento em andamento.',
  atualizadoEm: new Date().toISOString()
})));

const priorityToDb = value => ({ verde: 'green', amarela: 'yellow', vermelha: 'red', green: 'green', yellow: 'yellow', red: 'red' }[value] || 'green');
const priorityFromDb = value => ({ green: 'verde', yellow: 'amarela', red: 'vermelha' }[value] || 'verde');
const textoPlanilha = value => value == null ? '' : String(value).trim();
const numeroPlanilha = value => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; };
const booleanoPlanilha = value => ['sim','s','true','1'].includes(textoPlanilha(value).toLowerCase());
const dataPlanilha = value => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0,10);
  const text = textoPlanilha(value); const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2,'0')}-${br[1].padStart(2,'0')}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/); return iso ? iso[0] : null;
};
const etapaPlanilha = situacao => {
  const value = textoPlanilha(situacao).toLowerCase();
  if (value.includes('venda finalizada')) return 7; if (value.includes('diretoria')) return 6;
  if (value.includes('assinatura 7lm')) return 5; if (value.includes('creditú') || value.includes('creditu')) return 4;
  if (value === 'crédito' || value === 'credito') return 3; if (value.includes('sienge')) return 2;
  if (value.includes('secretaria')) return 1; return 0;
};
const limparLinhaPlanilha = row => Object.fromEntries(Object.entries(row).map(([key,value]) => [key, value instanceof Date ? value.toISOString().slice(0,10) : (value ?? null)]));

async function getOrganizationId() {
  if (organizationId) return organizationId;
  const { data, error } = await supabase.from('organizations').select('id').eq('slug', '7lm').single();
  if (error) throw error;
  organizationId = data.id;
  return organizationId;
}

function mapReservation(row) {
  const client = row.clients || {};
  return {
    id: row.id, reserva: row.code, cliente: client.full_name || '', telefone: client.phone || '',
    corretor: row.broker_name || '', imobiliaria: row.real_estate_agency || '', creditu: row.credit_provider,
    etapaAtual: row.current_stage, status: row.status, prioridade: priorityFromDb(row.priority),
    repasseMes: row.monthly_transfer, observacoes: row.notes || '', atualizadoEm: row.updated_at,
    ...(row.operational_data || {}), ...(row.financial_data || {})
  };
}

async function listReservations() {
  const orgId = await getOrganizationId();
  const { data, error } = await supabase.from('reservations').select('*, clients(*)').eq('organization_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(mapReservation);
}

async function ensureSeedData() {
  // Dados demonstrativos nunca devem ser recriados automaticamente em produção.
  // A ativação precisa ser explícita para evitar corrida entre funções serverless.
  if (process.env.ALLOW_SEED_DATA !== 'true') return;
  const orgId = await getOrganizationId();
  const { count, error } = await supabase.from('reservations').select('id', { count: 'exact', head: true }).eq('organization_id', orgId);
  if (error || count) return;
  for (const item of clientes) {
    const { data: client, error: clientError } = await supabase.from('clients').insert({ organization_id: orgId, full_name: item.cliente, phone: item.telefone }).select('id').single();
    if (clientError) throw clientError;
    const { error: reservationError } = await supabase.from('reservations').insert({
      organization_id: orgId, client_id: client.id, code: item.reserva, broker_name: item.corretor,
      real_estate_agency: item.imobiliaria, current_stage: item.etapaAtual, status: item.status,
      priority: priorityToDb(item.prioridade), credit_provider: item.creditu, monthly_transfer: item.repasseMes,
      notes: item.observacoes
    });
    if (reservationError) throw reservationError;
  }
}

async function authenticate(req, res, next) {
  if (!supabase) return next();
  try {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ erro: 'Autenticação necessária' });
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (claims.aal !== 'aal2') return res.status(403).json({ erro: 'Validação pelo Microsoft Authenticator necessária', codigo: 'MFA_REQUIRED' });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ erro: 'Sessão inválida' });
    const orgId = await getOrganizationId();
    const { data: member, error: memberError } = await supabase.from('organization_members').select('role, active').eq('organization_id', orgId).eq('user_id', data.user.id).single();
    if (memberError || !member?.active) return res.status(403).json({ erro: 'Usuário sem acesso à organização' });
    req.user = data.user;
    req.userRole = member.role;
    next();
  } catch (error) { responderErroInterno(res, error, 'authenticate'); }
}

const allowRoles = (...roles) => (req, res, next) => !supabase || roles.includes(req.userRole)
  ? next() : res.status(403).json({ erro: 'Permissão insuficiente' });

app.use('/api', authenticate);

const resumo = () => ({
  total: clientes.length,
  repasseMes: clientes.filter(c => c.repasseMes).length,
  comCreditu: clientes.filter(c => c.creditu).length,
  finalizados: clientes.filter(c => c.etapaAtual === etapas.length - 1).length,
  pendentes: clientes.filter(c => /pend/i.test(c.status)).length
});

app.get('/api/etapas', (_, res) => res.json(etapas));
app.get('/api/pre-cadastros', async (req, res) => {
  try {
    const orgId = await getOrganizationId();
    const q = String(req.query.q || '').trim();
    let consulta = supabase.from('pre_registrations').select('*').eq('organization_id', orgId).order('created_at', { ascending: false });
    if (q) consulta = consulta.or(`client_name.ilike.%${q}%,code.ilike.%${q}%,cpf_cnpj.ilike.%${q}%`);
    const { data, error } = await consulta;
    if (error) throw error;
    res.json(data);
  } catch (error) { responderErroInterno(res, error, 'listar-pre-cadastros'); }
});
app.post('/api/pre-cadastros', allowRoles('owner','admin','manager','analyst','broker'), async (req, res) => {
  try {
    const orgId = await getOrganizationId();
    const payload = {
      organization_id: orgId, code: req.body.code || `PC-${Date.now().toString().slice(-7)}`,
      client_name: String(req.body.client_name || '').trim(), cpf_cnpj: req.body.cpf_cnpj || null,
      email: req.body.email || null, phone: req.body.phone || null, development: req.body.development || null,
      broker_name: req.body.broker_name || null, real_estate_agency: req.body.real_estate_agency || null,
      status: req.body.status || 'Novo', notes: req.body.notes || null, created_by: req.user?.id || null
    };
    if (!payload.client_name) return res.status(400).json({ erro: 'Nome do cliente é obrigatório' });
    const { data, error } = await supabase.from('pre_registrations').insert(payload).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) { responderErroInterno(res, error, 'criar-pre-cadastro'); }
});
app.patch('/api/pre-cadastros/:id', allowRoles('owner','admin','manager','analyst','broker'), async (req, res) => {
  try {
    const permitidos = ['client_name','cpf_cnpj','email','phone','development','broker_name','real_estate_agency','status','notes','approval_status','rejection_reason','details'];
    const payload = Object.fromEntries(Object.entries(req.body).filter(([chave]) => permitidos.includes(chave)));
    const { data, error } = await supabase.from('pre_registrations').update(payload).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (error) { responderErroInterno(res, error, 'atualizar-pre-cadastro'); }
});
app.delete('/api/pre-cadastros/:id', allowRoles('owner','admin'), async (req, res) => {
  try {
    const { error } = await supabase.from('pre_registrations').delete().eq('id', req.params.id);
    if (error) throw error;
    res.status(204).end();
  } catch (error) { responderErroInterno(res, error, 'excluir-pre-cadastro'); }
});
app.get('/api/resumo', async (_, res) => {
  try {
    if (!supabase) return res.json(resumo());
    await ensureSeedData();
    const dados = await listReservations();
    res.json({ total: dados.length, repasseMes: dados.filter(c => c.repasseMes).length, comCreditu: dados.filter(c => c.creditu).length, finalizados: dados.filter(c => c.etapaAtual === etapas.length - 1).length, pendentes: dados.filter(c => /pend/i.test(c.status)).length });
  } catch (error) { responderErroInterno(res, error, 'resumo'); }
});
app.get('/api/clientes', async (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const imobiliaria = String(req.query.imobiliaria || 'TODOS');
  try {
    let dados;
    if (supabase) { await ensureSeedData(); dados = await listReservations(); } else dados = clientes;
    if (q) dados = dados.filter(c => [c.reserva, c.cliente, c.corretor, c.status].join(' ').toLowerCase().includes(q));
    if (imobiliaria !== 'TODOS') dados = dados.filter(c => c.imobiliaria === imobiliaria);
    res.json(dados);
  } catch (error) { responderErroInterno(res, error, 'listar-clientes'); }
});
app.post('/api/importar-planilha', allowRoles('owner','admin','manager'), uploadPlanilha.single('planilha'), async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Selecione uma planilha .xls ou .xlsx válida.' });
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true }).filter(row => row.Reserva != null);
    if (!rows.length) return res.status(400).json({ erro: 'A planilha não possui reservas válidas.' });
    if (rows.length > 2000) return res.status(400).json({ erro: 'A planilha excede o limite de 2.000 reservas por importação.' });
    const stats = { validas: rows.length, novas: 0, atualizadas: 0, clientesNovos: 0, repasses: 0 };
    if (!supabase) {
      for (const row of rows) {
        const code = textoPlanilha(row.Reserva).replace(/\.0$/, ''); const index = clientes.findIndex(c => c.reserva === code);
        const item = { reserva: code, cliente: textoPlanilha(row.Cliente), corretor: textoPlanilha(row.Corretor), imobiliaria: textoPlanilha(row.Imobiliária),
          telefone: textoPlanilha(row.Celular || row.Telefone), creditu: booleanoPlanilha(row['Creditú']), etapaAtual: etapaPlanilha(row['Situação']),
          status: textoPlanilha(row['Situação']) || 'Em processo', repasseMes: ['sim','probabilidade de cair'].includes(textoPlanilha(row['Repasse no mês:']).toLowerCase()),
          empreendimento: textoPlanilha(row.Empreendimento), unidade: textoPlanilha(row.Unidade), situacaoRepasse: textoPlanilha(row['Situação Repasse']),
          dataEnvioCehop: dataPlanilha(row['Data Envio CEHOP']), dataConformidadeCehop: dataPlanilha(row['Data Conformida de CEHOP']),
          dataReenvioCehop: dataPlanilha(row['Data do Reenvio CEHOP']), dataInconformidadeCehop: dataPlanilha(row['Data da Inconformidade CEHOP']),
          observacoes: textoPlanilha(row['Obs. Finalização'] || row['Observação Pós Venda'] || row['Última mensagem']), planilha: limparLinhaPlanilha(row) };
        if (index >= 0) { clientes[index] = { ...clientes[index], ...item }; stats.atualizadas++; } else { clientes.push({ id: uuid(), prioridade: 'verde', ...item }); stats.novas++; }
      }
      return res.json(stats);
    }
    const orgId = await getOrganizationId();
    for (const row of rows) {
      const code = textoPlanilha(row.Reserva).replace(/\.0$/, '');
      const { data: foundReservations, error: findError } = await supabase.from('reservations').select('id, client_id, operational_data, financial_data').eq('organization_id', orgId).eq('code', code).limit(1);
      if (findError) throw findError;
      const existing = foundReservations?.[0]; const cpf = textoPlanilha(row.Documento).replace(/\D/g,'') || null; const fullName = textoPlanilha(row.Cliente) || `Cliente reserva ${code}`;
      const clientPayload = { organization_id: orgId, full_name: fullName, phone: textoPlanilha(row.Celular || row.Telefone) || null,
        email: textoPlanilha(row['E-mail']) || null, cpf_cnpj: cpf, gross_income: numeroPlanilha(row['Renda Bruta Formal']), metadata: {
          nacionalidade: row.Nacionalidade, naturalidade: row.Naturalidade, estado: row.Estado, cidade: row.Cidade, bairro: row.Bairro, endereco: row.Endereço,
          codigo_origem: row['Código interno do cliente']
        }};
      let clientId = existing?.client_id;
      if (clientId) {
        const { error } = await supabase.from('clients').update(clientPayload).eq('id', clientId); if (error) throw error;
      } else {
        let query = supabase.from('clients').select('id').eq('organization_id', orgId).limit(1); query = cpf ? query.eq('cpf_cnpj', cpf) : query.ilike('full_name', fullName);
        const { data: matched } = await query; clientId = matched?.[0]?.id;
        if (clientId) { const { error } = await supabase.from('clients').update(clientPayload).eq('id', clientId); if (error) throw error; }
        else { const { data, error } = await supabase.from('clients').insert(clientPayload).select('id').single(); if (error) throw error; clientId = data.id; stats.clientesNovos++; }
      }
      const operational = { ...(existing?.operational_data || {}), planilha: limparLinhaPlanilha(row), bloco: row.Bloco, titulo: row.Título,
        dataPosse: dataPlanilha(row['Data de Posse']), condicionante: row['Condicionante para Liberação'], classificacaoPosVenda: row['Classificação Pós Venda'],
        classificacaoCliente: row['Classificação do Cliente'], previsaoEntrega: dataPlanilha(row['Data Entrega']), dataVenda: dataPlanilha(row['Data de Venda']),
        mesCompetencia: row['Mês de Competência'], tabelaPreco: row['Tabela de preço'], dataContrato: dataPlanilha(row['Data contrato']),
        situacaoRepasse: row['Situação Repasse'], quantidadeFilhos: row['quantos filhos:'], cidadeOrigem: row['Em qual cidade o cliente morou a maior parte da vida?'],
        bairroOrigem: row['Em qual bairro o cliente morou a maior parte da vida?'], situacaoCreditu: row['Situação Creditú'], rendaInformal: row['Renda Informal'],
        rendaFormal: row['Renda Bruta Formal'], tipoRenda: row['Tipo da Renda'], dataEnvioCehop: dataPlanilha(row['Data Envio CEHOP']),
        dataConformidadeCehop: dataPlanilha(row['Data Conformida de CEHOP']), dataReenvioCehop: dataPlanilha(row['Data do Reenvio CEHOP']),
        dataInconformidadeCehop: dataPlanilha(row['Data da Inconformidade CEHOP']), kitRegistroOk: dataPlanilha(row['Data do Kit Registro OK']),
        categoriaFiador: row['CATEGORIA DE RENDA DO FIADOR'], tresAnosFgts: row['3 ANOS de FGTS?'], aprovacaoFichaAgehab: dataPlanilha(row['Data Da Aprovação da Ficha AGEHAB']),
        envioFichaAgehab: dataPlanilha(row['Data do Envio da Ficha']), cadastroFichaAgehab: dataPlanilha(row['Data de cadastro da ficha AGEHAB']), fichaAgehab: row['N° da Ficha AGEHAB'],
        observacaoFinalizacao: row['Obs. Finalização'], contratoPortal: row['Contrato no Portal do Cliente'], obsAgehab: row['OBS. AGEHAB'], comissaoAp: row['COMISSÃO-AP'],
        excecaoCaixa: row['Exceção para assinatura do Contrato Caixa'], bonusAp: row['BÔNUS-AP'] };
      const financial = { ...(existing?.financial_data || {}), valorContratoReserva: numeroPlanilha(row['Valor do contrato']), valorPresente: numeroPlanilha(row['Valor presente']),
        valorFinanciamento: numeroPlanilha(row['Valor do financiamento']), valorSubsidio: numeroPlanilha(row['Valor do subsídio']), valorFgts: numeroPlanilha(row['Valor do FGTS']),
        valorTotal: numeroPlanilha(row['Valor total']), comissaoCorretor: numeroPlanilha(row['Comissão corretor']), comissaoImobiliaria: numeroPlanilha(row['Comissão imobiliária']), totalComissao: numeroPlanilha(row['Total comissão']) };
      const reservationPayload = { organization_id: orgId, client_id: clientId, code, broker_name: textoPlanilha(row.Corretor) || null,
        real_estate_agency: textoPlanilha(row.Imobiliária) || null, development: textoPlanilha(row.Empreendimento) || null, unit: textoPlanilha(row.Unidade) || null,
        current_stage: etapaPlanilha(row['Situação']), status: textoPlanilha(row['Situação']) || 'Em processo', credit_provider: booleanoPlanilha(row['Creditú']),
        monthly_transfer: ['sim','probabilidade de cair'].includes(textoPlanilha(row['Repasse no mês:']).toLowerCase()),
        notes: textoPlanilha(row['Obs. Finalização'] || row['Observação Pós Venda'] || row['Última mensagem']) || null, operational_data: operational, financial_data: financial };
      let reservationId;
      if (existing) { const { data, error } = await supabase.from('reservations').update(reservationPayload).eq('id', existing.id).select('id').single(); if (error) throw error; reservationId = data.id; stats.atualizadas++; }
      else { const { data, error } = await supabase.from('reservations').insert(reservationPayload).select('id').single(); if (error) throw error; reservationId = data.id; stats.novas++; }
      const transferStatus = textoPlanilha(row['Situação Repasse']);
      if (transferStatus) {
        const transferPayload = { organization_id: orgId, reservation_id: reservationId, code: `REP-${code}`, status: transferStatus,
          correspondent_company: textoPlanilha(row['Empresa correspondente']) || null, financed_amount: numeroPlanilha(row['Valor do financiamento']) || 0,
          financial_data: { valorContrato: numeroPlanilha(row['Valor do contrato']), valorPresente: numeroPlanilha(row['Valor presente']) }, contract_data: { dataContrato: dataPlanilha(row['Data contrato']) } };
        const { error } = await supabase.from('transfers').upsert(transferPayload, { onConflict: 'organization_id,code' }); if (error) throw error; stats.repasses++;
      }
    }
    res.json(stats);
  } catch (error) { responderErroInterno(res, error, 'importar-planilha'); }
});
app.post('/api/clientes', allowRoles('owner','admin','manager','analyst','broker'), async (req, res) => {
  if (supabase) {
    try {
      const orgId = await getOrganizationId();
      const { data: client, error: clientError } = await supabase.from('clients').insert({ organization_id: orgId, full_name: req.body.cliente, phone: req.body.telefone }).select('id').single();
      if (clientError) throw clientError;
      const { data, error } = await supabase.from('reservations').insert({ organization_id: orgId, client_id: client.id, code: req.body.reserva, broker_name: req.body.corretor, real_estate_agency: req.body.imobiliaria, current_stage: Number(req.body.etapaAtual || 0), status: req.body.status || 'Em processo', priority: priorityToDb(req.body.prioridade), credit_provider: Boolean(req.body.creditu), monthly_transfer: Boolean(req.body.repasseMes), notes: req.body.observacoes }).select('*, clients(*)').single();
      if (error) throw error;
      return res.status(201).json(mapReservation(data));
    } catch (error) { return responderErroInterno(res, error, 'criar-cliente'); }
  }
  const novo = { id: uuid(), ...req.body, etapaAtual: Number(req.body.etapaAtual || 0), atualizadoEm: new Date().toISOString() };
  clientes.unshift(novo);
  res.status(201).json(novo);
});
app.patch('/api/clientes/:id', allowRoles('owner','admin','manager','analyst','broker'), async (req, res) => {
  if (supabase) {
    try {
      const known = { etapaAtual: 'current_stage', status: 'status', prioridade: 'priority', creditu: 'credit_provider', repasseMes: 'monthly_transfer', observacoes: 'notes', corretor: 'broker_name', imobiliaria: 'real_estate_agency' };
      const update = {};
      const extras = {};
      for (const [key, value] of Object.entries(req.body)) {
        if (known[key]) update[known[key]] = key === 'prioridade' ? priorityToDb(value) : value;
        else if (!['id','reserva','cliente','telefone','atualizadoEm'].includes(key)) extras[key] = value;
      }
      if (Object.keys(extras).length) {
        const { data: current } = await supabase.from('reservations').select('operational_data').eq('id', req.params.id).single();
        update.operational_data = { ...(current?.operational_data || {}), ...extras };
      }
      const { data, error } = await supabase.from('reservations').update(update).eq('id', req.params.id).select('*, clients(*)').single();
      if (error) throw error;
      return res.json(mapReservation(data));
    } catch (error) { return responderErroInterno(res, error, 'atualizar-cliente'); }
  }
  const i = clientes.findIndex(c => c.id === req.params.id);
  if (i < 0) return res.status(404).json({ erro: 'Cliente não encontrado' });
  clientes[i] = { ...clientes[i], ...req.body, atualizadoEm: new Date().toISOString() };
  res.json(clientes[i]);
});
app.delete('/api/clientes/:id', allowRoles('owner','admin'), async (req, res) => {
  if (supabase) {
    const { error } = await supabase.from('reservations').delete().eq('id', req.params.id);
    if (error) return responderErroInterno(res, error, 'excluir-cliente');
    return res.status(204).end();
  }
  clientes = clientes.filter(c => c.id !== req.params.id);
  res.status(204).end();
});

app.use((error, req, res, next) => {
  if (error?.message === 'Origem não permitida')
    return res.status(403).json({ erro: 'Origem não permitida.' });
  return responderErroInterno(res, error, 'middleware');
});

if (process.env.NODE_ENV !== 'production') {
  const port = process.env.PORT || 3001;
  app.listen(port, () => console.log(`API rodando em http://localhost:${port}`));
}

export default app;

