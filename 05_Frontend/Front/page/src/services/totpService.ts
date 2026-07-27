import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Segundo factor (2FA TOTP) del usuario logueado — endpoint Api_V1_Security_Totp
 * (POST /Security/Totp, detrás del Authorizer). La verificación en el LOGIN la hace
 * Api_V1_Security_Verify-2fa (ver authService.verify2fa).
 */
export const TOTP_ENDPOINT = '/Security/Totp';

export interface TotpStatus {
  enabled: boolean;
  pending: boolean;
}
export interface TotpEnroll {
  /** Secreto base32 (para escanear o ingresar manualmente en la app). */
  secret: string;
  /** URI otpauth:// para generar el QR. */
  otpauthUri: string;
}
export interface TotpActivate {
  enabled: boolean;
  /** Códigos de respaldo de un solo uso (se muestran UNA vez). */
  backupCodes: string[];
}

export const totpService = {
  status: (): Promise<ApiResponse<TotpStatus>> =>
    apiPost(TOTP_ENDPOINT, { action: 'status' }),
  /** Genera un secreto pendiente + otpauthUri para el QR. */
  enroll: (): Promise<ApiResponse<TotpEnroll>> =>
    apiPost(TOTP_ENDPOINT, { action: 'enroll' }),
  /** Verifica el primer código y activa el 2FA (devuelve los códigos de respaldo). */
  activate: (code: string): Promise<ApiResponse<TotpActivate>> =>
    apiPost(TOTP_ENDPOINT, { action: 'activate', code }),
  /** Desactiva el 2FA (requiere un código válido de la app o de respaldo). */
  disable: (code: string): Promise<ApiResponse<{ enabled: boolean }>> =>
    apiPost(TOTP_ENDPOINT, { action: 'disable', code }),
};
