-- SisTI 1.2.0: bloqueio temporário do login após senhas erradas seguidas.
-- Depois de "login_tentativas_max" erros seguidos, o usuário fica bloqueado por "login_bloqueio_minutos".
-- Os dois valores podem ser ajustados na tela Parâmetros. O administrador desbloqueia na tela Usuários.
SET search_path = sisti, public;

ALTER TABLE usuario ADD COLUMN IF NOT EXISTS tentativas_falhas int NOT NULL DEFAULT 0;  -- erros seguidos desde o último acerto
ALTER TABLE usuario ADD COLUMN IF NOT EXISTS bloqueado_ate timestamptz;                -- null ou no passado = liberado

INSERT INTO parametro (chave, valor, descricao) VALUES
 ('login_tentativas_max',   3, 'Senhas erradas seguidas que bloqueiam o login'),
 ('login_bloqueio_minutos', 5, 'Minutos de bloqueio do login após as senhas erradas')
ON CONFLICT (chave) DO NOTHING;

-- O usuário só de leitura (pgAdmin) tem permissão por coluna em usuario: inclui as colunas novas
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sisti_leitura') THEN
    GRANT SELECT (tentativas_falhas, bloqueado_ate) ON sisti.usuario TO sisti_leitura;
  END IF;
END $$;
