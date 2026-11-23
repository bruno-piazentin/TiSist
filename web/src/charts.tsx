// Gráficos em SVG puro (sem bibliotecas): linha com média móvel e projeção, barras horizontais e mapa de calor.
import { useState } from 'react';
import { mesAno, moeda } from './ui';

const CORES = ['#155e5f', '#c98a1b', '#2c5d8f', '#b4372f', '#6b4fa0'];

function escalaBonita(max: number) {
  if (max <= 0) return { max: 1, passos: [0, 1] };
  const mag = 10 ** Math.floor(Math.log10(max));
  const passo = [1, 2, 2.5, 5, 10].map(f => f * mag).find(p => max / p <= 5)!;
  const topo = Math.ceil(max / passo) * passo;
  return { max: topo, passos: Array.from({ length: Math.round(topo / passo) + 1 }, (_, i) => i * passo) };
}

export interface Serie { nome: string; valores: (number | null)[]; cor?: string; tracejada?: boolean; barras?: boolean }

/** Linha temporal com eixo mensal; séries tracejadas para média móvel ou projeção. */
export function GraficoLinha({ meses, series, formato = (v: number) => moeda(v, true), altura = 230 }: {
  meses: string[]; series: Serie[]; formato?: (v: number) => string; altura?: number;
}) {
  const [foco, setFoco] = useState<number | null>(null);
  const L = 640, A = altura, m = { e: 64, d: 12, t: 12, b: 26 };
  const todos = series.flatMap(s => s.valores.filter((v): v is number => v !== null));
  const { max, passos } = escalaBonita(Math.max(...todos, 0));
  const x = (i: number) => m.e + (meses.length === 1 ? 0 : (i * (L - m.e - m.d)) / (meses.length - 1));
  const y = (v: number) => A - m.b - (v / max) * (A - m.t - m.b);
  const larguraBarra = Math.max(4, ((L - m.e - m.d) / meses.length) * 0.55);
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${L} ${A}`} onMouseLeave={() => setFoco(null)}>
        {passos.map(p => (
          <g key={p}>
            <line x1={m.e} x2={L - m.d} y1={y(p)} y2={y(p)} stroke="#eceee9" />
            <text x={m.e - 8} y={y(p) + 4} textAnchor="end">{formato(p)}</text>
          </g>
        ))}
        {meses.map((mes, i) => (i % Math.ceil(meses.length / 12) === 0) && <text key={mes} x={x(i)} y={A - 8} textAnchor="middle">{mesAno(mes)}</text>)}
        {series.map((s, si) => s.barras && s.valores.map((v, i) => v !== null && (
          <rect key={si + '-' + i} x={x(i) - larguraBarra / 2} y={y(v)} width={larguraBarra} height={A - m.b - y(v)} rx={2}
                fill={s.cor || CORES[si]} opacity={foco === null || foco === i ? 0.85 : 0.45} />
        )))}
        {series.map((s, si) => {
          if (s.barras) return null;
          const pts = s.valores.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`));
          const segmentos: string[][] = [[]];
          pts.forEach(p => (p ? segmentos[segmentos.length - 1].push(p) : segmentos.push([])));
          return segmentos.filter(sg => sg.length).map((sg, k) => (
            <polyline key={si + '-' + k} points={sg.join(' ')} fill="none" stroke={s.cor || CORES[si]} strokeWidth={s.tracejada ? 1.8 : 2.4}
                      strokeDasharray={s.tracejada ? '5 4' : undefined} strokeLinejoin="round" />
          ));
        })}
        {foco !== null && <line x1={x(foco)} x2={x(foco)} y1={m.t} y2={A - m.b} stroke="#c9ccc4" />}
        {meses.map((_, i) => (
          <rect key={i} x={x(i) - (L - m.e) / meses.length / 2} y={m.t} width={(L - m.e) / meses.length} height={A - m.t - m.b}
                fill="transparent" onMouseEnter={() => setFoco(i)} />
        ))}
      </svg>
      <div className="legenda" style={{ justifyContent: 'space-between' }}>
        <div className="legenda">{series.map((s, i) => <span key={s.nome}><i style={{ background: s.cor || CORES[i], opacity: s.tracejada ? .6 : 1 }} />{s.nome}</span>)}</div>
        {foco !== null && <span><strong>{mesAno(meses[foco])}</strong>{series.map((s, i) => s.valores[foco] !== null && <span key={i}> · {s.nome}: {formato(s.valores[foco] as number)}</span>)}</span>}
      </div>
    </div>
  );
}

/** Barras horizontais com rótulo e valor (rankings e distribuições). */
export function BarrasH({ itens, formato = (v: number) => moeda(v, true), cor = '#155e5f' }: {
  itens: { rotulo: string; valor: number; extra?: string; destaque?: boolean }[]; formato?: (v: number) => string; cor?: string;
}) {
  const max = Math.max(...itens.map(i => i.valor), 1);
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {itens.map(i => (
        <div key={i.rotulo} style={{ display: 'grid', gridTemplateColumns: 'minmax(90px, 34%) 1fr auto', gap: 10, alignItems: 'center', fontSize: 13 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={i.rotulo}>{i.rotulo}</span>
          <div className="barra" style={{ height: 12 }}><span style={{ width: `${(i.valor / max) * 100}%`, background: i.destaque ? '#b4372f' : cor }} /></div>
          <span className="num" style={{ minWidth: 86 }}>{formato(i.valor)}{i.extra && <span className="muted small"> {i.extra}</span>}</span>
        </div>
      ))}
    </div>
  );
}

/** Mapa de calor modelo × categoria de falha. */
export function MapaCalor({ celulas }: { celulas: { modelo: string; categoria: string; falhas: number }[] }) {
  const linhas = [...new Set(celulas.map(c => c.modelo))];
  const cols = [...new Set(celulas.map(c => c.categoria))];
  const max = Math.max(...celulas.map(c => Number(c.falhas)), 1);
  const valor = (l: string, c: string) => Number(celulas.find(x => x.modelo === l && x.categoria === c)?.falhas || 0);
  linhas.sort((a, b) => cols.reduce((s, c) => s + valor(b, c), 0) - cols.reduce((s, c) => s + valor(a, c), 0));
  return (
    <div className="tabela-wrap">
      <table style={{ fontSize: 12 }}>
        <thead><tr><th>Modelo</th>{cols.map(c => <th key={c} style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{c}</th>)}</tr></thead>
        <tbody>
          {linhas.map(l => (
            <tr key={l}>
              <td className="mono">{l}</td>
              {cols.map(c => {
                const v = valor(l, c); const t = v / max;
                return <td key={c} style={{ textAlign: 'center', background: v ? `rgba(180,55,47,${0.08 + t * 0.75})` : undefined, color: t > 0.55 ? '#fff' : undefined, fontWeight: 600 }}>{v || ''}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
