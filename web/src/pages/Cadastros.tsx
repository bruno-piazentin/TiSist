// Cadastros base (genérico), usuários e parâmetros.
import { Fragment, useMemo, useState } from 'react';
import { api } from '../api';
import { Campo, Carregando, Link, Modal, Opcoes, PERFIL, Tabela, dataHora, moeda, num, useAcao, useApp, useCarregar } from '../ui';
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
}

const ENT: Record<string, { titulo: string; perm: string; campos: Def[] }> = {
  lojas: { titulo: 'Unidades (lojas)', perm: 'cadastro.gerir', campos: [
    { c: 'codigo', r: 'Código', obr: true, tabela: true }, { c: 'nome_fantasia', r: 'Nome fantasia', obr: true, tabela: true }, { c: 'razao_social', r: 'Razão social', obr: true },
    { c: 'cnpj', r: 'CNPJ', obr: true, tabela: true }, { c: 'tipo', r: 'Tipo', tipo: 'lista', opcoes: ['SUPERMERCADO', 'HIPERMERCADO', 'ATACAREJO', 'CONVENIENCIA', 'CD', 'ESCRITORIO'], obr: true, tabela: true },
    { c: 'area_m2', r: 'Área (m²)', tipo: 'numero', tabela: true }, { c: 'qtd_checkouts', r: 'Checkouts', tipo: 'numero', tabela: true },
    { c: 'situacao', r: 'Situação', tipo: 'lista', opcoes: ['ATIVA', 'EM_IMPLANTACAO', 'FECHADA'], tabela: true }, { c: 'critica', r: 'Loja crítica', tipo: 'bool', tabela: true }, { c: 'erp_id', r: 'Código no ERP' },
  ] },
  departamentos: { titulo: 'Departamentos', perm: 'cadastro.gerir', campos: [
    { c: 'codigo', r: 'Código', obr: true, tabela: true }, { c: 'nome', r: 'Nome', obr: true, tabela: true }, { c: 'centro_custo', r: 'Centro de custo', obr: true, tabela: true }, { c: 'ativo', r: 'Ativo', tipo: 'bool', tabela: true },
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
    { c: 'vida_util_meses', r: 'Vida útil (meses)', tipo: 'numero' }, { c: 'ativo_catalogo', r: 'Ativo no catálogo', tipo: 'bool', tabela: true },
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
  const v = l[d.c];
  if (d.tipo === 'bool') return v ? 'Sim' : 'Não';
  if (d.tipo === 'ref') { const x = (ref[d.ref!] || []).find((i: any) => i.id === v); return x ? d.rotuloRef!(x) : '—'; }
  if (d.tipo === 'multi') return (v || []).join(', ');
  if (d.tipo === 'refmulti') return (v || []).map((id: string) => (ref[d.ref!] || []).find((i: any) => i.id === id)).filter(Boolean).map(d.rotuloRef!).join(', ') || '—';
  if (d.c.includes('valor')) return moeda(v);
  return v ?? '—';
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
  const linhas = useMemo(() => {
    const termos = normalizar(busca).split(/\s+/).filter(Boolean);
    if (!termos.length || !r.dados) return r.dados;
    return r.dados.filter((l: any) => {
      const reg = comVinculos(entidade, l, ref);
      const texto = normalizar(def.campos.filter(d => d.tipo !== 'bool').map(d => String(exibir(d, reg))).join(' '));
      return termos.every(t => texto.includes(t));
    });
  }, [busca, r.dados, def, ref, entidade]); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div className="abas" style={{ flexWrap: 'wrap' }}>
        {Object.entries(ENT).map(([k, e]) => <Link key={k} para={'/cadastros/' + k} className={'btn pequeno' + (k === entidade ? ' primario' : '')}>{e.titulo}</Link>)}
      </div>
      <div className="filtros">
        <input type="search" value={busca} onChange={e => setBusca(e.target.value)} aria-label="Pesquisar"
          placeholder={entidade === 'fornecedores' ? 'Pesquisar por nome, fantasia, CNPJ, cidade, marca, vendedor, contato…' : 'Pesquisar em todos os campos…'} />
        {busca && r.dados && <span className="muted small" style={{ alignSelf: 'center', minWidth: 0 }}>{linhas.length} de {r.dados.length}</span>}
        <span style={{ flex: 1, minWidth: 0 }} />
        <button className="btn" disabled={!linhas?.length} onClick={gerarPdf}>Relatório (PDF)</button>
        <button className="btn" disabled={!linhas?.length} onClick={gerarCsv}>Exportar CSV</button>
      </div>
      <div className="card">
        <Carregando {...r}>{() => <Tabela linhas={linhas} onClick={l => setEditar(l)}
          vazio={busca ? 'Nenhum registro encontrado para a pesquisa' : undefined}
          colunas={def.campos.filter(c => c.tabela).map(d => ({ t: d.r, c: (l: any) => exibir(d, l), num: d.tipo === 'numero' }))} />}</Carregando>
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
  const [v, setV] = useState<any>(() => Object.fromEntries(def.map(d => [d.c, entidade === 'fabricantes' && d.c === 'marcas' ? marcasDoFabricante : registro[d.c] ?? (d.tipo === 'bool' ? (d.c === 'ativo' || d.c === 'ativo_catalogo') : d.tipo === 'multi' || d.tipo === 'refmulti' ? [] : '')])));
  const acao = useAcao();
  const set = (c: string, x: any) => setV((s: any) => ({ ...s, [c]: x }));
  const salvar = async () => {
    const corpo = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x === '' ? null : x]));
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
  return (
    <Modal largo titulo={somenteLeitura ? 'Consultar registro' : registro.id ? 'Editar registro' : 'Novo registro'} onFechar={onFechar} rodape={<>
      {registro.id && <button className="btn" style={{ marginRight: 'auto' }} onClick={gerarFicha}>Relatório</button>}
      <button className="btn" onClick={onFechar}>{somenteLeitura ? 'Fechar' : 'Cancelar'}</button>
      {!somenteLeitura && <button className="btn primario" disabled={acao.enviando} onClick={salvar}>Salvar</button>}</>}>
      {acao.erro && <div className="aviso erro">{acao.erro}</div>}
      <fieldset disabled={somenteLeitura} className="campos" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {def.map(d => (<Fragment key={d.c}>
          {d.secao && <h3 className="secao-form">{d.secao}</h3>}
          <Campo rotulo={d.r} obrigatorio={d.obr} largo={d.tipo === 'refmulti'}>
            {d.tipo === 'bool' ? <label className="check"><input type="checkbox" checked={!!v[d.c]} onChange={e => set(d.c, e.target.checked)} /> Sim</label>
              : d.tipo === 'lista' ? <Opcoes itens={d.opcoes!.map(o => ({ valor: o }))} valor={v[d.c]} onChange={x => set(d.c, x)} rotulo={o => o.valor.replace(/_/g, ' ').toLowerCase()} />
              : d.tipo === 'ref' ? <Opcoes itens={opcoesRef(d)} valor={v[d.c]} onChange={x => set(d.c, x)} rotulo={d.rotuloRef!} />
              : d.tipo === 'multi' || d.tipo === 'refmulti' ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {(d.tipo === 'multi' ? d.opcoes!.map(o => ({ id: o, nome: o })) : ref[d.ref!]).map((o: any) => (
                    <label key={o.id} className="check"><input type="checkbox" checked={(v[d.c] || []).includes(o.id)}
                      onChange={e => set(d.c, e.target.checked ? [...(v[d.c] || []), o.id] : (v[d.c] || []).filter((x: string) => x !== o.id))} /> {d.tipo === 'multi' ? o.nome.toLowerCase() : d.rotuloRef!(o)}</label>
                  ))}
                </div>)
              : <input type={d.tipo === 'numero' ? 'number' : d.input || 'text'} step="any" value={v[d.c] ?? ''} placeholder={d.dica} maxLength={d.max}
                  onChange={e => set(d.c, d.c === 'uf' ? e.target.value.toUpperCase() : e.target.value)} />}
          </Campo>
        </Fragment>))}
      </fieldset>
      {entidade === 'fabricantes' && <p className="muted small">Vínculos de marca só são adicionados (não removidos), para preservar modelos já cadastrados.</p>}
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
        { t: 'Último acesso', c: u => dataHora(u.ultimo_acesso), movel: false }, { t: 'Situação', c: u => u.ativo ? <span className="pill p-verde">ativo</span> : <span className="pill p-cinza">inativo</span> },
      ]} />}</Carregando></div>
      {editar && <FormUsuario u={editar} onFechar={() => setEditar(null)} onOk={r.recarregar} />}
    </>
  );
}

