import {
  esFraccionEmisible,
  type EmisorReceta,
  type MedicamentoRecetado,
  type PacienteReceta,
} from '@healthflow/shared-types';

/**
 * Validador de dominio de la receta. Vive en el BACKEND, nunca solo en el
 * front — mismo criterio que `NOM004Validator`: es la regla que impide emitir
 * un documento inválido, y una regla que solo existe en el cliente no es una
 * regla.
 *
 * Devuelve listas en vez de lanzar: quien decide qué error construir es la
 * entidad, y así el mismo validador sirve para pintar el formulario en vivo.
 */
export class RecetaValidator {
  /**
   * Campos obligatorios faltantes, con ruta ('medicamentos[0].dosis'). Lista
   * vacía = la receta puede emitirse.
   */
  static camposFaltantes(
    emisor: EmisorReceta,
    paciente: PacienteReceta,
    medicamentos: MedicamentoRecetado[],
  ): string[] {
    const faltantes: string[] = [];

    // ── Emisor (RIS art. 64) ─────────────────────────────────────
    if (!tieneTexto(emisor.medicoNombre)) faltantes.push('emisor.medicoNombre');
    if (!tieneTexto(emisor.cedulaProfesional)) faltantes.push('emisor.cedulaProfesional');
    if (!tieneTexto(emisor.institucionTitulo)) faltantes.push('emisor.institucionTitulo');
    if (!tieneTexto(emisor.domicilioEstablecimiento)) {
      faltantes.push('emisor.domicilioEstablecimiento');
    }
    // `cedulaEspecialidad` NO se exige: el art. 65 solo la pide a quien ejerce
    // una especialidad, y un médico general no la tiene.
    //
    // La firma tampoco se valida: en papel es AUTÓGRAFA. La hoja imprime la
    // línea donde va y el médico firma; el sistema no la simula ni la exige.

    // ── Paciente (RIS art. 65) ───────────────────────────────────
    if (!tieneTexto(paciente.nombre)) faltantes.push('paciente.nombre');
    if (!Number.isFinite(paciente.edad) || paciente.edad < 0) faltantes.push('paciente.edad');
    if (!tieneTexto(paciente.sexo)) faltantes.push('paciente.sexo');

    // ── Prescripción (RIS arts. 28 y 29) ─────────────────────────
    if (medicamentos.length === 0) {
      faltantes.push('medicamentos');
      return faltantes;
    }

    medicamentos.forEach((m, i) => {
      // La denominación GENÉRICA es la obligatoria (art. 28); la distintiva
      // es opcional por diseño de la norma, porque el farmacéutico puede
      // surtir el genérico aunque se haya escrito una marca.
      if (!tieneTexto(m.denominacionGenerica)) {
        faltantes.push(`medicamentos[${i}].denominacionGenerica`);
      }
      if (!tieneTexto(m.presentacion)) faltantes.push(`medicamentos[${i}].presentacion`);
      if (!tieneTexto(m.dosis)) faltantes.push(`medicamentos[${i}].dosis`);
      if (!tieneTexto(m.via)) faltantes.push(`medicamentos[${i}].via`);
      if (!tieneTexto(m.frecuencia)) faltantes.push(`medicamentos[${i}].frecuencia`);
      if (!tieneTexto(m.duracion)) faltantes.push(`medicamentos[${i}].duracion`);
    });

    return faltantes;
  }

  /**
   * Medicamentos que no se pueden emitir por su fracción del art. 226 LGS.
   *
   * Un medicamento capturado por TEXTO LIBRE (fraccion === null) nunca cae
   * aquí, y es una decisión consciente: el sistema no puede afirmar la
   * fracción de una cadena que alguien tecleó. Por eso el catálogo incluye a
   * propósito los controlados —para que la ruta normal sí dispare el bloqueo—
   * y por eso el escape hatch existe solo para lo que falta del catálogo.
   */
  static medicamentosBloqueados(medicamentos: MedicamentoRecetado[]): MedicamentoRecetado[] {
    return medicamentos.filter((m) => !esFraccionEmisible(m.fraccion));
  }
}

function tieneTexto(valor: string | null | undefined): boolean {
  return typeof valor === 'string' && valor.trim().length > 0;
}
