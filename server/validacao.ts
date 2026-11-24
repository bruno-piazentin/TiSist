// Peças de validação (zod) usadas por vários módulos. Use estas em vez de redefinir em cada arquivo.
import { z } from 'zod';

/** Identificador UUID. */
export const uuid = z.string().uuid();

/**
 * Campo opcional: aceita ausente, null ou texto vazio ('') e entrega sempre null nesses casos.
 * Ex.: opcional(z.string()) -> 'abc' fica 'abc'; '' ou undefined viram null.
 */
export const opcional = <T extends z.ZodTypeAny>(s: T) => s.nullish().transform(v => (v === '' ? null : v ?? null));

/** Converte texto vazio em null antes de validar (útil com z.preprocess em campos de formulário). */
export const vazioNulo = (v: unknown) => (v === '' ? null : v);

/** Data no formato AAAA-MM-DD. */
export const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida');

/** Hora no formato HH:MM. */
export const hora = z.string().regex(/^\d{2}:\d{2}$/, 'Hora inválida (HH:MM)');
