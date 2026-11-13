import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('Validación de Configuración para Despliegue en Vercel', () => {
  const rootDir = process.cwd();
  const vercelJsonPath = resolve(rootDir, 'vercel.json');
  const publicDirPath = resolve(rootDir, 'public');
  const indexHtmlPath = resolve(publicDirPath, 'index.html');
  const healthApiPath = resolve(rootDir, 'api', 'health.ts');

  it('debe existir el archivo vercel.json configurando el outputDirectory hacia public', () => {
    expect(existsSync(vercelJsonPath)).toBe(true);
    const vercelConfig = JSON.parse(readFileSync(vercelJsonPath, 'utf-8'));
    expect(vercelConfig.outputDirectory).toBe('public');
  });

  it('debe existir el directorio public/ con index.html para evitar el error STATIC_BUILD_NO_OUT_DIR', () => {
    expect(existsSync(publicDirPath)).toBe(true);
    expect(existsSync(indexHtmlPath)).toBe(true);

    const htmlContent = readFileSync(indexHtmlPath, 'utf-8');
    expect(htmlContent).toContain('TransferYA');
    expect(htmlContent).toContain('Ingresar a mi Negocio');
    expect(htmlContent).toContain('Nequi');
    expect(htmlContent).toContain('DaviPlata');
    // Validación de Onboarding en 3 pasos para comercios nuevos
    expect(htmlContent).toContain('Guía de Inicio Rápido');
    expect(htmlContent).toContain('Descarga la app en el celular donde recibes la plata');
    expect(htmlContent).toContain('Escanear QR');
    expect(htmlContent).toContain('Tus pagos sonarán automáticamente en la caja');
    // Validación Paso D: Modo Pantalla Mostrador (POS) con destello verde y sonido Cha-ching
    expect(htmlContent).toContain('Modo Pantalla Mostrador (POS)');
    expect(htmlContent).toContain('pos-green-flash');
    expect(htmlContent).toContain('pos-screen-burst-flash');
    expect(htmlContent).toContain('Probar Cobro ($ 25.000)');
  });

  it('debe existir la Serverless Function api/health.ts y responder con estado ONLINE', async () => {
    expect(existsSync(healthApiPath)).toBe(true);

    const healthModule = await import(pathToFileURL(healthApiPath).href);
    const healthHandler = healthModule.default;

    let statusCode = 0;
    const headers: Record<string, string> = {};
    let responseBody = '';

    const mockRes: any = {
      statusCode: 200,
      setHeader: (key: string, value: string) => {
        headers[key] = value;
      },
      end: (data: string) => {
        responseBody = data;
      },
    };

    healthHandler({} as any, mockRes);

    expect(mockRes.statusCode).toBe(200);
    expect(headers['Content-Type']).toBe('application/json');

    const parsed = JSON.parse(responseBody);
    expect(parsed.status).toBe('ONLINE');
    expect(parsed.service).toContain('TransferYA');
    expect(parsed.supportedWallets).toContain('com.nequi.MobileApp');
  });
});
