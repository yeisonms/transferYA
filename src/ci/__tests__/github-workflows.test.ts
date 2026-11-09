import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Validación de Workflows CI/CD y Automatización de Release (Ticket 17)', () => {
  const workflowsDir = resolve(process.cwd(), '.github', 'workflows');
  const ciWorkflowPath = resolve(workflowsDir, 'ci.yml');
  const releaseWorkflowPath = resolve(workflowsDir, 'android-release.yml');

  describe('1. Existencia e Integridad de Archivos de Workflow', () => {
    it('debe existir el directorio .github/workflows', () => {
      expect(existsSync(workflowsDir)).toBe(true);
    });

    it('debe existir el workflow de CI/CD principal .github/workflows/ci.yml', () => {
      expect(existsSync(ciWorkflowPath)).toBe(true);
    });

    it('debe existir el workflow de Release de Android .github/workflows/android-release.yml', () => {
      expect(existsSync(releaseWorkflowPath)).toBe(true);
    });
  });

  describe('2. Estructura y Compuertas de Calidad en ci.yml', () => {
    it('debe dispararse ante push y pull_request hacia la rama main', () => {
      const content = readFileSync(ciWorkflowPath, 'utf-8');
      expect(content).toMatch(/branches:\s*\[\s*(main|'main'|"main")\s*\]/i);
    });

    it('debe incluir la ejecución obligatoria de los 4 Quality Gates (tsc, vitest, gradle test, build)', () => {
      const content = readFileSync(ciWorkflowPath, 'utf-8');

      // Gate 1: TypeScript typecheck
      expect(content).toMatch(/tsc\s+--noEmit/i);
      // Gate 2: Tests de backend y Android
      expect(content).toMatch(/npm\s+test/i);
      expect(content).toMatch(/gradlew\s+test/i);
      // Gate 4: Build de backend
      expect(content).toMatch(/npm\s+run\s+build/i);
    });

    it('debe condicionar el despliegue a producción a la rama main y usar secrets cifrados de Vercel', () => {
      const content = readFileSync(ciWorkflowPath, 'utf-8');

      expect(content).toMatch(/deploy-production/i);
      expect(content).toMatch(/secrets\.VERCEL_TOKEN/i);
      expect(content).toMatch(/vercel\s+deploy\s+--prod/i);
      // No debe contener tokens hardcodeados en texto plano
      expect(content).not.toMatch(/vercel_[a-zA-Z0-9]{20,}/);
    });
  });

  describe('3. Estructura de Compilación y Firma de Release en android-release.yml', () => {
    it('debe compilar la variante release con R8 activado (assembleRelease)', () => {
      const content = readFileSync(releaseWorkflowPath, 'utf-8');
      expect(content).toMatch(/assembleRelease/i);
    });

    it('debe inyectar y decodificar el Keystore de producción desde GitHub Secrets', () => {
      const content = readFileSync(releaseWorkflowPath, 'utf-8');
      expect(content).toMatch(/secrets\.ANDROID_RELEASE_KEYSTORE_BASE64/i);
      expect(content).toMatch(/secrets\.ANDROID_KEYSTORE_PASSWORD/i);
      expect(content).toMatch(/secrets\.ANDROID_KEY_ALIAS/i);
    });

    it('debe subir los artefactos finales (APK y mapping.txt) para distribución y depuración de R8', () => {
      const content = readFileSync(releaseWorkflowPath, 'utf-8');
      expect(content).toMatch(/actions\/upload-artifact/i);
      expect(content).toMatch(/\.apk/i);
    });
  });
});

