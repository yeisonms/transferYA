import type { HttpRequest } from '../webhook/types.js';
import {
  verifySupabaseUserSession,
  type AuthVerifierConfig,
  type AuthenticatedSupabaseUser,
} from '../auth/supabase-auth.js';

export const DEFAULT_SUPER_ADMIN_IDS = [
  '44737b1e-254d-4014-9f24-34bcd9340768', // Mursat Solutions Owner ID
];

export const DEFAULT_SUPER_ADMIN_EMAILS = [
  'yeisonm@unicauca.edu.co', // Mursat Solutions Owner Email
];

export interface SuperAdminConfig {
  adminOwnerIds?: string;
  adminEmails?: string;
}

/**
 * Determina si un usuario autenticado posee permisos de Super Admin (Mursat).
 * Evalúa los identificadores permitidos en variables de entorno o valores por defecto.
 */
export function isSuperAdminUser(
  user: AuthenticatedSupabaseUser,
  config?: SuperAdminConfig,
): boolean {
  if (!user || !user.id) {
    return false;
  }

  const allowedIds = new Set<string>(DEFAULT_SUPER_ADMIN_IDS);
  const allowedEmails = new Set<string>(
    DEFAULT_SUPER_ADMIN_EMAILS.map((e) => e.toLowerCase().trim()),
  );

  const envIds = config?.adminOwnerIds ?? process.env.ADMIN_OWNER_IDS;
  if (envIds) {
    envIds
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((id) => allowedIds.add(id));
  }

  const envEmails = config?.adminEmails ?? process.env.ADMIN_EMAILS;
  if (envEmails) {
    envEmails
      .split(',')
      .map((s) => s.toLowerCase().trim())
      .filter(Boolean)
      .forEach((email) => allowedEmails.add(email));
  }

  if (allowedIds.has(user.id)) {
    return true;
  }

  if (user.email && allowedEmails.has(user.email.toLowerCase().trim())) {
    return true;
  }

  return false;
}

export type SuperAdminAuthResult =
  | {
      authorized: true;
      user: AuthenticatedSupabaseUser;
      accessToken: string;
    }
  | {
      authorized: false;
      statusCode: 401 | 403;
      error: 'MISSING_AUTH_TOKEN' | 'INVALID_AUTH_TOKEN' | 'FORBIDDEN_SUPER_ADMIN_REQUIRED';
      message: string;
    };

/**
 * Valida la sesión JWT contra Supabase Auth y exige que el usuario pertenezca
 * a la lista de Super-Admins de TransferYA (Mursat).
 */
export async function requireSuperAdminSession(
  req: Pick<HttpRequest, 'headers'>,
  authConfig: AuthVerifierConfig,
  adminConfig?: SuperAdminConfig,
): Promise<SuperAdminAuthResult> {
  const auth = await verifySupabaseUserSession(req, authConfig);
  if (!auth.success) {
    return {
      authorized: false,
      statusCode: auth.statusCode,
      error: auth.error,
      message: auth.message,
    };
  }

  if (!isSuperAdminUser(auth.user, adminConfig)) {
    return {
      authorized: false,
      statusCode: 403,
      error: 'FORBIDDEN_SUPER_ADMIN_REQUIRED',
      message:
        'Acceso restringido: Esta acción administrativa requiere privilegios de Super-Admin (Mursat Solutions).',
    };
  }

  return {
    authorized: true,
    user: auth.user,
    accessToken: auth.accessToken,
  };
}

