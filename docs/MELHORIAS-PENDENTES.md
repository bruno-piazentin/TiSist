# Melhorias pendentes (dívida técnica)

Pontos levantados na revisão de código de 23/11/2026 (versão 1.1.3) que ficaram para uma versão própria.
Não são defeitos: o sistema funciona e os testes passam. São melhorias de **legibilidade e manutenção**,
para que um programador novo se encontre mais rápido no código.

Ao concluir um item, mova-o para "Concluídas" no fim deste arquivo, com a versão em que entrou.

---

## 1. Formatar e dividir as telas do front-end

**Situação (medida em 23/11/2026):**
- O servidor está bem formatado, mas as telas em `web/src/pages/` têm muitas linhas longas, com vários elementos JSX
  numa linha só. Exemplos: `Equipamentos.tsx` tem 78 linhas acima de 160 colunas; `Cadastros.tsx` tem uma linha de 368
  caracteres; `Chamados.tsx` tem 219 linhas e um único comentário.
- `Equipamentos.tsx` (cerca de 500 linhas) junta cinco telas num arquivo: lista, detalhe, cadastro, movimentação e
  abertura de chamado.
- Não há formatador automático configurado no projeto.

**Plano:**
1. Adotar o **Prettier** (`printWidth: 120`, `singleQuote: true`) com o comando `npm run format`.
2. Aplicar uma vez em todo o projeto, **num commit só de formatação** (sem nenhuma mudança de lógica), para o histórico
   continuar fácil de ler. Rodar `npm run typecheck`, `npm test` e conferir as telas no navegador.
3. Dividir `web/src/pages/Equipamentos.tsx` em uma pasta `web/src/pages/equipamentos/`, um arquivo por tela
   (`Lista.tsx`, `Detalhe.tsx`, `Novo.tsx`, `Movimentar.tsx`, `AbrirChamado.tsx`), mantendo os mesmos nomes exportados.
   Avaliar o mesmo para `Chamados.tsx` e `Cadastros.tsx`.
4. Comentar os trechos de regra de negócio nas telas (ex.: por que a movimentação na abertura depende da matriz de
   transições, por que o gerente de loja não movimenta).

**Cuidados:** fazer num momento sem outras mudanças nas telas, para não misturar formatação com alteração de comportamento.

---

## 2. Tipos para os dados da API no front-end

**Situação (medida em 23/11/2026):**
- `tsconfig.json` está com `noImplicitAny: false`.
- Há cerca de 137 usos de `any` em `web/src`. Na prática, o editor não mostra quais campos um equipamento, chamado ou
  orçamento tem; é preciso abrir o SQL (`server/modules/*.ts`) para descobrir.

**Plano (gradual):**
1. Criar `web/src/tipos.ts` com interfaces das entidades principais, a partir dos `SELECT` do servidor:
   `Equipamento`, `Chamado`, `Orcamento`, `Movimentacao`, `Loja`, `Agendamento` e o objeto `ref` (dados de apoio).
2. Tipar o retorno de `api()` nos pontos de uso (`api<Equipamento[]>('GET', ...)`), começando pelas telas mais usadas:
   Equipamentos e Chamados.
3. Trocar `any` por esses tipos tela a tela, rodando `npm run typecheck` a cada passo.
4. Quando os `any` explícitos estiverem sob controle, ligar `noImplicitAny: true` e corrigir o que o compilador apontar.

**Cuidados:** os tipos precisam acompanhar os `SELECT` do servidor; ao mudar uma consulta, atualizar a interface.

---

## Concluídas

- **1.1.4:** banco de desenvolvimento montado com a mesma lista de scripts da produção (`db/migracoes.txt`);
  comandos `npm test` e `npm run test:banco`; auxiliares de validação e registro de eventos centralizados
  (`server/validacao.ts`, `server/evento.ts`); README atualizado com estrutura e guia para quem vai programar.
