// Cadastros base (genérico), usuários e parâmetros.
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api';
import { Campo, Carregando, Link, Modal, Opcoes, PERFIL, Tabela, cnpjFmt, dataHora, emUso, irPara, moeda, num, useAcao, useApp, useCarregar } from '../ui';
import { csvLocal, relatorioFicha, relatorioLista, type SecaoRel } from '../relatorio';

/** Minúsculas e sem acentos, para pesquisa ("Santarém" = "santarem"). */
const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

type Tipo ='texto' | 'numero' | 'bool' | 'lista' | 'multi' | 'ref' | 'refmulti';
interface Def {
  c: string; r: string; tipo?: Tipo; obr?: boolean; opcoes?: string[]; ref?: string; rotuloRef?: (x: any) => string; tabela?: boolean;
  secao?: string;                       // título de seção exibido antes do campo no formulário
  input?: 'email' | 'tel'; dica?: string; max?: number;
  rel?: boolean;                        // também entra no relatório em lista (PDF), além das colunas da tabela
  rt?: string;                          // rótulo completo para relatórios/CSV quando o nome se repete entre seções
  json?: string;                        // campo guardado dentro de uma coluna JSON (ex.: endereço da loja)
}

/** Chave do campo no formulário e leitura do valor (direto ou dentro da coluna JSON). */
const chave = (d: Def) => (d.json ? d.json + '.' + d.c : d.c);
const ler = (d: Def, l: any) => (d.json ? l?.[d.json]?.[d.c] : l?.[d.c]);