function FormUsuario({ u, onFechar, onOk }: any) {
  const { ref, avisar } = useApp();
  const [v, setV] = useState<any>({ nome: u.nome || '', email: u.email || '', login: u.login || '', perfil_id: u.perfil_id || '', departamento_id: u.departamento_id || '', alcada_max: u.alcada_max ?? 0, ativo: u.ativo ?? true, telefone: u.telefone || '', lojas: u.lojas || [], senha: '' });
  const acao = useAcao();
  const set = (c: string) => (e: any) => setV((s: any) => ({ ...s, [c]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const salvar = async () => {
    const corpo = { ...v, departamento_id: v.departamento_id || null, telefone: v.telefone || null, senha: v.senha || undefined };
    if (await acao.executar(() => u.id ? api('PUT', '/api/usuarios/' + u.id, corpo) : api('POST', '/api/usuarios', corpo))) { avisar('Usuário salvo'); onOk(); onFechar(); }
  };
  return (
    <Modal largo titulo={u.id ? 'Editar usuário' : 'Novo usuário'} onFechar={onFechar} rodape={<><button className="btn" onClick={onFechar}>Cancelar</button><button className="btn primario" disabled={acao.enviando} onClick={salvar}>Salvar</button></>}>
      {acao.erro && <div className="aviso erro">{acao.erro}</div>}
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>{ref.lojas.map((l: any) => (
            <label key={l.id} className="check"><input type="checkbox" checked={v.lojas.includes(l.id)} onChange={e => setV({ ...v, lojas: e.target.checked ? [...v.lojas, l.id] : v.lojas.filter((x: string) => x !== l.id) })} /> {l.codigo}</label>
          ))}</div>
        </Campo>
      </div>
    </Modal>
  );
}

// ---------------- Parâmetros ----------------
export function Parametros() {
  const { ref, pode, recarregarRef, avisar } = useApp();
  const [valores, setValores] = useState<Record<string, string>>(() => Object.fromEntries(ref.parametros.map((p: any) => [p.chave, String(p.valor)])));
  const acao = useAcao();
  const salvar = async (chave: string) => {
    if (await acao.executar(() => api('PUT', '/api/parametros/' + chave, { valor: valores[chave] }))) { avisar('Parâmetro atualizado'); recarregarRef(); }
  };
  return (
    <>
      <div className="topo"><div><div className="migalha">Cadastros</div><h1>Parâmetros</h1></div></div>
      {acao.erro && <div className="aviso erro">{acao.erro}</div>}
      <div className="card">
        <p className="muted small">Janelas de reincidência, percentuais de alerta e regras de cotação. Alterações ficam registradas no histórico de auditoria.{!pode('parametro.gerir') && ' Somente o administrador altera.'}</p>
        <Tabela linhas={ref.parametros} chave="chave" colunas={[
          { t: 'Parâmetro', c: p => <><strong>{p.descricao}</strong><div className="muted small mono">{p.chave}</div></> },
          { t: 'Valor', c: p => pode('parametro.gerir') ? <input type="number" step="any" style={{ width: 120 }} value={valores[p.chave]} onChange={e => setValores({ ...valores, [p.chave]: e.target.value })} /> : num(p.valor, Number(p.valor) % 1 ? 2 : 0) },
          { t: '', c: p => pode('parametro.gerir') && String(p.valor) !== valores[p.chave] ? <button className="btn pequeno primario" onClick={() => salvar(p.chave)}>Salvar</button> : null },
        ]} />
      </div>
    </>
  );
}
