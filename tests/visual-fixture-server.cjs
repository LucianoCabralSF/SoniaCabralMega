const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.SONIA_FIXTURE_PORT || 4176);
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });
const month = today.slice(0, 7);
const day = today.slice(8, 10);
function shiftDate(days) {
  const [year, currentMonth, currentDay] = today.split('-').map(Number);
  const date = new Date(Date.UTC(year, currentMonth - 1, currentDay + days));
  return date.toISOString().slice(0, 10);
}
const upcomingDate = shiftDate(5);
const recoveryDate = shiftDate(-18);

function dreLine(values) {
  const meses = Array.from({ length: 12 }, (_, index) => Number(values[index]) || 0);
  return { meses, total: meses.reduce((sum, value) => sum + value, 0) };
}

const dreFixtureLines = {
  receita_servicos: dreLine([500000,350000,100000]),
  receita_produtos: dreLine([100000,50000,0]),
  outras_receitas: dreLine([]),
  deducoes: dreLine([30000,0,0]),
  receita_liquida: dreLine([570000,400000,100000]),
  custos_variaveis: dreLine([120000,90000,70000]),
  margem_contribuicao: dreLine([450000,310000,30000]),
  despesas_pessoal: dreLine([100000,100000,100000]),
  despesas_estrutura: dreLine([80000,80000,80000]),
  despesas_operacionais: dreLine([20000,30000,0]),
  resultado_financeiro: dreLine([-10000,5000,0]),
  resultado_liquido: dreLine([240000,105000,-150000]),
  retirada: dreLine([50000,40000,0]),
  resultado_apos_retiradas: dreLine([190000,65000,-150000]),
  nao_classificado: dreLine([-15000,0,0])
};