const ENT: Record<string, { titulo: string; perm: string; campos: Def[] }> = {
  lojas: { titulo: 'Unidades (lojas)', perm: 'cadastro.gerir', campos: [
    { c: 'codigo', r: 'Código', obr: true, tabela: true }, { c: 'nome_fantasia', r: 'Nome fantasia', obr: true, tabela: true }, { c: 'razao_social', r: 'Razão social', obr: true },
    { c: 'cnpj', r: 'CNPJ', obr: true, tabela: true }, { c: 'tipo', r: 'Tipo', tipo: 'lista', opcoes: ['SUPERMERCADO', 'HIPERMERCADO', 'ATACAREJO', 'CONVENIENCIA', 'CD', 'ESCRITORIO'], obr: true, tabela: true },
    { c: 'area_m2', r: 'Área (m²)', tipo: 'numero', tabela: true }, { c: 'qtd_checkouts', r: 'Checkouts', tipo: 'numero', tabela: true },
    { c: 'situacao', r: 'Situação', tipo: 'lista', opcoes: ['ATIVA', 'EM_IMPLANTACAO', 'FECHADA'], tabela: true }, { c: 'critica', r: 'Loja crítica', tipo: 'bool', tabela: true }, { c: 'erp_id', r: 'Código no ERP' },
    { c: 'nome_reduzido', r: 'Nome reduzido', json: 'endereco' }, { c: 'inscricao_estadual', r: 'Inscrição estadual', json: 'endereco' },
    { c: 'cep', r: 'CEP', dica: '00000-000', max: 9, json: 'endereco', secao: 'Endereço e contato' }, { c: 'logradouro', r: 'Logradouro', json: 'endereco', rel: true },
    { c: 'numero', r: 'Número', json: 'endereco' }, { c: 'complemento', r: 'Complemento', json: 'endereco' },
    { c: 'bairro', r: 'Bairro', json: 'endereco', tabela: true }, { c: 'cidade', r: 'Cidade', json: 'endereco', rel: true }, { c: 'uf', r: 'UF', dica: 'PR', max: 2, json: 'endereco' },
    { c: 'telefone', r: 'Telefone', input: 'tel', json: 'endereco', tabela: true },
  ] },
  departamentos: { titulo: 'Departamentos', perm: 'cadastro.gerir', campos: [
    { c: 'codigo', r: 'Código', obr: true, tabela: true }, { c: 'nome', r: 'Nome', obr: true, tabela: true }, { c: 'centro_custo', r: 'Centro de custo', obr: true, tabela: true },
  ] },
  grupos: { titulo: 'Grupos de produtos', perm: 'cadastro.gerir', campos: [
    { c: 'codigo', r: 'Código', obr: true, tabela: true }, { c: 'nome', r: 'Nome', obr: true, tabela: true }, { c: 'grupo_pai_id', r: 'Grupo pai', tipo: 'ref', ref: 'grupos', rotuloRef: x => x.nome },
    { c: 'vida_util_meses', r: 'Vida útil (meses)', tipo: 'numero', tabela: true }, { c: 'taxa_depreciacao', r: 'Depreciação (% a.a.)', tipo: 'numero', tabela: true },
  ] },
  marcas: { titulo: 'Marcas', perm: 'cadastro.gerir', campos: [{ c: 'nome', r: 'Nome comercial', obr: true, tabela: true }] },
  fabricantes: { titulo: 'Fabricantes', perm: 'cadastro.gerir', campos: [
    { c: 'razao_social', r: 'Razão social', obr: true, tabela: true }, { c: 'cnpj', r: 'CNPJ', tabela: true }, { c: 'marcas', r: 'Marcas que fabrica (vincular)', tipo: 'refmulti', ref: 'marcas', rotuloRef: x => x.nome },
  ] },
  produtos: { titulo: 'Produtos (modelos)', perm: 'cadastro.gerir', campos: [
    { c: 'modelo', r: 'Modelo', obr: true, tabela: true }, { c: 'descricao', r: 'Descrição', obr: true, tabela: true },
    { c: 'marca_id', r: 'Marca', tipo: 'ref', ref: 'marcas', rotuloRef: x => x.nome, obr: true, tabela: true },
    { c: 'fabricante_id', r: 'Fabricante', tipo: 'ref', ref: 'fabricantes', rotuloRef: x => x.razao_social, obr: true },
    { c: 'grupo_id', r: 'Grupo', tipo: 'ref', ref: 'grupos', rotuloRef: x => x.nome, obr: true, tabela: true },
    { c: 'sku_fabricante', r: 'SKU / ref. fabricante' }, { c: 'cor_padrao', r: 'Cor padrão' }, { c: 'garantia_meses', r: 'Garantia (meses)', tipo: 'numero', tabela: true },
    { c: 'vida_util_meses', r: 'Vida útil (meses)', tipo: 'numero' },
  ] },
  fornecedores: { titulo: 'Fornecedores', perm: 'fornecedor.gerir', campos: [
    { c: 'razao_social', r: 'Razão social', obr: true, tabela: true, secao: 'Identificação' }, { c: 'nome_fantasia', r: 'Nome fantasia', tabela: true },
    { c: 'cnpj', r: 'CNPJ', obr: true, tabela: true },
    { c: 'telefone', r: 'Telefone', input: 'tel', tabela: true }, { c: 'email', r: 'E-mail', input: 'email', rel: true },
    { c: 'tipos', r: 'Tipos', tipo: 'multi', opcoes: ['ASSISTENCIA', 'PECAS', 'FABRICANTE', 'TRANSPORTADORA'], obr: true, tabela: true },
    { c: 'cep', r: 'CEP', dica: '00000-000', max: 9, secao: 'Endereço' }, { c: 'logradouro', r: 'Logradouro' }, { c: 'numero', r: 'Número' },
    { c: 'complemento', r: 'Complemento' }, { c: 'bairro', r: 'Bairro' }, { c: 'cidade', r: 'Cidade', tabela: true }, { c: 'uf', r: 'UF', dica: 'PA', max: 2, tabela: true },
    { c: 'assistencia_nome', r: 'Nome', rt: 'Assistência – contato', rel: true, secao: 'Contato da assistência técnica' },
    { c: 'assistencia_telefone', r: 'Telefone', rt: 'Assistência – telefone', rel: true, input: 'tel' }, { c: 'assistencia_email', r: 'E-mail', rt: 'Assistência – e-mail', input: 'email' },
    { c: 'vendedor_nome', r: 'Nome', rt: 'Vendedor', rel: true, secao: 'Contato do vendedor' },
    { c: 'vendedor_telefone', r: 'Telefone', rt: 'Vendedor – telefone', rel: true, input: 'tel' }, { c: 'vendedor_email', r: 'E-mail', rt: 'Vendedor – e-mail', input: 'email' },
    { c: 'marcas_representadas', r: 'Marcas que representa', rt: 'Marcas', rel: true, tipo: 'refmulti', ref: 'marcas', rotuloRef: x => x.nome, secao: 'Marcas representadas' },
    { c: 'sla_orcamento_dias', r: 'SLA orçamento (dias)', tipo: 'numero', tabela: true, secao: 'Prazos e homologação' }, { c: 'sla_reparo_dias', r: 'SLA reparo (dias)', tipo: 'numero', tabela: true },
    { c: 'garantia_servico_dias', r: 'Garantia do serviço (dias)', tipo: 'numero' }, { c: 'homologado', r: 'Homologado', tipo: 'bool', tabela: true }, { c: 'suspenso_motivo', r: 'Motivo de suspensão' },
  ] },
  servicos: { titulo: 'Serviços', perm: 'cadastro.gerir', campos: [
    { c: 'tipo', r: 'Tipo', tipo: 'lista', opcoes: ['DIAGNOSTICO', 'REPARO', 'TROCA_PECA', 'INSTALACAO', 'PREVENTIVA', 'CALIBRACAO', 'DESCARTE'], obr: true, tabela: true },
    { c: 'descricao', r: 'Descrição', obr: true, tabela: true }, { c: 'unidade_cobranca', r: 'Cobrança', tipo: 'lista', opcoes: ['EVENTO', 'HORA'], obr: true, tabela: true },
    { c: 'valor_referencia', r: 'Valor de referência (R$)', tipo: 'numero', tabela: true }, { c: 'sla_dias', r: 'SLA (dias)', tipo: 'numero', tabela: true },
  ] },
  categorias: { titulo: 'Categorias de falha', perm: 'cadastro.gerir', campos: [
    { c: 'codigo', r: 'Código', obr: true, tabela: true }, { c: 'nome', r: 'Nome', obr: true, tabela: true }, { c: 'grupo_id', r: 'Grupo', tipo: 'ref', ref: 'grupos', rotuloRef: x => x.nome, tabela: true },
  ] },
};

/** Valor legível de um campo (resolve vínculos, listas e sim/não). */
function exibirValor(d: Def, l: any, ref: any) {
  const v = ler(d, l);
  if (d.tipo === 'bool') return v ? 'Sim' : 'Não';
  if (d.tipo === 'ref') { const x = (ref[d.ref!] || []).find((i: any) => i.id === v); return x ? d.rotuloRef!(x) : '—'; }
  if (d.tipo === 'multi') return (v || []).join(', ');
  if (d.tipo === 'refmulti') return (v || []).map((id: string) => (ref[d.ref!] || []).find((i: any) => i.id === id)).filter(Boolean).map(d.rotuloRef!).join(', ') || '—';
  if (d.c.includes('valor')) return moeda(v);
  if (d.c === 'cnpj' && v) return cnpjFmt(v);
  return v === '' || v == null ? '—' : v;
}

