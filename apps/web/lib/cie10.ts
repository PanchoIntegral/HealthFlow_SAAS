import type { DiagnosticoCie10 } from '@healthflow/shared-types';

/**
 * Catálogo CIE-10 reducido con diagnósticos frecuentes en consulta general.
 * El catálogo completo (~14k códigos) es un follow-up: iría en la base de datos
 * con un endpoint de búsqueda. Aquí basta para el buscador del editor.
 */
export const CIE10_COMUNES: DiagnosticoCie10[] = [
  { cie10: 'E11.9', descripcion: 'Diabetes mellitus tipo 2, sin complicaciones' },
  { cie10: 'I10', descripcion: 'Hipertensión esencial (primaria)' },
  { cie10: 'E78.5', descripcion: 'Hiperlipidemia, no especificada' },
  { cie10: 'E78.0', descripcion: 'Hipercolesterolemia pura' },
  { cie10: 'E66.9', descripcion: 'Obesidad, no especificada' },
  { cie10: 'J00', descripcion: 'Rinofaringitis aguda (resfriado común)' },
  { cie10: 'J02.9', descripcion: 'Faringitis aguda, no especificada' },
  { cie10: 'K21.9', descripcion: 'Enfermedad por reflujo gastroesofágico sin esofagitis' },
  { cie10: 'M54.5', descripcion: 'Lumbalgia' },
  { cie10: 'R51', descripcion: 'Cefalea' },
  { cie10: 'N39.0', descripcion: 'Infección de vías urinarias, sitio no especificado' },
  { cie10: 'E03.9', descripcion: 'Hipotiroidismo, no especificado' },
  { cie10: 'F41.1', descripcion: 'Trastorno de ansiedad generalizada' },
  { cie10: 'F32.9', descripcion: 'Episodio depresivo, no especificado' },
  { cie10: 'J45.9', descripcion: 'Asma, no especificada' },
];

export function buscarCie10(query: string): DiagnosticoCie10[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return CIE10_COMUNES.filter(
    (d) => d.cie10.toLowerCase().includes(q) || d.descripcion.toLowerCase().includes(q),
  ).slice(0, 6);
}
