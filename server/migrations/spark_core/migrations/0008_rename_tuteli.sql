-- Rebranding: produto 'sparkpet' passa a se chamar 'Tuteli' (nome comercial novo).
-- O código 'sparkpet' é imutável (SC-007); só o nome de exibição é atualizado.
UPDATE product
   SET name       = 'Tuteli',
       updated_at = UTC_TIMESTAMP(6)
 WHERE code = 'sparkpet';