/** Registro com os vínculos que não vêm na própria linha (marcas do fabricante). */
function comVinculos(entidade: string, l: any, ref: any) {
  if (entidade !== 'fabricantes') return l;
  return { ...l, marcas: ref.marcaFabricante.filter((m: any) => m.fabricante_id === l.id).map((m: any) => m.marca_id) };
}

/** Rótulo completo do campo (com a seção quando o nome se repete, ex.: "Vendedor – telefone"). */
const rotuloCompleto = (d: Def) => d.rt || d.r;

export function Cadastros({ entidade }: { entidade: string }) {
  const { pode, ref, recarregarRef, usuario } = useApp();
  const def = ENT[entidade] || ENT.lojas;
  const r = useCarregar(() => api('GET', '/api/cadastros/' + entidade), [entidade]);
  const [editar, setEditar] = useState<any>(null);
  const exibir = (d: Def, l: any) => exibirValor(d, l, ref);
  // Pesquisa em todos os campos do registro (com nomes de marcas/vínculos resolvidos), sem diferenciar acentos e maiúsculas
  const [busca, setBusca] = useState('');
  const [verExcluidos, setVerExcluidos] = useState(false);
  const qtdExcluidos = (r.dados || []).filter((l: any) => !emUso(l)).length;
  const linhas = useMemo(() => {
    const termos = normalizar(busca).split(/\s+/).filter(Boolean);
    const base = (r.dados || []).filter((l: any) => verExcluidos || emUso(l));
    if (!termos.length || !r.dados) return r.dados && base;
    return base.filter((l: any) => {
      const reg = comVinculos(entidade, l, ref);
      const texto = normalizar(def.campos.filter(d => d.tipo !== 'bool').map(d => String(exibir(d, reg))).join(' '));
      return termos.every(t => texto.includes(t));
    });
  }, [busca, r.dados, def, ref, entidade, verExcluidos]); // eslint-disable-line react-hooks/exhaustive-deps

  // Relatórios da lista: respeitam a pesquisa aplicada
  const subtitulo = (busca ? `Pesquisa: "${busca}" · ` : '') + `${usuario.nome}`;
  const gerarPdf = () => relatorioLista(def.titulo, subtitulo,
    def.campos.filter(d => d.tabela || d.rel).map(d => ({ t: rotuloCompleto(d), v: (l: any) => exibir(d, comVinculos(entidade, l, ref)) })), linhas || []);
  const gerarCsv = () => csvLocal(`${entidade}-${new Date().toISOString().slice(0, 10)}`,
    def.campos.map(d => ({ t: rotuloCompleto(d), v: (l: any) => { const x = exibir(d, comVinculos(entidade, l, ref)); return x === '—' ? '' : x; } })), linhas || []);
  return (
    <>
      <div className="topo"><div><div className="migalha">Cadastros</div><h1>{def.titulo}</h1></div>
        {pode(def.perm) && <div className="acoes"><button className="btn primario" onClick={() => setEditar({})}>Novo</button></div>}</div>
      {/* Celular: lista de seleção no lugar das abas */}
      <select className="cad-entidade" aria-label="Cadastro" value={entidade} onChange={e => irPara('/cadastros/' + e.target.value)}>
        {Object.entries(ENT).map(([k, e]) => <option key={k} value={k}>{e.titulo}</option>)}
      </select>
      <div className="abas cad-abas" style={{ flexWrap: 'wrap' }}>
        {Object.entries(ENT).map(([k, e]) => <Link key={k} para={'/cadastros/' + k} className={'btn pequeno' + (k === entidade ? ' primario' : '')}>{e.titulo}</Link>)}
      </div>
      <div className="filtros">
        <input type="search" value={busca} onChange={e => setBusca(e.target.value)} aria-label="Pesquisar"
          placeholder={entidade === 'fornecedores' ? 'Pesquisar por nome, fantasia, CNPJ, cidade, marca, vendedor, contato…' : 'Pesquisar em todos os campos…'} />
        {busca && r.dados && <span className="muted small" style={{ alignSelf: 'center', minWidth: 0 }}>{linhas.length} encontrado(s)</span>}
        {qtdExcluidos > 0 && <label className="check" style={{ alignSelf: 'center' }}><input type="checkbox" checked={verExcluidos} onChange={e => setVerExcluidos(e.target.checked)} /> Mostrar excluídos ({qtdExcluidos})</label>}
        <span style={{ flex: 1, minWidth: 0 }} />
        <button className="btn" disabled={!linhas?.length} onClick={gerarPdf}>Relatório (PDF)</button>
        <button className="btn" disabled={!linhas?.length} onClick={gerarCsv}>Exportar CSV</button>
      </div>
      <div className="card">
        <Carregando {...r}>{() => <Tabela linhas={linhas} onClick={l => setEditar(l)}
          vazio={busca ? 'Nenhum registro encontrado para a pesquisa' : undefined}
          colunas={def.campos.filter(c => c.tabela).map((d, i) => ({ t: d.r, num: d.tipo === 'numero', movel: i < 2,
            c: (l: any) => i === 0 && !emUso(l) ? <span className="cad-excluido">{exibir(d, l)} <span className="pill p-cinza">excluído</span></span> : exibir(d, l) }))} />}</Carregando>
      </div>
      {editar && <FormCadastro entidade={entidade} titulo={def.titulo} def={def.campos} registro={editar} somenteLeitura={!pode(def.perm)}
        onFechar={() => setEditar(null)} onOk={() => { r.recarregar(); recarregarRef(); }} />}
    </>
  );
}

