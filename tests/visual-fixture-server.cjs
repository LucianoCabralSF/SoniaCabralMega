const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.SONIA_FIXTURE_PORT || 4176);
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Manaus' });
const month = today.slice(0, 7);
const day = today.slice(8, 10);

const fixture = {
  getConfig: { salonName: 'Sonia Cabral', horaInicio: '08:00', horaFim: '18:00', intervaloMin: '30' },
  getClientes: [
    { id: 'cli_1', nome: 'Maria Silva', telefone: '(92) 99999-1111', aniversario: '15/08' },
    { id: 'cli_2', nome: 'Ana Costa', telefone: '(92) 98888-2222', aniversario: '02/11' }
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
    { id: 'ag_2', data: today, hora: '14:00', duracaoMin: 60, clienteId: 'cli_2', clienteNome: 'Ana Costa', colaboradorId: 'col_1', colaboradorNome: 'Sonia Cabral', servicos: 'Escova', valor: 150, status: 'agendado' }
  ],
  getVencimentos: [
    { id: 'pp_1', descricao: 'Aluguel do salão', valor: 1500, vencimento: `${month}-10`, _tipo: 'despesa' }
  ],
  getAtrasados: [],
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
