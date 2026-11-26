// Teste de ponta a ponta da API contra um banco com dados de demonstração (05_seed_demo.sql).
// Uso: API_URL=http://localhost:3000 node tests/api.test.mjs
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const API = process.env.API_URL || 'http://localhost:3000';
let falhas = 0, ok = 0;

async function chamar(token, metodo, caminho, corpo) {
  const r = await fetch(API + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await r.text();
  let dados; try { dados = JSON.parse(texto); } catch { dados = texto; }
  return { status: r.status, dados };
}
async function login(l) { const r = await chamar(null, 'POST', '/api/auth/login', { login: l, senha: 'sisti123' }); assert.equal(r.status, 200, JSON.stringify(r.dados)); return r.dados; }
async function caso(nome, fn) {
  try { await fn(); ok++; console.log('  ok  ', nome); }
  catch (e) { falhas++; console.log('  FALHA', nome, '\n       ', e.message); }
}

const tec = await login('tecnico'), ges = await login('gestor'), ger = await login('gerente'),
      com = await login('compras'), coo = await login('coordenador'), adm = await login('admin');
const T = tec.token, G = ges.token, GR = ger.token, C = com.token, CO = coo.token, A = adm.token;
const ref = (await chamar(T, 'GET', '/api/ref')).dados;
const L01 = ref.lojas.find(l => l.codigo === 'L01');
const forn = ref.fornecedores.find(f => f.razao_social.startsWith('TecPDV'));
const naoHomologado = (await chamar(A, 'GET', '/api/cadastros/fornecedores')).dados.find(f => !f.homologado);
const catTouch = ref.categorias.find(c => c.codigo === 'PDV-TOUCH');

console.log('Segurança e acesso');
await caso('login inválido é recusado', async () => {
  const r = await chamar(null, 'POST', '/api/auth/login', { login: 'gestor', senha: 'errada' }); assert.equal(r.status, 401);
});
await caso('sem token não acessa', async () => { assert.equal((await chamar(null, 'GET', '/api/equipamentos')).status, 401); });
await caso('token adulterado é recusado', async () => { assert.equal((await chamar(T.slice(0, -2) + 'xx', 'GET', '/api/equipamentos')).status, 401); });
await caso('gerente vê só a própria loja (RLS)', async () => {
  const r = await chamar(GR, 'GET', '/api/equipamentos?limit=2000');
  assert.ok(r.dados.length > 0); assert.ok(r.dados.every(e => e.loja_codigo === 'L01'));
});
await caso('técnico não vê loja fora da sua área (L05)', async () => {
  const r = await chamar(T, 'GET', '/api/equipamentos?limit=2000');
  assert.ok(!r.dados.some(e => e.loja_codigo === 'L05'));
});
await caso('gerente não cadastra modelo (RBAC)', async () => {
  assert.equal((await chamar(GR, 'POST', '/api/cadastros/marcas', { nome: 'X' })).status, 403);
});

console.log('Cadastro de equipamento');
const pdv = ref.produtos.find(p => p.modelo === 'PDV-A10');
const caixa = ref.departamentos.find(d => d.codigo === 'CX');
let equip;
await caso('cadastra equipamento com campos obrigatórios', async () => {
  const r = await chamar(T, 'POST', '/api/equipamentos', { descricao: 'PDV teste', numero_serie: 'TESTE-' + Date.now(), produto_id: pdv.id,
    loja_id: L01.id, cor: 'Preto', departamento_id: caixa.id, valor_aquisicao: 4000, data_aquisicao: '2026-01-10' });
  assert.equal(r.status, 200, JSON.stringify(r.dados)); equip = r.dados;
});
await caso('série duplicada no mesmo modelo é bloqueada', async () => {
  const r = await chamar(T, 'POST', '/api/equipamentos', { descricao: 'Dup', numero_serie: equip.numero_serie, produto_id: pdv.id,
    loja_id: L01.id, cor: 'Preto', departamento_id: caixa.id });
  assert.equal(r.status, 409);
});
await caso('sem série gera código interno', async () => {
  const r = await chamar(T, 'POST', '/api/equipamentos', { descricao: 'Leitor sem série', produto_id: ref.produtos.find(p => p.modelo === 'LM-2D').id,
    loja_id: L01.id, cor: 'Preto', departamento_id: caixa.id });
  assert.equal(r.status, 200); assert.match(r.dados.numero_serie, /^INT-\d{6}$/);
});
await caso('cor é opcional (vazia vira nula)', async () => {
  const r = await chamar(T, 'POST', '/api/equipamentos', { descricao: 'Sem cor', produto_id: pdv.id, numero_serie: 'SEMCOR-' + Date.now(),
    loja_id: L01.id, cor: '', departamento_id: caixa.id });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  const det = await chamar(T, 'GET', '/api/equipamentos/' + r.dados.id);
  assert.equal(det.status, 200); assert.equal(det.dados.cor, null);
});
await caso('loja vazia é recusada', async () => {
  const r = await chamar(T, 'POST', '/api/equipamentos', { descricao: 'Sem loja', produto_id: pdv.id, cor: 'Preto', departamento_id: caixa.id });
  assert.equal(r.status, 400);
});
await caso('garantia sugerida pelo modelo (aquisição + 12 meses)', async () => {
  const r = await chamar(T, 'GET', `/api/equipamentos/${equip.id}`); assert.equal(r.dados.garantia_fim, '2027-01-10');
});

console.log('Fluxo corretivo completo');
let chamado;
await caso('gerente abre chamado (Ativo -> Aguardando orçamento) com aviso de garantia', async () => {
  const r = await chamar(GR, 'POST', '/api/chamados', { id: randomUUID(), equipamento_id: equip.id, relato: 'Tela touch sem resposta',
    categoria_falha_relatada_id: catTouch.id, prioridade: 'ALTA' });
  assert.equal(r.status, 200, JSON.stringify(r.dados)); chamado = r.dados;
  assert.ok(r.dados.aviso_garantia);
  const e = await chamar(T, 'GET', `/api/equipamentos/${equip.id}`); assert.equal(e.dados.status, 'AGUARDANDO_ORCAMENTO');
});
await caso('segundo chamado corretivo aberto é bloqueado', async () => {
  const r = await chamar(T, 'POST', '/api/chamados', { id: randomUUID(), equipamento_id: equip.id, relato: 'Outra falha qualquer' });
  assert.equal(r.status, 409);
});
await caso('Em manutenção sem orçamento aprovado é bloqueado', async () => {
  const r = await chamar(T, 'POST', `/api/equipamentos/${equip.id}/movimentar`, { id: randomUUID(), status_novo: 'EM_MANUTENCAO', motivo: 'tentativa' });
  assert.equal(r.status, 422); assert.match(r.dados.erro, /orçamento aprovado/);
});
await caso('fornecedor não homologado não orça', async () => {
  const r = await chamar(T, 'POST', '/api/orcamentos', { chamado_id: chamado.id, fornecedor_id: naoHomologado.id,
    itens: [{ tipo: 'PECA', descricao: 'Tela', quantidade: 1, valor_unitario: 100 }] });
  assert.equal(r.status, 422);
});
let orc;
await caso('técnico registra orçamento com itens separados', async () => {
  const r = await chamar(T, 'POST', '/api/orcamentos', { chamado_id: chamado.id, fornecedor_id: forn.id, validade: '2026-12-31',
    itens: [{ tipo: 'PECA', descricao: 'Tela touch 15"', quantidade: 1, valor_unitario: 520 },
            { tipo: 'MAO_DE_OBRA', descricao: 'Troca da tela', quantidade: 1.5, valor_unitario: 120 },
            { tipo: 'FRETE', descricao: 'Coleta', quantidade: 1, valor_unitario: 45 }] });
  assert.equal(r.status, 200, JSON.stringify(r.dados)); orc = r.dados; assert.equal(Number(orc.valor_total), 745);
});
await caso('técnico não aprova (sem permissão)', async () => {
  assert.equal((await chamar(T, 'POST', `/api/orcamentos/${orc.id}/decidir`, { aprovar: true, justificativa: 'aprovado' })).status, 403);
});
await caso('nova versão substitui a anterior (valor acima de R$ 1.000)', async () => {
  const r = await chamar(T, 'POST', `/api/orcamentos/${orc.id}/nova-versao`, {
    itens: [{ tipo: 'PECA', descricao: 'Tela touch 15" + placa', quantidade: 1, valor_unitario: 1100 },
            { tipo: 'MAO_DE_OBRA', descricao: 'Troca', quantidade: 1, valor_unitario: 150 }] });
  assert.equal(r.status, 200, JSON.stringify(r.dados)); assert.equal(r.dados.versao, 2); orc = r.dados;
});
await caso('gestor (alçada R$ 1.000) não aprova R$ 1.250', async () => {
  const r = await chamar(G, 'POST', `/api/orcamentos/${orc.id}/decidir`, { aprovar: true, justificativa: 'aprovado' });
  assert.equal(r.status, 422); assert.match(r.dados.erro, /alçada/);
});
await caso('coordenador exige 3 cotações acima do valor relevante', async () => {
  const r = await chamar(CO, 'POST', `/api/orcamentos/${orc.id}/decidir`, { aprovar: true, justificativa: 'aprovado' });
  assert.equal(r.status, 422); assert.match(r.dados.erro, /cotações/);
});
await caso('com mais 2 cotações, coordenador aprova e o equipamento vai para Em manutenção', async () => {
  for (const f of ref.fornecedores.filter(x => x.homologado && x.id !== forn.id && x.tipos.includes('ASSISTENCIA')).slice(0, 2)) {
    const r = await chamar(T, 'POST', '/api/orcamentos', { chamado_id: chamado.id, fornecedor_id: f.id,
      itens: [{ tipo: 'PECA', descricao: 'Tela', quantidade: 1, valor_unitario: 1500 }] });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
  }
  const r = await chamar(CO, 'POST', `/api/orcamentos/${orc.id}/decidir`, { aprovar: true, justificativa: 'Menor preço entre 3 cotações' });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  const e = await chamar(T, 'GET', `/api/equipamentos/${equip.id}`); assert.equal(e.dados.status, 'EM_MANUTENCAO');
  const det = await chamar(T, 'GET', `/api/chamados/${chamado.id}`);
  assert.equal(det.dados.orcamentos.filter(o => o.status === 'REPROVADO').length, 2);
});
await caso('trânsito sem documento é bloqueado', async () => {
  const r = await chamar(T, 'POST', `/api/equipamentos/${equip.id}/movimentar`, { id: randomUUID(), status_novo: 'TRANSITO', motivo: 'envio',
    destino_tipo: 'FORNECEDOR', fornecedor_destino_id: forn.id, chamado_id: chamado.id });
  assert.equal(r.status, 422);
});
await caso('envio, recebimento no fornecedor e retorno', async () => {
  const mov = async (b) => { const r = await chamar(T, 'POST', `/api/equipamentos/${equip.id}/movimentar`, { id: randomUUID(), chamado_id: chamado.id, ...b }); assert.equal(r.status, 200, JSON.stringify(r.dados)); };
  await mov({ status_novo: 'TRANSITO', motivo: 'Envio ao fornecedor', destino_tipo: 'FORNECEDOR', fornecedor_destino_id: forn.id, documento: 'NF-REM 9001' });
  let e = await chamar(T, 'GET', `/api/equipamentos/${equip.id}`); assert.equal(e.dados.status, 'TRANSITO');
  await mov({ status_novo: 'EM_MANUTENCAO', motivo: 'Recebido pelo fornecedor', confirmou_receb: true });
  e = await chamar(T, 'GET', `/api/equipamentos/${equip.id}`); assert.equal(e.dados.local_tipo, 'FORNECEDOR');
  await mov({ status_novo: 'TRANSITO', motivo: 'Retorno à loja', destino_tipo: 'LOJA', loja_destino_id: L01.id, documento: 'ROM 77' });
});
await caso('retorno sem teste é bloqueado', async () => {
  const r = await chamar(GR, 'POST', `/api/equipamentos/${equip.id}/movimentar`, { id: randomUUID(), status_novo: 'ATIVO', motivo: 'Recebido', confirmou_receb: true, chamado_id: chamado.id });
  assert.equal(r.status, 422);
});
const idRetorno = randomUUID();
await caso('gerente confirma recebimento e teste (Trânsito -> Ativo)', async () => {
  const r = await chamar(GR, 'POST', `/api/equipamentos/${equip.id}/movimentar`, { id: idRetorno, status_novo: 'ATIVO', motivo: 'Recebido e testado', confirmou_receb: true, teste_ok: true, chamado_id: chamado.id });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
});
await caso('reenvio da mesma operação (offline) não duplica', async () => {
  const r = await chamar(GR, 'POST', `/api/equipamentos/${equip.id}/movimentar`, { id: idRetorno, status_novo: 'ATIVO', motivo: 'Recebido e testado', confirmou_receb: true, teste_ok: true });
  assert.equal(r.status, 200);
  const h = await chamar(T, 'GET', `/api/equipamentos/${equip.id}/historico`);
  assert.equal(h.dados.filter(x => x.tipo === 'STATUS_ALTERADO' && x.payload.movimentacao_id === idRetorno).length, 1);
});
await caso('técnico encerra com categoria confirmada', async () => {
  const r = await chamar(T, 'POST', `/api/chamados/${chamado.id}/encerrar`, { categoria_falha_id: catTouch.id, causa_raiz: 'Tela danificada por impacto' });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
});

console.log('Custos');
let custo;
await caso('técnico não lança custo', async () => {
  assert.equal((await chamar(T, 'POST', '/api/custos', { equipamento_id: equip.id, tipo: 'PECA', valor: 10 })).status, 403);
});
await caso('compras lança custo real; aviso de garantia e desvio', async () => {
  const r = await chamar(C, 'POST', '/api/custos', { equipamento_id: equip.id, chamado_id: chamado.id, fornecedor_id: forn.id, tipo: 'PECA', valor: 1500 });
  assert.equal(r.status, 200, JSON.stringify(r.dados)); custo = r.dados; assert.match(r.dados.aviso, /supera o orçado/);
});
await caso('estorno gera lançamento negativo; segundo estorno é bloqueado', async () => {
  const r = await chamar(C, 'POST', `/api/custos/${custo.id}/estornar`, { motivo: 'Valor digitado errado' }); assert.equal(r.status, 200);
  assert.equal((await chamar(C, 'POST', `/api/custos/${custo.id}/estornar`, { motivo: 'De novo' })).status, 422);
  const lista = (await chamar(C, 'GET', `/api/custos?equipamento=${equip.id}`)).dados;
  assert.equal(lista.reduce((s, c) => s + Number(c.valor), 0), 0);
});
await caso('competência fechada não recebe lançamento', async () => {
  const fech = (await chamar(C, 'GET', '/api/fechamentos')).dados.find(f => f.fechado_em);
  const r = await chamar(C, 'POST', '/api/custos', { equipamento_id: equip.id, tipo: 'OUTROS', valor: 5, competencia: fech.competencia.slice(0, 7) });
  assert.equal(r.status, 422);
});

console.log('Baixa com segregação');
let baixa;
await caso('técnico solicita baixa; ele mesmo não aprova; gestor aprova', async () => {
  const outro = (await chamar(T, 'GET', `/api/equipamentos?loja=${L01.id}&status=ATIVO&limit=5`)).dados.find(e => e.id !== equip.id);
  const s = await chamar(T, 'POST', `/api/equipamentos/${outro.id}/baixa`, { tipo: 'BAIXA', motivo: 'Placa-mãe irrecuperável' });
  assert.equal(s.status, 200, JSON.stringify(s.dados)); baixa = s.dados;
  assert.equal((await chamar(T, 'POST', `/api/baixas/${baixa.id}/decidir`, { aprovar: true, justificativa: 'aprovado' })).status, 403);
  const r = await chamar(G, 'POST', `/api/baixas/${baixa.id}/decidir`, { aprovar: true, justificativa: 'Laudo confirma perda total' });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  assert.equal((await chamar(T, 'GET', `/api/equipamentos/${outro.id}`)).dados.status, 'BAIXADO');
  const c = await chamar(T, 'POST', '/api/chamados', { id: randomUUID(), equipamento_id: outro.id, relato: 'Teste baixado' });
  assert.equal(c.status, 422);
});

console.log('Sincronização offline');
await caso('fila offline: abre chamado e registra conflito de transição inválida', async () => {
  const eq = (await chamar(T, 'GET', `/api/equipamentos?loja=${L01.id}&status=ATIVO&limit=10`)).dados[3];
  const idCh = randomUUID(), idMov = randomUUID();
  const r = await chamar(T, 'POST', '/api/sync', { operacoes: [
    { id: idCh, tipo: 'ABRIR_CHAMADO', ocorrido_em: new Date(Date.now() - 3600e3).toISOString(), payload: { equipamento_id: eq.id, relato: 'Aberto sem internet' } },
    { id: idMov, tipo: 'MOVIMENTAR', ocorrido_em: new Date().toISOString(), payload: { equipamento_id: eq.id, status_novo: 'EM_MANUTENCAO', motivo: 'inválido' } },
    { id: idCh, tipo: 'ABRIR_CHAMADO', ocorrido_em: new Date(Date.now() - 3600e3).toISOString(), payload: { equipamento_id: eq.id, relato: 'Aberto sem internet' } },
  ] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.dados.resultados.map(x => x.ok), [true, false, true]);
  assert.equal(r.dados.resultados[2].resultado.duplicado, true);
  const conf = (await chamar(T, 'GET', '/api/sync/conflitos')).dados;
  assert.ok(conf.some(c => c.id === idMov));
});

console.log('Dashboard, relatórios e cadastros');
await caso('dashboard da rede traz ranking, tendência e reincidência por modelo', async () => {
  const r = await chamar(G, 'GET', '/api/dashboard?meses=12');
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  assert.equal(r.dados.tendencia.length, 12); assert.ok(r.dados.ranking.length >= 7);
  assert.equal(r.dados.modelos[0].modelo, 'BC-15');
  assert.ok(r.dados.alertas.some(a => a.tipo === 'Reincidência de modelo'));
});
await caso('dashboard do gerente mostra só a loja dele', async () => {
  const r = await chamar(GR, 'GET', '/api/dashboard'); assert.equal(r.dados.ranking.length, 1); assert.equal(r.dados.ranking[0].codigo, 'L01');
});
await caso('exportação CSV de equipamentos', async () => {
  const r = await fetch(API + '/api/equipamentos?format=csv', { headers: { authorization: 'Bearer ' + G } });
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /text\/csv/); assert.match(await r.text(), /numero_serie/);
});
await caso('admin cria fabricante vinculado a marca e altera parâmetro', async () => {
  const m = await chamar(A, 'POST', '/api/cadastros/marcas', { nome: 'Marca Teste ' + Date.now() }); assert.equal(m.status, 200);
  const f = await chamar(A, 'POST', '/api/cadastros/fabricantes', { razao_social: 'Fab Teste SA', marcas: [m.dados.id] }); assert.equal(f.status, 200, JSON.stringify(f.dados));
  assert.equal((await chamar(A, 'PUT', '/api/parametros/alerta_parado_dias', { valor: 15 })).status, 200);
  assert.equal((await chamar(G, 'PUT', '/api/parametros/alerta_parado_dias', { valor: 1 })).status, 403);
});
await caso('admin cria usuário com lojas e o novo usuário entra', async () => {
  const perfil = ref.perfis.find(p => p.codigo === 'GERENTE_LOJA');
  const login = 'ger' + Date.now();
  const r = await chamar(A, 'POST', '/api/usuarios', { nome: 'Gerente Teste', email: login + '@x.com', login, perfil_id: perfil.id, lojas: [L01.id], senha: 'senhaforte1' });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  const l = await chamar(null, 'POST', '/api/auth/login', { login, senha: 'senhaforte1' }); assert.equal(l.status, 200);
  const u2 = await chamar(A, 'PUT', `/api/usuarios/${r.dados.id}`, { nome: 'Gerente Teste', email: login + '@x.com', login, perfil_id: perfil.id, lojas: [], ativo: false });
  assert.equal(u2.status, 200, JSON.stringify(u2.dados));
  assert.equal((await chamar(null, 'POST', '/api/auth/login', { login, senha: 'senhaforte1' })).status, 401);
});
await caso('3 senhas erradas bloqueiam o login; admin desbloqueia', async () => {
  const perfil = ref.perfis.find(p => p.codigo === 'GERENTE_LOJA');
  const login = 'blq' + Date.now();
  const r = await chamar(A, 'POST', '/api/usuarios', { nome: 'Bloqueio Teste', email: login + '@x.com', login, perfil_id: perfil.id, lojas: [L01.id], senha: 'senhaforte1' });
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  const tentar = senha => chamar(null, 'POST', '/api/auth/login', { login, senha });
  assert.equal((await tentar('errada1')).status, 401);
  const segunda = await tentar('errada2');
  assert.equal(segunda.status, 401); assert.match(segunda.dados.erro, /mais um erro bloqueia/);
  assert.equal((await tentar('errada3')).status, 429);
  assert.equal((await tentar('senhaforte1')).status, 429, 'bloqueado: nem a senha certa entra');
  const lista = (await chamar(A, 'GET', '/api/usuarios')).dados;
  assert.ok(lista.find(u => u.id === r.dados.id).bloqueado_ate, 'lista mostra o bloqueio');
  assert.equal((await chamar(G, 'POST', `/api/usuarios/${r.dados.id}/desbloquear`)).status, 403);
  assert.equal((await chamar(A, 'POST', `/api/usuarios/${r.dados.id}/desbloquear`)).status, 200);
  assert.equal((await tentar('senhaforte1')).status, 200);
  // acerto zera a contagem: dois erros depois do acerto ainda não bloqueiam
  await tentar('x'); await tentar('y');
  assert.equal((await tentar('senhaforte1')).status, 200);
  await chamar(A, 'PUT', `/api/usuarios/${r.dados.id}`, { nome: 'Bloqueio Teste', email: login + '@x.com', login, perfil_id: perfil.id, lojas: [], ativo: false });
});

console.log('PDVs');
await caso('PDV: cadastro, periféricos vinculados, situação Parado automática e teste de comunicação', async () => {
  const disp = await chamar(T, 'GET', `/api/pdvs/equipamentos?loja=${L01.id}`);
  assert.equal(disp.status, 200, JSON.stringify(disp.dados));
  const ativos = disp.dados.filter(e => e.status === 'ATIVO');
  assert.ok(ativos.length >= 3, 'L01 precisa de 3 equipamentos ativos livres');
  const [imp, scan, outro] = ativos;
  // PDV 999 da L01 é reservado ao teste: criado na primeira execução e reaproveitado nas seguintes (não há exclusão)
  const numero = 999;
  const base = { loja_id: L01.id, numero, ip: '127.0.0.250', ativo: true, impressora_id: imp.id, scanner_id: scan.id };
  assert.equal((await chamar(GR, 'POST', '/api/pdvs', base)).status, 403, 'gerente de loja não cadastra PDV');
  const existente = (await chamar(T, 'GET', `/api/pdvs?loja=${L01.id}`)).dados.find(p => p.numero === numero);
  const r = existente ? await chamar(T, 'PUT', `/api/pdvs/${existente.id}`, base) : await chamar(T, 'POST', '/api/pdvs', base);
  assert.equal(r.status, 200, JSON.stringify(r.dados));
  const id = r.dados.id;
  try {
    assert.equal((await chamar(T, 'POST', '/api/pdvs', { ...base, impressora_id: null, scanner_id: null, ip: null })).status, 409, 'número repetido na loja');
    const dup = await chamar(T, 'POST', '/api/pdvs', { loja_id: L01.id, numero: 998, teclado_id: imp.id });
    assert.equal(dup.status, 422, 'mesmo equipamento em dois PDVs'); assert.match(dup.dados.erro, /já está vinculado ao PDV/);
    assert.ok(!(await chamar(T, 'GET', `/api/pdvs/equipamentos?loja=${L01.id}`)).dados.some(e => e.id === imp.id), 'vinculado some da lista de disponíveis');

    const buscar = async () => (await chamar(T, 'GET', `/api/pdvs?loja=${L01.id}`)).dados.find(p => p.id === id);
    let p = await buscar();
    assert.equal(p.situacao, 'ATIVO'); assert.equal(p.perifericos.impressora_id.id, imp.id);

    // periférico movimentado: PDV fica Parado; retorno: volta a Ativo
    const mov = async status_novo => { const m = await chamar(T, 'POST', `/api/equipamentos/${scan.id}/movimentar`, { id: randomUUID(), status_novo, motivo: 'teste PDV', teste_ok: status_novo === 'ATIVO' ? true : undefined, confirmou_receb: status_novo === 'ATIVO' }); assert.equal(m.status, 200, JSON.stringify(m.dados)); };
    await mov('EM_RESERVA');
    assert.equal((await buscar()).situacao, 'PARADO');
    await mov('ATIVO');
    assert.equal((await buscar()).situacao, 'ATIVO');

    const v = await chamar(T, 'POST', `/api/pdvs/${id}/verificar`);
    assert.equal(v.status, 200, JSON.stringify(v.dados)); assert.equal(v.dados.online, true, '127.0.0.1 responde');
    assert.ok(v.dados.ultima_resposta);

    const ger = await chamar(GR, 'GET', '/api/pdvs');
    assert.equal(ger.status, 200); assert.ok(ger.dados.every(x => x.loja_id === L01.id || ger.dados.length === 0), 'gerente vê só a loja dele');
    void outro;
  } finally {
    // libera os equipamentos e inativa o PDV de teste (a aplicação não apaga registros)
    await chamar(T, 'PUT', `/api/pdvs/${id}`, { loja_id: L01.id, numero, ip: null, ativo: false });
  }
  const fim = (await chamar(T, 'GET', `/api/pdvs?loja=${L01.id}`)).dados.find(p => p.id === id);
  assert.equal(fim.situacao, 'INATIVO');
});

console.log('Parâmetros e configurações');
await caso('configurações: permissão por grupo, token nunca devolvido, troca de endereço apaga o token', async () => {
  // sem grupo: não vê nem altera
  assert.equal((await chamar(T, 'GET', '/api/configuracoes')).status, 403);
  assert.equal((await chamar(T, 'PUT', '/api/configuracoes/ZABBIX', { valores: { zabbix_url: 'http://10.0.0.1' } })).status, 403);
  assert.equal((await chamar(T, 'PUT', '/api/parametros/reincidencia_equip_dias', { valor: 90 })).status, 403);

  const cfgAdm = await chamar(A, 'GET', '/api/configuracoes');
  assert.equal(cfgAdm.status, 200, JSON.stringify(cfgAdm.dados));
  assert.deepEqual(cfgAdm.dados.editaveis.sort(), ['MONITOR_PDV', 'REGRAS', 'SEGURANCA', 'ZABBIX']);
  assert.ok(cfgAdm.dados.servidor.some(s => s.rotulo === 'Banco de dados' && !/sisti123|password/i.test(s.valor)));
  const antes = Object.fromEntries(cfgAdm.dados.itens.map(i => [i.chave, i]));

  // administrador concede só o grupo ZABBIX ao coordenador
  const usuarios = (await chamar(A, 'GET', '/api/usuarios')).dados;
  const uc = usuarios.find(x => x.login === 'coordenador');
  const salvarCoord = grupos => chamar(A, 'PUT', '/api/usuarios/' + uc.id, { nome: uc.nome, email: uc.email, login: uc.login, perfil_id: uc.perfil_id,
    departamento_id: uc.departamento_id, alcada_max: uc.alcada_max, ativo: uc.ativo, telefone: uc.telefone, lojas: uc.lojas, parametro_grupos: grupos });
  assert.equal((await salvarCoord(['ZABBIX'])).status, 200);
  try {
    const me = (await chamar(CO, 'GET', '/api/auth/me')).dados;
    assert.deepEqual(me.parametro_grupos, ['ZABBIX']);
    assert.equal((await chamar(CO, 'PUT', '/api/parametros/reincidencia_equip_dias', { valor: 90 })).status, 403, 'grupo REGRAS não concedido');
    assert.equal((await chamar(CO, 'PUT', '/api/configuracoes/MONITOR_PDV', { valores: { pdv_monitor_segundos: '60' } })).status, 403);
    assert.equal((await chamar(CO, 'PUT', '/api/configuracoes/ZABBIX', { valores: { zabbix_url: 'ftp://zabbix' } })).status, 422);

    let r = await chamar(CO, 'PUT', '/api/configuracoes/ZABBIX', { valores: { zabbix_url: 'http://127.0.0.1:3999/zabbix/', zabbix_token: 'token-de-teste-0123456789' } });
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    let itens = (await chamar(CO, 'GET', '/api/configuracoes')).dados.itens;
    const tok = itens.find(i => i.chave === 'zabbix_token');
    assert.equal(itens.find(i => i.chave === 'zabbix_url').valor, 'http://127.0.0.1:3999/zabbix', 'barra final removida');
    assert.equal(tok.configurado, true); assert.equal(tok.valor, null);
    assert.ok(!JSON.stringify(itens).includes('token-de-teste'), 'token não volta para a tela');

    // outro endereço sem informar token: o token salvo é apagado
    r = await chamar(CO, 'PUT', '/api/configuracoes/ZABBIX', { valores: { zabbix_url: 'http://127.0.0.2/zabbix' } });
    assert.equal(r.dados.token_apagado, true);
    itens = (await chamar(CO, 'GET', '/api/configuracoes')).dados.itens;
    assert.equal(itens.find(i => i.chave === 'zabbix_token').configurado, false);
  } finally {
    await chamar(A, 'PUT', '/api/configuracoes/ZABBIX', { valores: { zabbix_url: antes.zabbix_url.valor, zabbix_token: null } });
    assert.equal((await salvarCoord([])).status, 200);
  }
  assert.equal((await chamar(CO, 'GET', '/api/configuracoes')).status, 403, 'sem grupo de novo');

  // monitor: validação do intervalo
  assert.equal((await chamar(A, 'PUT', '/api/configuracoes/MONITOR_PDV', { valores: { pdv_monitor_segundos: '5' } })).status, 422);
  assert.equal((await chamar(A, 'PUT', '/api/configuracoes/MONITOR_PDV', { valores: { pdv_porta_tcp: '70000' } })).status, 422);
  const r2 = await chamar(A, 'PUT', '/api/configuracoes/MONITOR_PDV', { valores: { pdv_monitor_segundos: antes.pdv_monitor_segundos.valor ?? '60' } });
  assert.equal(r2.status, 200, JSON.stringify(r2.dados));
});

console.log('Excluir cadastro (inativar)');
await caso('excluir cadastro: inativa, some da escolha, preserva quem já usa e reativa', async () => {
  const sufixo = Date.now().toString(36).toUpperCase();
  const g = await chamar(CO, 'POST', '/api/cadastros/grupos', { codigo: 'X' + sufixo.slice(-8), nome: 'Grupo teste ' + sufixo });
  assert.equal(g.status, 200, JSON.stringify(g.dados));
  const d = await chamar(CO, 'POST', '/api/cadastros/departamentos', { codigo: 'D' + sufixo.slice(-8), nome: 'Depto teste ' + sufixo, centro_custo: 'CC-T' });
  assert.equal(d.status, 200, JSON.stringify(d.dados));

  // modelo do grupo e equipamento no departamento, ainda ativos
  const marca = ref.marcas[0], fab = ref.marcaFabricante.find(m => m.marca_id === marca.id).fabricante_id;
  const prod = await chamar(CO, 'POST', '/api/cadastros/produtos', { descricao: 'Modelo teste', modelo: 'MT-' + sufixo, marca_id: marca.id, fabricante_id: fab, grupo_id: g.dados.id });
  assert.equal(prod.status, 200, JSON.stringify(prod.dados));
  const eq = await chamar(T, 'POST', '/api/equipamentos', { descricao: 'Equip teste exclusão', numero_serie: 'EXC-' + sufixo, produto_id: pdv.id,
    loja_id: L01.id, cor: 'Preto', departamento_id: d.dados.id, valor_aquisicao: 100, data_aquisicao: '2026-01-10' });
  assert.equal(eq.status, 200, JSON.stringify(eq.dados));

  // técnico não exclui; uso mostra o modelo, sem bloqueio
  assert.equal((await chamar(T, 'POST', `/api/cadastros/grupos/${g.dados.id}/inativar`)).status, 403);
  const uso = await chamar(CO, 'GET', `/api/cadastros/grupos/${g.dados.id}/uso`);
  assert.equal(uso.status, 200); assert.ok(uso.dados.some(x => x.rotulo.includes('modelo') && x.qtd === 1 && !x.bloqueia));

  assert.equal((await chamar(CO, 'POST', `/api/cadastros/grupos/${g.dados.id}/inativar`)).status, 200);
  assert.equal((await chamar(CO, 'POST', `/api/cadastros/departamentos/${d.dados.id}/inativar`)).status, 200);
  const lista = (await chamar(CO, 'GET', '/api/cadastros/grupos')).dados;
  assert.equal(lista.find(x => x.id === g.dados.id).ativo, false, 'continua existindo, inativo');
  assert.equal((await chamar(T, 'GET', '/api/ref')).dados.grupos.find(x => x.id === g.dados.id).ativo, false);

  // não pode ser escolhido de novo (banco recusa)
  const novo = await chamar(CO, 'POST', '/api/cadastros/produtos', { descricao: 'Outro', modelo: 'MT2-' + sufixo, marca_id: marca.id, fabricante_id: fab, grupo_id: g.dados.id });
  assert.equal(novo.status, 422); assert.match(novo.dados.erro, /foi excluído/);
  const eq2 = await chamar(T, 'POST', '/api/equipamentos', { descricao: 'Outro', numero_serie: 'EXC2-' + sufixo, produto_id: pdv.id,
    loja_id: L01.id, cor: 'Preto', departamento_id: d.dados.id, valor_aquisicao: 100, data_aquisicao: '2026-01-10' });
  assert.equal(eq2.status, 422, JSON.stringify(eq2.dados));

  // quem já usa continua funcionando: modelo e equipamento editáveis
  assert.equal((await chamar(CO, 'PUT', `/api/cadastros/produtos/${prod.dados.id}`, { descricao: 'Modelo teste editado' })).status, 200);
  assert.equal((await chamar(T, 'PUT', `/api/equipamentos/${eq.dados.id}`, { descricao: 'Equip teste exclusão (editado)' })).status, 200);

  // reativa e volta a aceitar; deixa os dados de teste excluídos no fim
  assert.equal((await chamar(CO, 'POST', `/api/cadastros/grupos/${g.dados.id}/reativar`)).status, 200);
  const de_novo = await chamar(CO, 'POST', '/api/cadastros/produtos', { descricao: 'Outro', modelo: 'MT3-' + sufixo, marca_id: marca.id, fabricante_id: fab, grupo_id: g.dados.id });
  assert.equal(de_novo.status, 200, JSON.stringify(de_novo.dados));
  for (const id of [prod.dados.id, de_novo.dados.id]) await chamar(CO, 'POST', `/api/cadastros/produtos/${id}/inativar`);
  assert.equal((await chamar(CO, 'POST', `/api/cadastros/grupos/${g.dados.id}/inativar`)).status, 200);
});
await caso('excluir loja com equipamentos é bloqueado', async () => {
  const r = await chamar(CO, 'POST', `/api/cadastros/lojas/${L01.id}/inativar`);
  assert.equal(r.status, 409, JSON.stringify(r.dados)); assert.match(r.dados.erro, /não pode ser excluído/);
  assert.ok((await chamar(CO, 'GET', '/api/cadastros/lojas')).dados.find(l => l.id === L01.id).ativo, 'loja continua ativa');
});

console.log(`\n${ok} ok, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