function FormCadastro({ entidade, titulo, def, registro, somenteLeitura, onFechar, onOk }: {
  entidade: string; titulo: string; def: Def[]; registro: any; somenteLeitura: boolean; onFechar: () => void; onOk: () => void;
}) {
  const { ref, avisar, usuario } = useApp();
  // Relatório do registro salvo (ficha completa, por seção)
  const gerarFicha = () => {
    const reg = comVinculos(entidade, registro, ref);
    const secoes: SecaoRel[] = [];
    for (const d of def) {
      if (d.secao || !secoes.length) secoes.push({ titulo: d.secao, itens: [] });
      const x = exibirValor(d, reg, ref);
      secoes[secoes.length - 1].itens.push({ rotulo: d.r, valor: x === '—' ? '' : x });
    }
    const nome = registro.nome_fantasia || registro.razao_social || registro.nome || registro.descricao || registro.modelo || registro.codigo || '';
    relatorioFicha(String(nome), `Ficha de ${titulo.toLowerCase()} · ${usuario.nome}`, secoes);
  };
  const marcasDoFabricante = entidade === 'fabricantes' && registro.id ? ref.marcaFabricante.filter((m: any) => m.fabricante_id === registro.id).map((m: any) => m.marca_id) : [];
  const [v, setV] = useState<any>(() => Object.fromEntries(def.map(d => [chave(d), entidade === 'fabricantes' && d.c === 'marcas' ? marcasDoFabricante : (d.c === 'cnpj' && ler(d, registro) ? cnpjFmt(ler(d, registro)) : ler(d, registro)) ?? (d.tipo === 'bool' ? (d.c === 'ativo' || d.c === 'ativo_catalogo') : d.tipo === 'multi' || d.tipo === 'refmulti' ? [] : '')])));
  const acao = useAcao();
  const set = (c: string, x: any) => setV((s: any) => ({ ...s, [c]: x }));
  const salvar = async () => {
    const corpo: any = {};
    for (const d of def) {
      const x = v[chave(d)];
      if (!d.json) { corpo[d.c] = x === '' ? null : x; continue; }
      // campos JSON: junta com o que já existe na coluna (preserva chaves que a tela não mostra)
      corpo[d.json] ??= { ...(registro[d.json] || {}) };
      const t = typeof x === 'string' ? x.trim() : x;
      if (t === '' || t == null) delete corpo[d.json][d.c]; else corpo[d.json][d.c] = t;
    }
    const ok = await acao.executar(() => registro.id ? api('PUT', `/api/cadastros/${entidade}/${registro.id}`, corpo) : api('POST', `/api/cadastros/${entidade}`, corpo));
    if (ok) { avisar('Registro salvo'); onOk(); onFechar(); }
  };
  // produto: só fabricantes vinculados à marca escolhida
  const opcoesRef = (d: Def) => {
    let lista = ref[d.ref!] || [];
    if (entidade === 'produtos' && d.c === 'fabricante_id' && v.marca_id) {
      const ids = ref.marcaFabricante.filter((m: any) => m.marca_id === v.marca_id).map((m: any) => m.fabricante_id);
      lista = lista.filter((f: any) => ids.includes(f.id));
    }
    if (d.c === 'grupo_pai_id') lista = lista.filter((g: any) => g.id !== registro.id);
    return lista;
  };
  const excluido = registro.id && !emUso(registro);
  const [confirmar, setConfirmar] = useState(false);
  const reativar = async () => {
    if (await acao.executar(() => api('POST', `/api/cadastros/${entidade}/${registro.id}/reativar`))) { avisar('Registro reativado'); onOk(); onFechar(); }
  };
  if (confirmar) return <ConfirmarExclusao entidade={entidade} registro={registro} onVoltar={() => setConfirmar(false)} onOk={() => { onOk(); onFechar(); }} />;
  return (
    <Modal largo titulo={somenteLeitura ? 'Consultar registro' : registro.id ? 'Editar registro' : 'Novo registro'} onFechar={onFechar} rodape={<>
      {registro.id && !somenteLeitura && !excluido && <button className="btn perigo" disabled={acao.enviando} onClick={() => setConfirmar(true)}>Excluir</button>}
      {registro.id && <button className="btn" style={{ marginRight: 'auto' }} onClick={gerarFicha}>Relatório</button>}
      <button className="btn" onClick={onFechar}>{somenteLeitura ? 'Fechar' : 'Cancelar'}</button>
      {!somenteLeitura && <button className="btn primario" disabled={acao.enviando} onClick={salvar}>Salvar</button>}</>}>
      {acao.erro && <div className="aviso erro" role="alert">{acao.erro}</div>}
      {excluido && (
        <div className="aviso atencao" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span>Registro <strong>excluído</strong>: não aparece nas listas nem pode ser escolhido. O histórico continua com ele.</span>
          {!somenteLeitura && <button className="btn" disabled={acao.enviando} onClick={reativar}>Reativar</button>}
        </div>
      )}
      <fieldset disabled={somenteLeitura} className="campos" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {def.map(d => { const k = chave(d); return (<Fragment key={k}>
          {d.secao && <h3 className="secao-form">{d.secao}</h3>}
          <Campo rotulo={d.r} obrigatorio={d.obr} largo={d.tipo === 'refmulti'}>
            {d.tipo === 'bool' ? <label className="check"><input type="checkbox" checked={!!v[k]} onChange={e => set(k, e.target.checked)} /> Sim</label>
              : d.tipo === 'lista' ? <Opcoes itens={d.opcoes!.map(o => ({ valor: o }))} valor={v[k]} onChange={x => set(k, x)} rotulo={o => o.valor.replace(/_/g, ' ').toLowerCase()} />
              : d.tipo === 'ref' ? <Opcoes itens={opcoesRef(d)} valor={v[k]} onChange={x => set(k, x)} rotulo={d.rotuloRef!} />
              : d.tipo === 'multi' || d.tipo === 'refmulti' ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {(d.tipo === 'multi' ? d.opcoes!.map(o => ({ id: o, nome: o })) : ref[d.ref!].filter((o: any) => emUso(o) || (v[k] || []).includes(o.id))).map((o: any) => (
                    <label key={o.id} className="check"><input type="checkbox" checked={(v[k] || []).includes(o.id)}
                      onChange={e => set(k, e.target.checked ? [...(v[k] || []), o.id] : (v[k] || []).filter((x: string) => x !== o.id))} /> {d.tipo === 'multi' ? o.nome.toLowerCase() : d.rotuloRef!(o)}</label>
                  ))}
                </div>)
              : <input type={d.tipo === 'numero' ? 'number' : d.input || 'text'} step="any" value={v[k] ?? ''} placeholder={d.dica} maxLength={d.max}
                  onChange={e => set(k, d.c === 'uf' ? e.target.value.toUpperCase() : e.target.value)} />}
          </Campo>
        </Fragment>); })}
      </fieldset>
      {entidade === 'fabricantes' && <p className="muted small">Vínculos de marca só são adicionados (não removidos), para preservar modelos já cadastrados.</p>}
    </Modal>
  );
}