const dreFixtureMovements = [
  { id:'dre_svc_1', data:'2026-01-10', mes:1, tipo:'entrada', itemTipo:'agendamento', itemNome:'Manutenção Mega-Hair', categoria:'Serviço', dreCategoriaResolvida:'receita_servicos', valorCentavos:500000 },
  { id:'dre_prod_1', data:'2026-01-11', mes:1, tipo:'entrada', itemTipo:'produto', itemNome:'Linha de tratamento', categoria:'Produto', dreCategoriaResolvida:'receita_produtos', valorCentavos:100000 },
  { id:'dre_ded_1', data:'2026-01-12', mes:1, tipo:'saida', categoria:'Estorno', itemNome:'Estorno controlado', dreCategoriaResolvida:'deducoes', valorCentavos:30000 },
  { id:'dre_cost_1', data:'2026-01-13', mes:1, tipo:'saida', categoria:'Material', itemNome:'Material aplicado', dreCategoriaResolvida:'custos_variaveis', valorCentavos:120000 },
  { id:'dre_pay_1', data:'2026-01-15', mes:1, tipo:'saida', categoria:'Salário', itemNome:'Folha', dreCategoriaResolvida:'despesas_pessoal', valorCentavos:100000 },
  { id:'dre_rent_1', data:'2026-01-16', mes:1, tipo:'saida', categoria:'Aluguel', itemNome:'Aluguel', dreCategoriaResolvida:'despesas_estrutura', valorCentavos:80000 },
  { id:'dre_ops_1', data:'2026-01-18', mes:1, tipo:'saida', categoria:'Marketing', itemNome:'Divulgação', dreCategoriaResolvida:'despesas_operacionais', valorCentavos:20000 },
  { id:'dre_fin_1', data:'2026-01-20', mes:1, tipo:'saida', categoria:'Taxa bancária', itemNome:'Taxa bancária', dreCategoriaResolvida:'resultado_financeiro', valorCentavos:10000 },
  { id:'dre_with_1', data:'2026-01-22', mes:1, tipo:'saida', categoria:'Retirada Pessoal', itemNome:'Retirada', dreCategoriaResolvida:'retirada', valorCentavos:50000 },
  { id:'dre_unknown_in', data:'2026-01-24', mes:1, tipo:'entrada', categoria:'Outros', itemNome:'Entrada sem categoria', observacoes:'Classificar esta entrada', dreCategoriaResolvida:'nao_classificado', valorCentavos:10000 },
  { id:'dre_unknown_out', data:'2026-01-25', mes:1, tipo:'saida', categoria:'Outros', itemNome:'Saída sem categoria', observacoes:'Classificar esta saída', dreCategoriaResolvida:'nao_classificado', valorCentavos:25000 },
  { id:'dre_svc_2', data:'2026-02-10', mes:2, tipo:'entrada', itemTipo:'agendamento', itemNome:'Serviços de fevereiro', dreCategoriaResolvida:'receita_servicos', valorCentavos:350000 },
  { id:'dre_prod_2', data:'2026-02-12', mes:2, tipo:'entrada', itemTipo:'produto', itemNome:'Produtos de fevereiro', dreCategoriaResolvida:'receita_produtos', valorCentavos:50000 },
  { id:'dre_cost_2', data:'2026-02-13', mes:2, tipo:'saida', categoria:'Material', itemNome:'Materiais de fevereiro', dreCategoriaResolvida:'custos_variaveis', valorCentavos:90000 },
  { id:'dre_pay_2', data:'2026-02-15', mes:2, tipo:'saida', categoria:'Salário', itemNome:'Folha', dreCategoriaResolvida:'despesas_pessoal', valorCentavos:100000 },
  { id:'dre_rent_2', data:'2026-02-16', mes:2, tipo:'saida', categoria:'Aluguel', itemNome:'Aluguel', dreCategoriaResolvida:'despesas_estrutura', valorCentavos:80000 },
  { id:'dre_ops_2', data:'2026-02-18', mes:2, tipo:'saida', categoria:'Marketing', itemNome:'Divulgação', dreCategoriaResolvida:'despesas_operacionais', valorCentavos:30000 },
  { id:'dre_fin_2', data:'2026-02-20', mes:2, tipo:'entrada', categoria:'Rendimento', itemNome:'Rendimento', dreCategoriaResolvida:'resultado_financeiro', valorCentavos:5000 },
  { id:'dre_with_2', data:'2026-02-22', mes:2, tipo:'saida', categoria:'Retirada Pessoal', itemNome:'Retirada', dreCategoriaResolvida:'retirada', valorCentavos:40000 },
  { id:'dre_svc_3', data:'2026-03-10', mes:3, tipo:'entrada', itemTipo:'agendamento', itemNome:'Serviços de março', dreCategoriaResolvida:'receita_servicos', valorCentavos:100000 },
  { id:'dre_cost_3', data:'2026-03-13', mes:3, tipo:'saida', categoria:'Material', itemNome:'Materiais de março', dreCategoriaResolvida:'custos_variaveis', valorCentavos:70000 },
  { id:'dre_pay_3', data:'2026-03-15', mes:3, tipo:'saida', categoria:'Salário', itemNome:'Folha', dreCategoriaResolvida:'despesas_pessoal', valorCentavos:100000 },
  { id:'dre_rent_3', data:'2026-03-16', mes:3, tipo:'saida', categoria:'Aluguel', itemNome:'Aluguel', dreCategoriaResolvida:'despesas_estrutura', valorCentavos:80000 }
];

function dreDetailFixture(line, month) {
  const composite = {
    receita_liquida:['receita_servicos','receita_produtos','outras_receitas','deducoes'],
    margem_contribuicao:['receita_servicos','receita_produtos','outras_receitas','deducoes','custos_variaveis'],
    resultado_liquido:['receita_servicos','receita_produtos','outras_receitas','deducoes','custos_variaveis','despesas_pessoal','despesas_estrutura','despesas_operacionais','resultado_financeiro'],
    resultado_apos_retiradas:['receita_servicos','receita_produtos','outras_receitas','deducoes','custos_variaveis','despesas_pessoal','despesas_estrutura','despesas_operacionais','resultado_financeiro','retirada']
  };
  const accepted = composite[line] || [line];
  const negative = new Set(['deducoes','custos_variaveis','despesas_pessoal','despesas_estrutura','despesas_operacionais','retirada']);
  return dreFixtureMovements.filter(row => accepted.includes(row.dreCategoriaResolvida) && (!month || row.mes === Number(month))).map(row => {
    let contribution = row.tipo === 'saida' ? -row.valorCentavos : row.valorCentavos;
    if (!composite[line] && negative.has(row.dreCategoriaResolvida)) contribution = row.valorCentavos;
    if (composite[line] && negative.has(row.dreCategoriaResolvida)) contribution = -row.valorCentavos;
    return { ...row, valorContribuicaoCentavos: contribution };
  });
}

