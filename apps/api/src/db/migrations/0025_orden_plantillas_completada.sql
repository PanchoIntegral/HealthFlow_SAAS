-- ═══════════════════════════════════════════════════════════════════
-- 'enviada' → 'completada' en el estatus de la orden de plantillas.
--
-- HealthFlow no manda nada al laboratorio por su cuenta (no hay integración
-- real con Microrthopedic Solutions): la marca solo dice que el médico
-- terminó de llenarla y está lista para imprimirse/entregarse. "Enviada"
-- prometía una acción que el sistema nunca ejecutó; "completada" describe lo
-- que de verdad pasó.
-- ═══════════════════════════════════════════════════════════════════

-- El DROP va PRIMERO: el constraint viejo solo admite 'enviada', y el UPDATE
-- de abajo escribe 'completada' — en el orden inverso, el propio UPDATE
-- violaría la regla que se está reemplazando.
ALTER TABLE ordenes_plantillas DROP CONSTRAINT ordenes_plantillas_estatus_check;

UPDATE ordenes_plantillas SET estatus = 'completada' WHERE estatus = 'enviada';

ALTER TABLE ordenes_plantillas ADD CONSTRAINT ordenes_plantillas_estatus_check
  CHECK (estatus IN ('borrador', 'completada', 'cancelada'));
