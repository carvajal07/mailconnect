import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio del MONEDERO (cobro PREPAGO). Saldo por cliente en COP + ledger de movimientos.
 *
 * Endpoints (integración no-proxy, envelope estándar):
 *  - POST /Balance/Get           -> saldo + historial del cliente (tenant del token).
 *  - POST /Balance/Topup-manual  -> recarga manual (ADMIN): acredita saldo.
 *  - POST /Admin/Balances        -> saldos de TODOS los clientes (ADMIN).
 *  - POST /Balance/Topup-init    -> inicia una recarga Wompi (firma de integridad) [Fase 2].
 */

export const BALANCE_ENDPOINTS = {
  GET: '/Balance/Get',
  TOPUP_MANUAL: '/Balance/Topup-manual',
  TOPUP_MANUAL_REQUEST: '/Balance/Topup-manual-request',
  ADMIN_BALANCES: '/Admin/Balances',
  TOPUP_INIT: '/Balance/Topup-init',
  ADMIN_TOPUPS: '/Admin/Topups',
  TOPUP_APPROVE: '/Admin/Topup-approve',
  TOPUP_REJECT: '/Admin/Topup-reject',
};

// topup_manual = recarga del cliente (comprobante + aprobación); topup_wompi = pasarela;
// debit_send/refund_send = envío real; adjustment = ajuste directo del admin.
export type WalletTxType = 'topup_manual' | 'topup_wompi' | 'debit_send' | 'refund_send' | 'adjustment';
export type WalletTxStatus = 'pending' | 'approved' | 'declined' | 'void' | '';

export interface WalletTransaction {
  txId: string;
  type: WalletTxType;
  amount: number;        // COP; positivo = crédito, negativo = débito
  balanceAfter: number;
  currency?: string;
  status?: WalletTxStatus;
  reference?: string;
  bank?: string;
  detail?: string;
  rejectReason?: string;
  createdAt?: string;
}

export interface BalanceResult {
  customerId: string;
  balance: number;
  currency: string;
  transactions: WalletTransaction[];
  count: number;
}

export interface AdminBalanceRow {
  customerId: string;
  company: string;
  companyTin?: string | number;
  balance: number;
  currency?: string;
  updatedAt?: string;
}

/** Movimiento del ledger global enriquecido con la empresa (vista admin). */
export interface AdminWalletTransaction extends WalletTransaction {
  customerId: string;
  company: string;
}

export interface AdminBalancesResult {
  customers: AdminBalanceRow[];
  totals: { balance: number };
  recentTransactions: AdminWalletTransaction[];
  count: number;
}

export interface WompiTopupInit {
  reference: string;
  amountInCents: number;
  currency: string;
  publicKey: string;
  signatureIntegrity: string;
  redirectUrl?: string;
}

/** Datos para crear una solicitud de recarga manual (cliente). */
export interface ManualRequestPayload {
  amount: number;
  proofS3Path: string;   // key del comprobante ya subido a S3 (documentType=document)
  bank?: string;
  reference?: string;
  note?: string;
}

/** Solicitud de recarga manual en la bandeja del admin (con URL del comprobante). */
export interface ManualTopupRow {
  txId: string;
  customerId: string;
  company: string;
  amount: number;
  bank?: string;
  reference?: string;
  status: WalletTxStatus;
  rejectReason?: string;
  detail?: string;
  proofUrl?: string;
  createdAt?: string;
}

export const balanceService = {
  /** Saldo + historial del cliente autenticado (el tenant sale del token). */
  get: (limit?: number): Promise<ApiResponse<BalanceResult>> =>
    apiPost(BALANCE_ENDPOINTS.GET, limit ? { limit } : {}),

  /** Ajuste/crédito DIRECTO de saldo de un cliente (ADMIN). */
  topupManual: (
    customerId: string,
    amount: number,
    note?: string,
  ): Promise<ApiResponse<{ balance: number; txId: string; amount: number }>> =>
    apiPost(BALANCE_ENDPOINTS.TOPUP_MANUAL, { customerId, amount, note }),

  /** Crea una SOLICITUD de recarga manual con comprobante (cliente). */
  topupManualRequest: (
    payload: ManualRequestPayload,
  ): Promise<ApiResponse<{ txId: string; status: string; amount: number }>> =>
    apiPost(BALANCE_ENDPOINTS.TOPUP_MANUAL_REQUEST, payload),

  /** Saldos de todos los clientes + movimientos recientes del ledger (ADMIN). */
  adminBalances: (): Promise<ApiResponse<AdminBalancesResult>> =>
    apiPost(BALANCE_ENDPOINTS.ADMIN_BALANCES, {}),

  /** Bandeja de solicitudes de recarga manual (ADMIN). */
  adminTopups: (
    status: 'pending' | 'approved' | 'declined' | 'all' = 'pending',
    month?: string,
  ): Promise<ApiResponse<{ topups: ManualTopupRow[]; count: number }>> =>
    apiPost(BALANCE_ENDPOINTS.ADMIN_TOPUPS, { status, month }),

  /** Aprueba una solicitud de recarga manual → acredita el saldo (ADMIN). */
  topupApprove: (txId: string): Promise<ApiResponse<{ balance?: number; status?: string }>> =>
    apiPost(BALANCE_ENDPOINTS.TOPUP_APPROVE, { txId }),

  /** Rechaza una solicitud de recarga manual con motivo (ADMIN). */
  topupReject: (txId: string, reason: string): Promise<ApiResponse<{ status?: string }>> =>
    apiPost(BALANCE_ENDPOINTS.TOPUP_REJECT, { txId, reason }),

  /** Inicia una recarga Wompi: devuelve la referencia + firma de integridad. */
  topupInit: (amount: number): Promise<ApiResponse<WompiTopupInit>> =>
    apiPost(BALANCE_ENDPOINTS.TOPUP_INIT, { amount }),
};

/** Etiqueta legible del tipo de movimiento. */
export const TX_LABEL: Record<WalletTxType, string> = {
  topup_manual: 'Recarga manual',
  topup_wompi: 'Recarga Wompi',
  debit_send: 'Envío',
  refund_send: 'Reembolso',
  adjustment: 'Ajuste',
};