const fixture = {
  getConfig: { salonName: 'Sonia Cabral', horaInicio: '08:00', horaFim: '18:00', intervaloMin: '30' },
  getClientes: [
    { id: 'cli_1', nome: 'Maria Silva', telefone: '(92) 99999-1111', aniversario: '15/08/1988', naoContatar: 'false' },
    { id: 'cli_2', nome: 'Ana Costa', telefone: '(92) 98888-2222', aniversario: '02/11/1991', naoContatar: 'false' },
    { id: 'cli_3', nome: 'Beatriz Lima', telefone: '(92) 97777-3333', aniversario: '19/07/1994', naoContatar: 'true' },
    { id: 'cli_4', nome: 'Carla Souza', telefone: '123', aniversario: '21/07/1985', naoContatar: 'false' }
  ],
  getServicos: [
    { id: 'svc_1', nome: 'Manutenção Mega-Hair', descricao: 'Manutenção completa', duracaoMin: 120, ativo: 'true' },
    { id: 'svc_2', nome: 'Escova', descricao: 'Finalização', duracaoMin: 60, ativo: 'true' }
  ],
  getProdutos: [
    { id: 'prd_1', nome: 'Linha de tratamento', preco: 89.9, descricao: 'Uso profissional', ativo: 'true' }
  ],
  getColaboradores: [
    { id: 'col_1', nome: 'Sonia Cabral', cargo: 'Especialista', horaInicio: '08:00', horaFim: '18:00', ativo: 'true' }
  ],
  getCrediario: [
    { id: 'cred_1', clienteNome: 'Maria Silva', saldoDevedor: 250, numParcelas: 3, status: 'aberto' }
  ],
  getCrediarioMovs: [
    { id: 'mov_1', crediarioId: 'cred_1', numParcela: 1, valor: 100, vencimento: `${month}-${day}`, status: 'aberto' }
  ],
  getPlanejamento: [
    { id: 'plan_1', tipo: 'despesa', descricao: 'Aluguel do salão', valorTotal: 1500, numParcelas: 1, valorParcela: 1500, diaVencimento: 10, dataInicio: `${month}-10`, status: 'ativo' }
  ],
  getPlanejamentoParcelas: [
    { id: 'pp_1', planejamentoId: 'plan_1', tipo: 'despesa', descricao: 'Aluguel do salão', valor: 1500, vencimento: `${month}-10`, pago: 'false', status: 'aberto' }
  ],
  getHomeResumo: {
    clientes: 2, servicos: 2, fiadosAbertos: 250, obrigacoesAbertas: 1500,
    metaNegocio: 1700, resultadoOperacionalProjetado: 650,
    extrato: { faturamento: 2350, saidasOp: 200, retiradas: 300 }
  },
  getCaixaResumo: { entradas: 800, saidas: 120, saldo: 680, porForma: { pix: 500, dinheiro: 300 }, total: 3 },
  getCaixa: [
    { id: 'cx_1', data: today, tipo: 'entrada', clienteNome: 'Maria Silva', itemNome: 'Manutenção Mega-Hair', valor: 500, formaPagamento: 'pix' },
    { id: 'cx_2', data: today, tipo: 'saida', categoria: 'Material', itemNome: 'Material', valor: 120, formaPagamento: 'dinheiro' }
  ],
  getAgendamentos: [
    { id: 'ag_1', data: today, hora: '09:00', duracaoMin: 120, clienteId: 'cli_1', clienteNome: 'Maria Silva', colaboradorId: 'col_1', colaboradorNome: 'Sonia Cabral', servicos: 'Manutenção Mega-Hair', valor: 500, status: 'agendado' },
    { id: 'ag_2', data: today, hora: '14:00', duracaoMin: 60, clienteId: 'cli_2', clienteNome: 'Ana Costa', colaboradorId: 'col_1', colaboradorNome: 'Sonia Cabral', servicos: 'Escova', valor: 150, status: 'agendado' },
    { id: 'ag_hist_1', data: shiftDate(-45), hora: '10:00', duracaoMin: 120, clienteId: 'cli_1', clienteNome: 'Maria Silva', colaboradorId: 'col_1', colaboradorNome: 'Sonia Cabral', servicos: 'Manutenção Mega-Hair', valor: 480, status: 'concluido' },
    { id: 'ag_hist_2', data: shiftDate(-70), hora: '15:00', duracaoMin: 60, clienteId: 'cli_2', clienteNome: 'Ana Costa', colaboradorId: 'col_1', colaboradorNome: 'Sonia Cabral', servicos: 'Escova', valor: 150, status: 'concluido' }
  ],
  getVencimentos: [
    { id: 'pp_1', descricao: 'Aluguel do salão', valor: 1500, vencimento: `${month}-10`, _tipo: 'despesa' }
  ],
  getAtrasados: [],
  getRelacionamento: [
    { id: 'rel_1', clienteId: 'cli_1', clienteNome: 'Maria Silva', origem: 'retorno', dataAlvo: upcomingDate, etapa: 'pendente', fila: 'proximo', diasAtraso: 0, telefoneWhatsApp: '5592999991111', telefoneValido: true, ultimoAtendimento: shiftDate(-45), ultimoServico: 'Manutenção Mega-Hair', mensagemSugerida: 'Olá, Maria! Está chegando a época da sua manutenção. Vamos agendar?' },
    { id: 'rel_2', clienteId: 'cli_2', clienteNome: 'Ana Costa', origem: 'retorno', dataAlvo: recoveryDate, etapa: 'contatada', fila: 'recuperacao', diasAtraso: 18, telefoneWhatsApp: '5592988882222', telefoneValido: true, ultimoAtendimento: shiftDate(-70), ultimoServico: 'Escova', mensagemSugerida: 'Olá, Ana! Podemos reservar seu próximo horário?' },
    { id: 'rel_3', clienteId: 'cli_3', clienteNome: 'Beatriz Lima', origem: 'aniversario', dataAlvo: today, etapa: 'pendente', fila: 'aniversario', diasAtraso: 0, telefoneWhatsApp: '5592977773333', telefoneValido: false, naoContatar: true, ultimoAtendimento: '', ultimoServico: '', mensagemSugerida: 'Feliz aniversário, Beatriz!' },
    { id: 'rel_4', clienteId: 'cli_4', clienteNome: 'Carla Souza', origem: 'campanha', campanhaId: 'cam_1', dataAlvo: today, etapa: 'pendente', fila: 'campanha', diasAtraso: 0, telefoneWhatsApp: '', telefoneValido: false, ultimoAtendimento: '', ultimoServico: '', mensagemSugerida: 'Olá, Carla! Temos uma novidade.' }
  ],
  getRelacionamentoResumo: {
    elegiveis: 4, contatadas: 1, responderam: 0, agendaram: 0, retornaram: 0,
    taxaContato: 0.25, taxaResposta: 0, taxaAgendamento: 0, taxaRetorno: 0
  },
  getRelacionamentoEventos: [
    { id: 'evt_1', oportunidadeId: 'rel_2', clienteId: 'cli_2', tipo: 'contato', etapaAnterior: 'pendente', etapaNova: 'contatada', origemAlteracao: 'manual', dataHora: `${today}T10:30:00`, mensagem: 'Olá, Ana! Podemos reservar seu próximo horário?' }
  ],
  getCampanhas: [
    { id: 'cam_1', nome: 'Clientes de julho', mensagemModelo: 'Olá, {nome}! Temos uma novidade.', dataInicio: today, dataFim: shiftDate(30), status: 'ativa' }
  ],
  getLembretesConfig: {
    ativo: false, antecedenciaHoras: 4,
    mensagemModelo: 'Olá, {nome}! Lembramos que seu atendimento de {servico} na {salao} está marcado para hoje, {data}, às {hora}. Responda para confirmar.',
    templateName: 'lembrete_agendamento', templateLanguage: 'pt_BR', apiVersion: 'v23.0',
    phoneNumberId: '', tokenConfigurado: false, pronto: false, triggerAtivo: false
  },
  getLembretesEnvios: [
    { id:'lem_1', telefone:'5592999991111', mensagem:'Olá, Maria! Seu atendimento está marcado para hoje.', status:'enviado', enviadoEm:`${today}T08:15:00`, providerMessageId:'wamid.fixture.1' },
    { id:'lem_2', telefone:'5592988882222', mensagem:'Olá, Ana! Seu atendimento está marcado para hoje.', status:'pendente', programadoPara:`${today}T10:00:00` },
    { id:'lem_3', telefone:'5592977773333', status:'erro', programadoPara:`${today}T08:00:00`, ultimoErro:'Modelo ainda não aprovado.' }
  ],
  getClientesTelefonePendente: [
    { id:'cli_4', nome:'Carla Souza', telefone:'123' }
  ],
  testWhatsAppConfig: { ok:true, phoneNumberId:'123456789', numero:'+55 92 99999-0000', nomeVerificado:'Sonia Cabral' },
  runLembretesNow: { reconciliados:2, enviados:1, erros:0, expirados:0, cancelados:0 },
  getDreAnual: {
    ano: 2026, linhas: dreFixtureLines, provisoria: true,
    naoClassificados: { entradas:10000, saidas:25000, saldo:-15000 },
    conciliacao: { variacaoBrutaElegivel:90000, totalExplicado:90000, diferencaTecnica:0 },
    indicadores: { faturamento:1100000, resultado:195000, margem:195000/1070000, melhorMes:0, piorMes:2 }
  },
  getDreDetalhe: [],
  getDreMapeamentos: [],
  saveDreClassificacao: { id:'dre_unknown_in', dreCategoria:'outras_receitas' },
  saveDreMapeamento: { id:'map_fixture' },
  getExtrato: {
    label: 'Período de teste', faturamento: 2350, saidasOp: 200, retiradas: 300,
    totalSaidas: 500, resultadoOp: 2150, resultadoFinal: 1850,
    porForma: { pix: 1500, dinheiro: 850 }, porCategoria: { Material: 200 }, dias: [], total: 5
  }
};

