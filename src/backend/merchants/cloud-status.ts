import {
  requireMerchantOwner,
  type AuthVerifierConfig,
} from '../auth/supabase-auth.js';
import { getLatestGoogleVerificationCode } from '../webhook/inbound-email-handler.js';

export interface IMerchantCloudStatusRepo {
  getMerchantWithOwner(merchantId: string): Promise<any>;
  getDeviceStatus(deviceId: string): Promise<'ACTIVE' | 'REVOKED' | 'NOT_FOUND'>;
  registerDevice?(
    deviceId: string,
    merchantId: string,
    secretHash: string,
    label?: string,
  ): Promise<any>;
  revokeDevice?(deviceId: string, merchantId: string): Promise<boolean>;
}

export interface MerchantCloudStatusDeps {
  authConfig: AuthVerifierConfig;
  createUserRepo: (accessToken: string) => IMerchantCloudStatusRepo;
  serviceRepo: IMerchantCloudStatusRepo;
  inboundDomain?: string;
  getVerificationCodeProvider?: (merchantId: string) => {
    code: string;
    url?: string;
    receivedAt: number;
  } | null;
  requireOwnerVerifier?: typeof requireMerchantOwner;
}

export interface MerchantCloudStatusRequestInput {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | undefined>;
  body?: Record<string, any>;
}

export interface MerchantCloudStatusData {
  merchantId: string;
  cloudDeviceId: string;
  inboundEmail: string;
  isConfigured: boolean;
  status: 'ACTIVE' | 'REVOKED' | 'PENDING_CONFIG';
  googleVerification: {
    code: string;
    url?: string;
    receivedAt: number;
  } | null;
}

export interface MerchantCloudStatusHttpResult {
  statusCode: number;
  body:
    | {
        success: true;
        data: MerchantCloudStatusData;
        message?: string;
      }
    | {
        success: false;
        error: string;
        message: string;
      };
}

function normalizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    normalized[k] = Array.isArray(v) ? v[0] : v;
  }
  return normalized;
}

export async function handleMerchantCloudStatusRequest(
  deps: MerchantCloudStatusDeps,
  input: MerchantCloudStatusRequestInput,
): Promise<MerchantCloudStatusHttpResult> {
  const method = (input.method || 'GET').toUpperCase();
  const normalizedHeaders = normalizeHeaders(input.headers);

  // Extraer merchantId desde query o body
  const merchantId =
    input.query?.merchantId ||
    input.body?.merchantId ||
    '';

  if (!merchantId || typeof merchantId !== 'string' || !merchantId.trim()) {
    return {
      statusCode: 400,
      body: {
        success: false,
        error: 'MISSING_MERCHANT_ID',
        message: 'El parámetro merchantId es requerido',
      },
    };
  }

  const cleanMerchantId = merchantId.trim();

  // 1. Verificación de Autenticación y Propiedad
  const verifier = deps.requireOwnerVerifier ?? requireMerchantOwner;
  const ownership = await verifier(
    { headers: normalizedHeaders },
    deps.authConfig,
    async (token) => {
      const userRepo = deps.createUserRepo(token);
      return userRepo.getMerchantWithOwner(cleanMerchantId);
    },
    cleanMerchantId,
  );

  if (!ownership.authorized) {
    return {
      statusCode: ownership.statusCode,
      body: {
        success: false,
        error: ownership.error,
        message: ownership.message,
      },
    };
  }

  const inboundDomain =
    deps.inboundDomain ||
    process.env.INBOUND_EMAIL_DOMAIN ||
    'transferya.app';
  const cloudDeviceId = `cloud_email_${cleanMerchantId}`;
  const inboundEmail = `pago+${cleanMerchantId}@${inboundDomain}`;
  const verificationProvider =
    deps.getVerificationCodeProvider ?? getLatestGoogleVerificationCode;

  // 2. Manejo de Acciones POST (Activar / Pausar Ruta Cloud)
  if (method === 'POST') {
    const action = input.body?.action || 'ENABLE';
    if (action === 'ENABLE') {
      try {
        await deps.serviceRepo.registerDevice?.(
          cloudDeviceId,
          cleanMerchantId,
          'cloud_inbound_secret',
          'Respaldo Cloud (Gmail)',
        );
      } catch (err: any) {
        console.error('Error registrando dispositivo cloud:', err);
      }
    } else if (action === 'DISABLE') {
      try {
        await deps.serviceRepo.revokeDevice?.(cloudDeviceId, cleanMerchantId);
      } catch (err: any) {
        console.error('Error revocando dispositivo cloud:', err);
      }
    }
  }

  // 3. Consultar Estado Actual
  let deviceStatus: 'ACTIVE' | 'REVOKED' | 'NOT_FOUND' = 'NOT_FOUND';
  try {
    deviceStatus = await deps.serviceRepo.getDeviceStatus(cloudDeviceId);
  } catch {
    deviceStatus = 'NOT_FOUND';
  }

  const isConfigured = deviceStatus === 'ACTIVE' || deviceStatus === 'REVOKED';
  const status: 'ACTIVE' | 'REVOKED' | 'PENDING_CONFIG' =
    deviceStatus === 'ACTIVE'
      ? 'ACTIVE'
      : deviceStatus === 'REVOKED'
        ? 'REVOKED'
        : 'PENDING_CONFIG';

  const googleVerification = verificationProvider(cleanMerchantId);

  return {
    statusCode: 200,
    body: {
      success: true,
      data: {
        merchantId: cleanMerchantId,
        cloudDeviceId,
        inboundEmail,
        isConfigured,
        status,
        googleVerification,
      },
      message: method === 'POST' ? 'Estado actualizado correctamente' : undefined,
    },
  };
}
