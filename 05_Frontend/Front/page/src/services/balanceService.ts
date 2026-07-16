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
  ADMIN_BALANCES: '/Admin/Balances',
  TOPUP_INIT: '/Balance/Topup-init',
};

export type WalletTxType = 'topup_manual' | 'topup_wompi' | 'debit' | 'refund';

export interface WalletTransaction {
  txId: string;
  type: WalletTxType;
  amount: number;        // COP; positivo = crédito, negativo = débito
  balanceAfter: number;
  currency?: string;
  status?: string;
  reference?: string;
  detail?: string;
  date?: string;
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

export const balanceService = {
  /** Saldo + historial del cliente autenticado (el tenant sale del token). */
  get: (limit?: number): Promise<ApiResponse<BalanceResult>> =>
    apiPost(BALANCE_ENDPOINTS.GET, limit ? { limit } : {}),

  /** Recarga manual de un cliente (ADMIN). */
  topupManual: (
    customerId: string,
    amount: number,
    note?: string,
  ): Promise<ApiResponse<{ balance: number; txId: string; amount: number }>> =>
    apiPost(BALANCE_ENDPOINTS.TOPUP_MANUAL, { customerId, amount, note }),

  /** Saldos de todos los clientes + movimientos recientes del ledger (ADMIN). */
  adminBalances: (): Promise<ApiResponse<AdminBalancesResult>> =>
    apiPost(BALANCE_ENDPOINTS.ADMIN_BALANCES, {}),

  /** Inicia una recarga Wompi: devuelve la referencia + firma de integridad (Fase 2). */
  topupInit: (amount: number): Promise<ApiResponse<WompiTopupInit>> =>
    apiPost(BALANCE_ENDPOINTS.TOPUP_INIT, { amount }),
};

/** Etiqueta legible del tipo de movimiento. */
export const TX_LABEL: Record<WalletTxType, string> = {
  topup_manual: 'Recarga manual',
  topup_wompi: 'Recarga Wompi',
  debit: 'Envío',
  refund: 'Reembolso',
};
