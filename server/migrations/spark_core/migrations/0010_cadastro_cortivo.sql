-- Cadastro do produto Cortivo (gestao para barbearias) no catalogo. Produto so entra por migracao
-- do Core, nunca pela interface (SC-008). O codigo `cortivo` e imutavel (SC-007, D-COR-01).
--
-- Antes de aplicar em um ambiente-alvo, o operador confere se ja existe produto de barbearia
-- registrado com outro codigo (ex.: `sparkbarba`). Se existir, o codigo existente e preservado, esta
-- migracao NAO deve ser aplicada naquele ambiente e a decisao fica registrada em D-COR-01 e no
-- registro de produtos (docs/ecossistema/01-registro-de-produtos.md).
--
-- Segura para reaplicacao: se a linha `cortivo` ja existir, nada e inserido.
INSERT INTO product (code, name, description, status, reference_only, version, created_at, updated_at)
SELECT 'cortivo', 'Cortivo', 'Gestão para barbearias',
       'ativo', FALSE, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)
  FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM product WHERE code = 'cortivo');