/** Confirmação de "Excluir": mostra onde o registro é usado; exclusão = inativação (histórico preservado). */
function ConfirmarExclusao({ entidade, registro, onVoltar, onOk }: { entidade: string; registro: any; onVoltar: () => void; onOk: () => void }) {
  const { avisar } = useApp();
  const uso = useCarregar(() => api('GET', `/api/cadastros/${entidade}/${registro.id}/uso`), [entidade, registro.id]);
  const acao = useAcao();
  const nome = registro.nome_fantasia || registro.razao_social || registro.nome || registro.modelo || registro.descricao || registro.codigo;
  const bloqueios = (uso.dados || []).filter((x: any) => x.bloqueia);
  const excluir = async () => {
    if (await acao.executar(() => api('POST', `/api/cadastros/${entidade}/${registro.id}/inativar`))) { avisar(`"${nome}" excluído`); onOk(); }
  };
  return (
    <Modal titulo={`Excluir "${nome}"?`} onFechar={onVoltar} rodape={<>
      <button className="btn" onClick={onVoltar}>Voltar</button>
      <button className="btn primario perigo-forte" disabled={acao.enviando || uso.carregando || bloqueios.length > 0} onClick={excluir}>Excluir</button></>}>
      {acao.erro && <div className="aviso erro" role="alert">{acao.erro}</div>}
      <p style={{ marginTop: 0 }}>O registro <strong>não é apagado</strong>: fica inativo, some das listas e não pode mais ser escolhido em cadastros
        novos. Equipamentos, chamados, custos, movimentações e relatórios que já usam o registro continuam iguais.
        Dá para reativar depois, em "Mostrar excluídos".</p>
      <Carregando {...uso}>{() => !uso.dados.length ? <div className="aviso ok">Nenhum uso em andamento encontrado.</div> : <>
        {bloqueios.length > 0 && <div className="aviso erro" role="alert">Não é possível excluir enquanto houver os itens marcados abaixo. Resolva-os primeiro (por exemplo, transfira ou baixe os equipamentos).</div>}
        <ul className="cad-uso">{uso.dados.map((x: any) => (
          <li key={x.rotulo} className={x.bloqueia ? 'bloqueia' : ''}><strong>{x.qtd}</strong> {x.rotulo}{x.bloqueia && <span className="pill p-vermelho">impede</span>}</li>
        ))}</ul>
      </>}</Carregando>
    </Modal>
  );
}

// ---------------- Usuários ----------------
export function Usuarios() {
  const { ref } = useApp();
  const r = useCarregar(() => api('GET', '/api/usuarios'), []);
  const [editar, setEditar] = useState<any>(null);
  return (
    <>
      <div className="topo"><div><div className="migalha">Cadastros</div><h1>Usuários</h1></div><div className="acoes"><button className="btn primario" onClick={() => setEditar({})}>Novo usuário</button></div></div>
      <div className="card"><Carregando {...r}>{() => <Tabela linhas={r.dados} onClick={setEditar} colunas={[
        { t: 'Nome', c: u => <><strong>{u.nome}</strong><div className="muted small">{u.email}</div></> }, { t: 'Login', c: u => <span className="mono">{u.login}</span> },
        { t: 'Perfil', c: u => PERFIL[u.perfil] || u.perfil }, { t: 'Alçada', num: true, c: u => Number(u.alcada_max) ? moeda(u.alcada_max, true) : '—' },
        { t: 'Lojas', c: u => u.lojas.length ? u.lojas.map((id: string) => ref.lojas.find((l: any) => l.id === id)?.codigo || '?').join(', ') : <span className="muted">rede (pelo perfil)</span>, movel: false },
        { t: 'Último acesso', c: u => dataHora(u.ultimo_acesso), movel: false }, { t: 'Situação', c: u => !u.ativo ? <span className="pill p-cinza">inativo</span> : u.bloqueado_ate ? <span className="pill p-vermelho">bloqueado</span> : <span className="pill p-verde">ativo</span> },
      ]} />}</Carregando></div>
      {editar && <FormUsuario u={editar} onFechar={() => setEditar(null)} onOk={r.recarregar} />}
    </>
  );
}

