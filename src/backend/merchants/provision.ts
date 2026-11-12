import {
  verifySupabaseUserSession,
  type AuthVerifierConfig,
} from '../auth/supabase-auth.js';
import type { OwnedMerchantRecord } from '../supabase/repository.js';

export interface IMerchantProvisionRepo {
  getMerchantsByOwner(ownerId: string): Promise<OwnedMerchantRecord[]>;
  createMerchantForOwner(
    ownerId: string,
    name: string,
  ): Promise<{
    data: OwnedMerchantRecord | null;
    status: number;
    errorMessage?: string;
  }>;
}

export interface MerchantProvisionDeps {
  authConfig: AuthVerifierConfig;
  createUserRepo: (accessToken: string) => IMerchantProvisionRepo;
  serviceRepo: IMerchantProvisionRepo;
}

export interface MerchantProvisionInput {
  headers: Record<string, string | string[] | undefined>;
  storeName: unknown;
}

export interface MerchantProvisionHttpResult {
  statusCode: number;
  body:
    | {
        success: true;
        alreadyExisted: boolean;
        data: OwnedMerchantRecord;
      }
    | {
        success: false;
        error: string;
        message: string;
      };
}

function isRlsOrPermissionFailure(
  status: number,
  errorMessage?: string,
): boolean {
  if (status === 401 || status === 403) return true;
  if (!errorMessage) return false;
  return /row-level security|42501|permission denied/i.test(errorMessage);
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

/**
 * Provisiona de forma segura el comercio inicial para el usuario autenticado
 * mediante Supabase Auth. Toma el `owner_id` exclusivamente del JWT verificado
 * por Supabase Auth para impedir suplantación entre comercios.
 */
export async function provisionMerchantForAuthenticatedUser(
  deps: MerchantProvisionDeps,
  input: MerchantProvisionInput,
): Promise<MerchantProvisionHttpResult> {
  const auth = await verifySupabaseUserSession(
    { headers: normalizeHeaders(input.headers) },
    deps.authConfig,
  );

  if (!auth.success) {
    return {
      statusCode: auth.statusCode,
      body: {
        success: false,
        error: auth.error,
        message: auth.message,
      },
    };
  }

  const cleanName =
    typeof input.storeName === 'string' ? input.storeName.trim() : '';
  if (cleanName.length < 2 || cleanName.length > 80) {
    return {
      statusCode: 400,
      body: {
        success: false,
        error: 'INVALID_STORE_NAME',
        message: 'El nombre del comercio debe tener entre 2 y 80 caracteres.',
      },
    };
  }

  const userRepo = deps.createUserRepo(auth.accessToken);
  const existingOwned = await userRepo.getMerchantsByOwner(auth.user.id);
  if (existingOwned.length > 0) {
    return {
      statusCode: 200,
      body: {
        success: true,
        alreadyExisted: true,
        data: existingOwned[0],
      },
    };
  }

  const existingViaService = await deps.serviceRepo.getMerchantsByOwner(
    auth.user.id,
  );
  if (existingViaService.length > 0) {
    return {
      statusCode: 200,
      body: {
        success: true,
        alreadyExisted: true,
        data: existingViaService[0],
      },
    };
  }

  const userAttempt = await userRepo.createMerchantForOwner(
    auth.user.id,
    cleanName,
  );
  if (userAttempt.data) {
    return {
      statusCode: 201,
      body: {
        success: true,
        alreadyExisted: false,
        data: userAttempt.data,
      },
    };
  }

  if (isRlsOrPermissionFailure(userAttempt.status, userAttempt.errorMessage)) {
    const serviceAttempt = await deps.serviceRepo.createMerchantForOwner(
      auth.user.id,
      cleanName,
    );
    if (serviceAttempt.data) {
      return {
        statusCode: 201,
        body: {
          success: true,
          alreadyExisted: false,
          data: serviceAttempt.data,
        },
      };
    }

    return {
      statusCode:
        serviceAttempt.status === 401 || serviceAttempt.status === 403
          ? 403
          : 500,
      body: {
        success: false,
        error: 'MERCHANT_PROVISION_RLS_BLOCKED',
        message:
          serviceAttempt.errorMessage ||
          userAttempt.errorMessage ||
          'No se pudo crear el comercio por políticas RLS en Supabase.',
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      success: false,
      error: 'MERCHANT_PROVISION_FAILED',
      message:
        userAttempt.errorMessage ||
        'Error inesperado creando el comercio en Supabase.',
    },
  };
}
