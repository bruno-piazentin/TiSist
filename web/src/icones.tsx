// Ícones de linha (SVG embutido, sem dependência externa: funciona offline).
import type { ReactElement, ReactNode } from 'react';

function Svg({ children, tamanho = 20 }: { children: ReactNode; tamanho?: number }) {
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
  );
}

type P = { tamanho?: number };
export const Ic = {
  painel: (p: P) => <Svg {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></Svg>,
  equipamentos: (p: P) => <Svg {...p}><rect x="2.5" y="4" width="19" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></Svg>,
  chamados: (p: P) => <Svg {...p}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3.5 17.2a1.8 1.8 0 0 0 2.5 2.5l5.8-5.8a4 4 0 0 0 5.1-5.4l-2.4 2.4-2.2-.4-.4-2.2z" /></Svg>,
  aprovacoes: (p: P) => <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="m8.5 12.2 2.4 2.4 4.8-5" /></Svg>,
  custos: (p: P) => <Svg {...p}><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5.5A2.5 2.5 0 0 1 3 16.5z" /><path d="M3 8h15M16.5 13.5h.01" /></Svg>,
  fila: (p: P) => <Svg {...p}><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" /><path d="M4 4v4h4" /><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" /><path d="M20 20v-4h-4" /></Svg>,
  cadastros: (p: P) => <Svg {...p}><ellipse cx="12" cy="5.5" rx="8" ry="2.8" /><path d="M4 5.5v6.5c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8V5.5" /><path d="M4 12v6.5c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8V12" /></Svg>,
  agenda: (p: P) => <Svg {...p}><rect x="3" y="4.5" width="18" height="16.5" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /><path d="M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2" /></Svg>,
  usuarios: (p: P) => <Svg {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18.5 14.5a6.5 6.5 0 0 1 3 5.5" /></Svg>,
  parametros: (p: P) => <Svg {...p}><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></Svg>,
  recolher: (p: P) => <Svg {...p}><rect x="3" y="3.5" width="18" height="17" rx="2.5" /><path d="M9 3.5v17M15.5 10l-2 2 2 2" /></Svg>,
  expandir: (p: P) => <Svg {...p}><rect x="3" y="3.5" width="18" height="17" rx="2.5" /><path d="M9 3.5v17M13.5 10l2 2-2 2" /></Svg>,
  sair: (p: P) => <Svg {...p}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5M5 12h11" /></Svg>,
  seta: (p: P) => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>,
  nuvem: (p: P) => <Svg {...p}><path d="M7 18a4.5 4.5 0 0 1-.6-9A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z" /></Svg>,
  semNuvem: (p: P) => <Svg {...p}><path d="M3 3l18 18" /><path d="M8.5 6.4A6 6 0 0 1 18 9.5a4 4 0 0 1 2.2 7.4M17 18H7a4.5 4.5 0 0 1-1.4-8.8" /></Svg>,
};
export type Icone = (p: P) => ReactElement;
