// Relatórios gerados no navegador: página de impressão (salvar como PDF) e CSV para Excel.

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export interface ColunaRel { t: string; v: (l: any) => unknown }
export interface SecaoRel { titulo?: string; itens: { rotulo: string; valor: unknown }[] }

const ESTILO = `
  * { box-sizing: border-box; }
  body { font: 12px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1d2320; margin: 24px; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #2f6b3f; padding-bottom: 8px; margin-bottom: 14px; }
  h1 { font-size: 18px; margin: 0; } .sub { color: #5b625e; font-size: 11px; }
  h2 { font-size: 13px; margin: 16px 0 6px; color: #2f6b3f; border-bottom: 1px solid #dfe3dc; padding-bottom: 3px; }
  table { width: 100%; border-collapse: collapse; } th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid #e4e7e1; vertical-align: top; }
  th { background: #f1f3ef; font-size: 11px; } tr { page-break-inside: avoid; }
  dl { display: grid; grid-template-columns: 180px 1fr; gap: 3px 12px; margin: 0; } dt { color: #5b625e; } dd { margin: 0; font-weight: 500; }
  @media print { body { margin: 0; } }
  @page { margin: 14mm; }`;

/**
 * Imprime o relatório sem abrir outra aba: monta a página num quadro invisível e abre a janela de
 * impressão do navegador, onde o usuário escolhe a impressora ou "Salvar como PDF".
 */
function abrir(titulo: string, subtitulo: string, corpo: string, paisagem = false) {
  document.getElementById('sisti-impressao')?.remove();
  const quadro = document.createElement('iframe');
  quadro.id = 'sisti-impressao';
  quadro.setAttribute('aria-hidden', 'true');
  quadro.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(quadro);
  const agora = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const doc = quadro.contentDocument!;
  doc.open();
  doc.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(titulo)}</title>
    <style>${ESTILO}${paisagem ? '@page { size: landscape; }' : ''}</style></head><body>
    <header><div><h1>${esc(titulo)}</h1>${subtitulo ? `<div class="sub">${esc(subtitulo)}</div>` : ''}</div>
    <div class="sub">SisTI · gerado em ${esc(agora)}</div></header>${corpo}</body></html>`);
  doc.close();
  // O nome sugerido para o PDF vem do título da página principal: troca durante a impressão
  const tituloOriginal = document.title;
  const restaurar = () => { document.title = tituloOriginal; setTimeout(() => quadro.remove(), 1000); };
  setTimeout(() => {
    const w = quadro.contentWindow!;
    w.addEventListener('afterprint', restaurar, { once: true });
    document.title = titulo;
    w.focus(); w.print();
    setTimeout(() => { if (document.title === titulo) document.title = tituloOriginal; }, 60000);
  }, 200);
}

/** Relatório em lista (tabela). */
export function relatorioLista(titulo: string, subtitulo: string, colunas: ColunaRel[], linhas: any[]) {
  const corpo = `<table><thead><tr>${colunas.map(c => `<th>${esc(c.t)}</th>`).join('')}</tr></thead><tbody>
    ${linhas.map(l => `<tr>${colunas.map(c => `<td>${esc(c.v(l))}</td>`).join('')}</tr>`).join('')}
    </tbody></table><p class="sub">${linhas.length} registro(s)</p>`;
  abrir(titulo, subtitulo, corpo, colunas.length > 6);
}

/** Relatório de um registro (ficha por seções). */
export function relatorioFicha(titulo: string, subtitulo: string, secoes: SecaoRel[]) {
  const corpo = secoes.map(s => `${s.titulo ? `<h2>${esc(s.titulo)}</h2>` : ''}<dl>
    ${s.itens.map(i => `<dt>${esc(i.rotulo)}</dt><dd>${esc(i.valor === '' || i.valor == null ? '—' : i.valor)}</dd>`).join('')}</dl>`).join('');
  abrir(titulo, subtitulo, corpo);
}

/** CSV com separador ";" e BOM (abre direto no Excel em pt-BR). */
export function csvLocal(nome: string, colunas: ColunaRel[], linhas: any[]) {
  const cel = (v: unknown) => { const s = String(v ?? ''); return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = '﻿' + [colunas.map(c => cel(c.t)).join(';'), ...linhas.map(l => colunas.map(c => cel(c.v(l))).join(';'))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = nome + '.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