function FormUsuario({ u, onFechar, onOk }: any) {
  const { ref, avisar } = useApp();
  const [v, setV] = useState<any>({ nome: u.nome || '', email: u.email || '', login: u.login || '', perfil_id: u.perfil_id || '', departamento_id: u.departamento_id || '', alcada_max: u.alcada_max ?? 0, ativo: u.ativo ?? true, telefone: u.telefone || '', lojas: u.lojas || [], parametro_grupos: u.parametro_grupos || [], senha: '' });
  const ehAdmin = ref.perfis.find((p: any) => p.id === v.perfil_id)?.codigo === 'ADMIN';
  const acao = useAcao();
  const set = (c: string) => (e: any) => setV((s: any) => ({ ...s, [c]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const salvar = async () => {
    const corpo = { ...v, departamento_id: v.departamento_id || null, telefone: v.telefone || null, senha: v.senha || undefined };
    if (await acao.executar(() => u.id ? api('PUT', '/api/usuarios/' + u.id, corpo) : api('POST', '/api/usuarios', corpo))) { avisar('Usuário salvo'); onOk(); onFechar(); }
  };
  const desbloquear = async () => {
    if (await acao.executar(() => api('POST', '/api/usuarios/' + u.id + '/desbloquear'))) { avisar('Login desbloqueado'); onOk(); onFechar(); }
  };
  return (
    <Modal largo titulo={u.id ? 'Editar usuário' : 'Novo usuário'} onFechar={onFechar} rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn primario" disabled={acao.enviando} onClick={salvar}>Salvar</button></>}>
      {acao.erro && <div className="aviso erro" role="alert">{acao.erro}</div>}
      {u.bloqueado_ate && (
        <div className="aviso atencao" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span>Login bloqueado por senhas erradas até {dataHora(u.bloqueado_ate)}. Definir uma nova senha também desbloqueia.</span>
          <button className="btn" disabled={acao.enviando} onClick={desbloquear}>Desbloquear agora</button>
        </div>
      )}
      <div className="campos">
        <Campo rotulo="Nome completo" obrigatorio><input value={v.nome} onChange={set('nome')} /></Campo>
        <Campo rotulo="E-mail corporativo" obrigatorio><input type="email" value={v.email} onChange={set('email')} /></Campo>
        <Campo rotulo="Login" obrigatorio><input value={v.login} onChange={set('login')} /></Campo>
        <Campo rotulo="Telefone"><input value={v.telefone} onChange={set('telefone')} /></Campo>
        <Campo rotulo="Perfil" obrigatorio><Opcoes itens={ref.perfis} valor={v.perfil_id} onChange={x => setV({ ...v, perfil_id: x })} rotulo={p => p.nome} /></Campo>
        <Campo rotulo="Departamento"><Opcoes itens={ref.departamentos} valor={v.departamento_id} onChange={x => setV({ ...v, departamento_id: x })} rotulo={d => d.nome} /></Campo>
        <Campo rotulo="Alçada de aprovação (R$)"><input type="number" min="0" step="100" value={v.alcada_max} onChange={set('alcada_max')} /></Campo>
        <Campo rotulo={u.id ? 'Nova senha (deixe vazio para manter)' : 'Senha inicial'} obrigatorio={!u.id}><input type="password" value={v.senha} onChange={set('senha')} autoComplete="new-password" /></Campo>
        <Campo rotulo="Situação"><label className="check"><input type="checkbox" checked={v.ativo} onChange={set('ativo')} /> Ativo (inativo mantém histórico e não acessa)</label></Campo>
        <Campo rotulo="Lojas de acesso (perfis de loja e técnicos)" largo>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>{ref.lojas.filter((l: any) => emUso(l) || v.lojas.includes(l.id)).map((l: any) => (
            <label key={l.id} className="check"><input type="checkbox" checked={v.lojas.includes(l.id)} onChange={e => setV({ ...v, lojas: e.target.checked ? [...v.lojas, l.id] : v.lojas.filter((x: string) => x !== l.id) })} /> {l.codigo}{emUso(l) ? '' : ' (excluída)'}</label>
          ))}</div>
        </Campo>
        <Campo rotulo="Pode alterar parâmetros (tela Parâmetros)" largo>
          {ehAdmin ? <span className="muted small">O administrador altera todos os grupos.</span> : <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>{Object.entries(GRUPOS_PARAMETRO).map(([g, def]) => (
              <label key={g} className="check"><input type="checkbox" checked={v.parametro_grupos.includes(g)} onChange={e => setV({ ...v, parametro_grupos: e.target.checked ? [...v.parametro_grupos, g] : v.parametro_grupos.filter((x: string) => x !== g) })} /> {def.titulo}</label>
            ))}</div>
            <span className="muted small">Quem tem algum grupo marcado também vê os endereços das integrações e os dados do servidor.</span>
          </>}
        </Campo>
      </div>
    </Modal>
  );
}

// ---------------- Parâmetros ----------------
/** Grupos de parâmetros (a permissão de alteração é dada por grupo, no cadastro do usuário). */
export const GRUPOS_PARAMETRO: Record<string, { titulo: string; texto: string }> = {
  REGRAS: { titulo: 'Regras de manutenção', texto: 'Janelas de reincidência, percentuais de alerta e regras de cotação.' },
  SEGURANCA: { titulo: 'Login e segurança', texto: 'Bloqueio do login depois de senhas erradas seguidas.' },
  MONITOR_PDV: { titulo: 'Monitor de PDVs', texto: 'Teste de comunicação que o servidor faz em cada PDV ativo (tela PDVs).' },
  ZABBIX: { titulo: 'Zabbix', texto: 'Disponibilidade e alertas ativos de cada PDV, procurado no Zabbix pelo IP.' },
};

function CabecalhoGrupo({ grupo, editavel }: { grupo: string; editavel: boolean }) {
  const g = GRUPOS_PARAMETRO[grupo];
  return (
    <div className="param-cab">
      <div><h2>{g.titulo}</h2><p className="muted small">{g.texto}</p></div>
      <span className={'pill ' + (editavel ? 'p-verde' : 'p-cinza')}>{editavel ? 'você pode alterar' : 'somente leitura'}</span>
    </div>
  );
}

function GrupoNumerico({ grupo, editavel }: { grupo: string; editavel: boolean }) {
  const { ref, recarregarRef, avisar } = useApp();
  const itens = ref.parametros.filter((p: any) => (p.grupo || 'REGRAS') === grupo);
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(itens.map((p: any) => [p.chave, String(p.valor)])));
  const acao = useAcao();
  const salvar = async (chave: string) => {
    if (await acao.executar(() => api('PUT', '/api/parametros/' + chave, { valor: valores[chave] }))) { avisar('Parâmetro atualizado'); recarregarRef(); }
  };
  if (!itens.length) return null;
  return (
    <section className="card param-grupo">
      <CabecalhoGrupo grupo={grupo} editavel={editavel} />
      {acao.erro && <div className="aviso erro" role="alert">{acao.erro}</div>}
      <Tabela linhas={itens} chave="chave" colunas={[
        { t: 'Parâmetro', c: p => <><strong>{p.descricao}</strong><div className="muted small mono">{p.chave}</div></> },
        { t: 'Valor', c: p => editavel ? <input type="number" step="any" min="0" aria-label={p.descricao} style={{ width: 120 }} value={valores[p.chave]} onChange={e => setValores({ ...valores, [p.chave]: e.target.value })} /> : num(p.valor, Number(p.valor) % 1 ? 2 : 0) },
        { t: '', c: p => editavel && String(p.valor) !== valores[p.chave] ? <button className="btn pequeno primario" disabled={acao.enviando} onClick={() => salvar(p.chave)}>Salvar</button> : null },
      ]} />
    </section>
  );
}

/** Grupo de configurações de texto (endereços, portas, token), gravado de uma vez. */
function GrupoConfiguracao({ grupo, itens, editavel, extra, onSalvo }: { grupo: string; itens: any[]; editavel: boolean; extra?: ReactNode; onSalvo: () => void }) {
  const { avisar } = useApp();
  const inicial = () => Object.fromEntries(itens.map(i => [i.chave, i.tipo === 'SEGREDO' ? '' : (i.valor ?? '')]));
  const [v, setV] = useState<Record<string, string>>(inicial);
  const acao = useAcao();
  const alterados = itens.filter(i => i.tipo === 'SEGREDO' ? v[i.chave] !== '' : v[i.chave] !== (i.valor ?? ''));
  const salvar = async (valores: Record<string, string | null>) => {
    const r = await acao.executar(() => api('PUT', '/api/configuracoes/' + grupo, { valores }));
    if (!r) return;
    avisar(r.token_apagado ? 'Endereço alterado. O token anterior foi apagado: informe o token deste Zabbix.' : 'Configuração salva', r.token_apagado ? 'info' : 'ok');
    onSalvo();
  };
  const ultima = itens.filter(i => i.atualizado_em).sort((a, b) => String(b.atualizado_em).localeCompare(String(a.atualizado_em)))[0];
  return (
    <section className="card param-grupo">
      <CabecalhoGrupo grupo={grupo} editavel={editavel} />
      {acao.erro && <div className="aviso erro" role="alert">{acao.erro}</div>}
      {extra}
      <fieldset disabled={!editavel || acao.enviando} className="campos" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {itens.map(i => (
          <Campo key={i.chave} rotulo={i.rotulo} largo={i.tipo === 'URL'}>
            {i.tipo === 'SEGREDO' ? <>
              <input type="password" autoComplete="new-password" value={v[i.chave]} onChange={e => setV({ ...v, [i.chave]: e.target.value })}
                     placeholder={i.configurado ? '•••••••• configurado (deixe vazio para manter)' : 'não configurado'} />
              <span className="muted small">{i.descricao}</span>
            </> : <>
              <input type={i.tipo === 'NUMERO' ? 'number' : i.tipo === 'URL' ? 'url' : 'text'} min={i.tipo === 'NUMERO' ? 0 : undefined}
                     inputMode={i.tipo === 'NUMERO' ? 'numeric' : undefined} value={v[i.chave]} onChange={e => setV({ ...v, [i.chave]: e.target.value })}
                     placeholder={i.tipo === 'URL' ? 'http://' : ''} />
              <span className="muted small">{i.descricao}</span>
            </>}
          </Campo>
        ))}
      </fieldset>
      <div className="param-rodape">
        <span className="muted small">{ultima ? <>Alterado {ultima.atualizado_por ? <>por <strong>{ultima.atualizado_por}</strong> </> : 'pela importação do .env '}em {dataHora(ultima.atualizado_em)}</> : 'Valores padrão (nunca alterados)'}</span>
        {editavel && <div className="param-botoes">
          {itens.some(i => i.tipo === 'SEGREDO' && i.configurado) && (
            <button className="btn" disabled={acao.enviando} onClick={() => { if (confirm('Remover o token salvo? A integração para até um novo token ser informado.')) salvar(Object.fromEntries(itens.filter(i => i.tipo === 'SEGREDO').map(i => [i.chave, null]))); }}>Remover token</button>)}
          {alterados.length > 0 && <button className="btn" disabled={acao.enviando} onClick={() => setV(inicial())}>Desfazer</button>}
          <button className="btn primario" disabled={!alterados.length || acao.enviando} onClick={() => salvar(Object.fromEntries(alterados.map(i => [i.chave, v[i.chave]])))}>Salvar</button>
        </div>}
      </div>
    </section>
  );
}

function StatusMonitor({ m, intervalo }: { m: any; intervalo: string | null }) {
  if (intervalo === '0') return <div className="aviso atencao">Monitor desligado: os PDVs não são testados. Informe um intervalo para religar.</div>;
  if (m.erroCiclo) return <div className="aviso erro" role="alert">Último ciclo com erro: {m.erroCiclo}</div>;
  if (!m.ultimoCiclo) return <div className="aviso info">Aguardando o primeiro ciclo do monitor.</div>;
  return <div className="aviso ok">Último ciclo em {dataHora(m.ultimoCiclo)}: {m.pdvsTestados} PDV(s) com IP testado(s).</div>;
}

function StatusZabbix({ m, itens, editavel }: { m: any; itens: any[]; editavel: boolean }) {
  const acao = useAcao();
  const [teste, setTeste] = useState<any>(null);
  const url = itens.find(i => i.chave === 'zabbix_url')?.valor, token = itens.find(i => i.chave === 'zabbix_token')?.configurado;
  const testar = async () => { setTeste(null); const r = await acao.executar(() => api('POST', '/api/configuracoes/ZABBIX/testar')); if (r) setTeste(r); };
  return <>
    {!url ? <div className="aviso info">Integração desligada (sem endereço).</div>
      : !token ? <div className="aviso atencao">Falta o token de API: sem ele o SisTI não consulta o Zabbix.</div>
      : m.erroZabbix ? <div className="aviso erro" role="alert">Última consulta com erro: {m.erroZabbix}</div>
      : m.zabbixOk ? <div className="aviso ok">Última consulta ao Zabbix em {dataHora(m.zabbixOk)}.</div>
      : <div className="aviso info">Aguardando a primeira consulta ao Zabbix.</div>}
    {editavel && url && <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
      <button className="btn pequeno" disabled={acao.enviando} onClick={testar}>{acao.enviando ? 'Testando…' : 'Testar conexão'}</button>
      {acao.erro && <span className="txt-vermelho small">{acao.erro}</span>}
      {teste && <span className={'small ' + (teste.ok ? 'txt-verde' : 'txt-vermelho')} role="status">{teste.mensagem}</span>}
    </div>}
  </>;
}

export function Parametros() {
  const { usuario } = useApp();
  const grupos: string[] = usuario.parametro_grupos ?? [];
  const pode = (g: string) => grupos.includes(g);
  const veConfig = grupos.length > 0;
  const cfg = useCarregar(() => veConfig ? api('GET', '/api/configuracoes') : Promise.resolve(null), [veConfig]);
  const itensDe = (g: string) => (cfg.dados?.itens ?? []).filter((i: any) => i.grupo === g);
  return (
    <>
      <div className="topo"><div><div className="migalha">Cadastros</div><h1>Parâmetros</h1></div></div>
      <p className="muted small" style={{ marginTop: -6, marginBottom: 14 }}>
        Toda alteração fica registrada no histórico de auditoria. {usuario.perfil === 'ADMIN'
          ? 'Para que outro usuário altere um grupo, marque o grupo no cadastro dele (Usuários).'
          : grupos.length ? '' : 'Seu usuário não altera parâmetros; peça ao administrador se precisar.'}
      </p>
      <div className="param-lista">
        <GrupoNumerico grupo="REGRAS" editavel={pode('REGRAS')} />
        <GrupoNumerico grupo="SEGURANCA" editavel={pode('SEGURANCA')} />
        {veConfig && <Carregando {...cfg}>{() => <>
          <GrupoConfiguracao key={'m' + cfg.dados.itens.map((i: any) => i.atualizado_em).join()} grupo="MONITOR_PDV" itens={itensDe('MONITOR_PDV')} editavel={pode('MONITOR_PDV')} onSalvo={cfg.recarregar}
            extra={<StatusMonitor m={cfg.dados.monitor} intervalo={itensDe('MONITOR_PDV').find((i: any) => i.chave === 'pdv_monitor_segundos')?.valor ?? null} />} />
          <GrupoConfiguracao key={'z' + cfg.dados.itens.map((i: any) => i.atualizado_em).join()} grupo="ZABBIX" itens={itensDe('ZABBIX')} editavel={pode('ZABBIX')} onSalvo={cfg.recarregar}
            extra={<StatusZabbix m={cfg.dados.monitor} itens={itensDe('ZABBIX')} editavel={pode('ZABBIX')} />} />
          <section className="card param-grupo">
            <div className="param-cab">
              <div><h2>Servidor</h2><p className="muted small">Definidos na instalação, no arquivo <span className="mono">/opt/sisti/.env.producao</span>. Por segurança não são alterados pela tela: edite o arquivo no servidor e rode <span className="mono">sisti iniciar</span>.</p></div>
              <span className="pill p-cinza">somente leitura</span>
            </div>
            <dl className="param-servidor">
              {cfg.dados.servidor.map((s: any) => (
                <div key={s.rotulo}><dt>{s.rotulo}</dt><dd>{s.valor ? (s.tipo === 'DATA' ? dataHora(s.valor) : s.valor) : <span className="muted">não informado</span>}
                  {s.origem && <div className="muted small mono">{s.origem}</div>}</dd></div>
              ))}
            </dl>
          </section>
        </>}</Carregando>}
      </div>
    </>
  );
}