function json(response, body) {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

const server = http.createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/api') {
    let raw = '';
    request.on('data', chunk => { raw += chunk; });
    request.on('end', () => {
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch (_) {}
      if (body.action === 'login') return json(response, { status: 'ok', data: { token: 'fixture-token', longToken: !!body.lembrar } });
      if (body.action === 'verificarSenha') return json(response, { status: 'ok', data: { valido: true } });
      let data = Object.prototype.hasOwnProperty.call(fixture, body.action) ? fixture[body.action] : { item: body.data || {}, id: body.id || 'fixture-id' };
      if (body.action === 'getDreDetalhe') {
        data = dreDetailFixture(body.linha, body.mes);
      }
      if (body.action === 'saveDreClassificacao') {
        data = { id:body.id, dreCategoria:body.dreCategoria };
      }
      if (body.action === 'saveDreMapeamento') {
        data = { id:'map_fixture', item:body.data || {} };
      }
      if (body.action === 'saveLembretesConfig') {
        data = { ...fixture.getLembretesConfig, ...body.data, pronto:!!(body.data?.phoneNumberId && body.data?.accessToken), triggerAtivo:!!body.data?.ativo };
        delete data.accessToken;
      }
      if (body.action === 'getAgendamentos') {
        data = data.filter(item => {
          if (body.data && item.data !== body.data) return false;
          if (body.dataInicio && item.data < body.dataInicio) return false;
          if (body.dataFim && item.data > body.dataFim) return false;
          return true;
        });
      }
      return json(response, { status: 'ok', data });
    });
    return;
  }

  const requested = request.url === '/' ? 'index.html' : request.url.replace(/^\//, '').split('?')[0];
  const file = path.join(root, requested);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  let content = fs.readFileSync(file);
  if (requested === 'index.html') {
    content = Buffer.from(content.toString('utf8').replace(/window\.__API_URL__\s*=\s*'[^']+';/, "window.__API_URL__ = '/api';"));
  }
  const ext = path.extname(file);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
  response.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  response.end(content);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Visual fixture ready at http://127.0.0.1:${port}/\n`);
});
