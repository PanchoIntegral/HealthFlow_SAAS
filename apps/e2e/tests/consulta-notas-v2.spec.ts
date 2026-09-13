import { expect, test } from '@playwright/test';
import { Clinica, abrirEditor, type Medico } from './datos';

/**
 * Pantalla de consulta sobre el esquema calculado por la API (notas v2).
 *
 * Cubre: flag apagado (legacy intacto), v1 activo en una primera valoración de
 * especialidad, rechazo de cierre con pendientes y reingreso al borrador.
 */
test.describe('Consulta con notas clínicas v2', () => {
  let clinica: Clinica;
  let general: Medico;
  let cardio: Medico;

  test.beforeAll(async () => {
    clinica = await Clinica.crear('Clínica E2E notas');
    general = await clinica.medico('Dra. General E2E', 'general');
    cardio = await clinica.medico('Dr. Cardio E2E', 'cardiologia');
  });

  test.afterAll(async () => {
    await clinica?.borrar();
  });

  /** Paciente con historia general firmada y cardiología v1 encendida. */
  async function primeraValoracionCardiologia() {
    await clinica.notasV2('general', true);
    await clinica.notasV2('cardiologia', true);
    const paciente = await clinica.paciente();
    await clinica.firmarHistoriaGeneral(general, paciente);
    const citaId = await clinica.abrirConsulta(cardio, paciente);
    return { paciente, citaId };
  }

  test('flag apagado: la nota se abre legacy, con los antecedentes para capturar', async ({ page }) => {
    await clinica.notasV2('cardiologia', false);
    const paciente = await clinica.paciente();
    const citaId = await clinica.abrirConsulta(cardio, paciente);

    await abrirEditor(page, cardio, citaId, paciente);

    await expect(page.getByText(/Historia clínica · NOM-004/)).toBeVisible();
    await expect(page.getByTestId('plantilla-nota')).toHaveCount(0);
    await expect(page.getByTestId('verificacion-antecedentes')).toHaveCount(0);
    await expect(page.getByText('Heredofamiliares', { exact: false }).first()).toBeVisible();

    const pendientes = page.getByTestId('pendientes-firma');
    await expect(pendientes.locator('[data-ruta="antecedentesHeredofamiliares"]')).toBeVisible();

    const nota = await clinica.nota(citaId);
    expect(nota.plantilla_version).toBeNull();
    expect(nota.contexto_nota).toBeNull();
  });

  test('v1 activo: primera valoración de cardiología con antecedentes como referencia', async ({ page }) => {
    const { paciente, citaId } = await primeraValoracionCardiologia();

    await abrirEditor(page, cardio, citaId, paciente);

    await expect(page.getByTestId('plantilla-nota')).toContainText('Plantilla v1');
    await expect(page.getByTestId('plantilla-nota')).toContainText('Primera valoración de especialidad');

    const verificacion = page.getByTestId('verificacion-antecedentes');
    await expect(verificacion).toContainText('Madre con diabetes tipo 2');
    await expect(verificacion).toContainText('Apendicectomía en 2010');
    // Referencia, no captura: no hay campos editables de antecedentes hasta
    // que el profesional declare que los actualizó.
    await expect(verificacion.locator('textarea')).toHaveCount(0);

    const pendientes = page.getByTestId('pendientes-firma');
    await expect(pendientes.locator('[data-ruta="verificacionAntecedentes"]')).toBeVisible();
    await expect(pendientes.locator('[data-ruta="antecedentesHeredofamiliares"]')).toHaveCount(0);

    await verificacion.getByLabel('Actualizados en esta consulta').check();
    await expect(verificacion.locator('textarea')).toHaveCount(3);
    await expect(
      pendientes.locator('[data-ruta="verificacionAntecedentes.actualizacion"]'),
    ).toBeVisible();
  });

  test('error de cierre: la API rechaza, la pantalla lista pendientes y se resuelven hasta firmar', async ({ page }) => {
    const { paciente, citaId } = await primeraValoracionCardiologia();
    await abrirEditor(page, cardio, citaId, paciente);
    await expect(page.getByTestId('plantilla-nota')).toBeVisible();

    await page.getByRole('button', { name: /Firmar y cerrar/ }).click();

    await expect(page.getByTestId('error-cierre')).toBeVisible();
    const pendientes = page.getByTestId('pendientes-firma');
    await expect(
      pendientes.locator('[data-ruta="verificacionAntecedentes"][data-codigo="CAMPO_REQUERIDO"]'),
    ).toBeVisible();
    expect((await clinica.nota(citaId)).estatus).toBe('borrador');

    // "No fue posible" sin motivo: el pendiente cambia a MOTIVO_REQUERIDO.
    const verificacion = page.getByTestId('verificacion-antecedentes');
    await verificacion.getByLabel('No fue posible verificar').check();
    await expect(
      pendientes.locator('[data-ruta="verificacionAntecedentes"][data-codigo="MOTIVO_REQUERIDO"]'),
    ).toBeVisible();

    await verificacion.getByLabel('Motivo de no verificación').fill('Paciente acude sin acompañante');
    await expect(pendientes.locator('[data-ruta="verificacionAntecedentes"]')).toHaveCount(0);

    // Resto de la base NOM-004.
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type('Disnea de esfuerzo de dos meses.');
    await page.getByText('T/A (mmHg)').locator('..').locator('input').fill('130/85');
    await page.getByPlaceholder('Buscar diagnóstico o código CIE-10…').fill('Z00.0');
    await page.getByRole('button', { name: /Z00\.0/ }).first().click();
    await page.getByPlaceholder(/Medicamentos, indicaciones/).fill('Ecocardiograma y control en 1 mes.');

    await expect(page.getByText('Sin pendientes: la nota puede firmarse.')).toBeVisible();
    await page.getByRole('button', { name: /Firmar y cerrar/ }).click();
    await page.waitForURL('**/sala-de-espera');

    const nota = await clinica.nota(citaId);
    expect(nota.estatus).toBe('cerrada');
    expect(nota.contenido.verificacionAntecedentes).toEqual({
      estado: 'no_fue_posible_verificar',
      motivo: 'Paciente acude sin acompañante',
    });
  });

  test('reingreso: el borrador conserva lo capturado y el contexto estampado', async ({ page }) => {
    const { paciente, citaId } = await primeraValoracionCardiologia();
    await abrirEditor(page, cardio, citaId, paciente);

    await page.getByTestId('verificacion-antecedentes').getByLabel('Verificados sin cambios').check();
    await page.locator('.ProseMirror').first().click();
    await page.keyboard.type('Palpitaciones ocasionales.');
    await expect(page.getByText(/Guardado/)).toBeVisible();
    await expect.poll(async () => (await clinica.nota(citaId)).contenido.padecimientoActual).toContain(
      'Palpitaciones ocasionales.',
    );

    // Sale y vuelve a entrar desde la sala: la API reusa la nota, no recalcula.
    await page.goto('/sala-de-espera');
    await abrirEditor(page, cardio, citaId, paciente);

    await expect(page.getByTestId('plantilla-nota')).toContainText('Primera valoración de especialidad');
    await expect(page.locator('.ProseMirror').first()).toContainText('Palpitaciones ocasionales.');
    await expect(page.getByTestId('verificacion-antecedentes').getByLabel('Verificados sin cambios')).toBeChecked();
    await expect(
      page.getByTestId('pendientes-firma').locator('[data-ruta="verificacionAntecedentes"]'),
    ).toHaveCount(0);

    const nota = await clinica.nota(citaId);
    expect(nota).toMatchObject({ estatus: 'borrador', contexto_nota: 'inicial_especialidad', plantilla_version: 'v1' });
  });
});
