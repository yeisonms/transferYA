import type { HttpRequest } from '../webhook/types.js';

export interface AuthenticatedSupabaseUser {
  id: string;
  email: string | null;
}

export type AuthVerificationResult =
  | {
      success: true;
      user: AuthenticatedSupabaseUser;
      accessToken: string;
    }
  | {
      success: false;
      statusCode: 401;
      error: 'MISSING_AUTH_TOKEN' | 'INVALID_AUTH_TOKEN';
      message: string;
    };

export interface AuthVerifierConfig {
  supabaseUrl: string;
  supabaseKey: string;
  fetchImpl?: typeof fetch;
}

/**
 * Extrae el token Bearer del encabezado Authorization de una petición HTTP.
 */
export function extractBearerToken(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const rawAuth = headers['authorization'] ?? headers['Authorization'];
  const headerVal = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
  if (!headerVal || typeof headerVal !== 'string') {
    return null;
  }

  const match = headerVal.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : null;
}

/**
 * Verifica un JWT de Supabase Auth consultando `/auth/v1/user` para garantizar
 * firma vigente, revocación y expiración del usuario autenticado.
 */
export async function verifySupabaseUserSession(
  req: Pick<HttpRequest, 'headers'>,
  config: AuthVerifierConfig,
): Promise<AuthVerificationResult> {
  const token = extractBearerToken(req.headers);
  if (!token) {
    return {
      success: false,
      statusCode: 401,
      error: 'MISSING_AUTH_TOKEN',
      message: 'Se requiere encabezado Authorization: Bearer <token> de sesión válida.',
    };
  }

  const fetchFn = config.fetchImpl ?? fetch;
  const baseUrl = config.supabaseUrl.replace(/\/$/, '');

  try {
    const res = await fetchFn(`${baseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: config.supabaseKey,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      return {
        success: false,
        statusCode: 401,
        error: 'INVALID_AUTH_TOKEN',
        message: 'Sesión de usuario inválida o expirada. Inicia sesión nuevamente.',
      };
    }

    const userData = (await res.json()) as { id?: string; email?: string | null };
    if (!userData?.id) {
      return {
        success: false,
        statusCode: 401,
        error: 'INVALID_AUTH_TOKEN',
        message: 'La sesión autenticada no contiene un identificador de usuario válido.',
      };
    }

    return {
      success: true,
      user: {
        id: userData.id,
        email: userData.email ?? null,
      },
      accessToken: token,
    };
  } catch {
    return {
      success: false,
      statusCode: 401,
      error: 'INVALID_AUTH_TOKEN',
      message: 'No fue posible validar la sesión contra Supabase Auth.',
    };
  }
}

export interface MerchantOwnershipCheckResult {
  authorized: true;
  user: AuthenticatedSupabaseUser;
  accessToken: string;
}

export interface MerchantOwnershipErrorResult {
  authorized: false;
  statusCode: 401 | 403;
  error: string;
  message: string;
}

/**
 * Exige una sesión Supabase válida y verifica que el usuario autenticado
 * sea el propietario (`owner_id === user.id`) del comercio consultado.
 */
export async function requireMerchantOwner(
  req: Pick<HttpRequest, 'headers'>,
  config: AuthVerifierConfig,
  merchantLookup: (
    accessToken: string,
  ) => Promise<{ id: string; ownerId: string } | null>,
  expectedMerchantId: string,
): Promise<MerchantOwnershipCheckResult | MerchantOwnershipErrorResult> {
  const auth = await verifySupabaseUserSession(req, config);
  if (!auth.success) {
    return {
      authorized: false,
      statusCode: 401,
      error: auth.error,
      message: auth.message,
    };
  }

  const merchant = await merchantLookup(auth.accessToken);
  if (
    !merchant ||
    merchant.id !== expectedMerchantId ||
    merchant.ownerId !== auth.user.id
  ) {
    return {
      authorized: false,
      statusCode: 403,
      error: 'FORBIDDEN_MERCHANT_ACCESS',
      message: 'No tienes autorización como propietario sobre este comercio o caja.',
    };
  }

  return {
    authorized: true,
    user: auth.user,
    accessToken: auth.accessToken,
  };
}
