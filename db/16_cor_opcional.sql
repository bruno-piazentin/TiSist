-- SisTI 1.5.2: a cor do equipamento deixa de ser obrigatória.
SET search_path = sisti, public;

ALTER TABLE equipamento ALTER COLUMN cor DROP NOT NULL;
