import { apiPost } from './apiClient';
import type { ApiResponse } from './apiClient';

/**
 * Servicio ADMIN de FACTURACIÓN / consumo. Convierte los envíos reales en un valor
 * a facturar aplicando la tabla de tarifas (pricingRate). Resumen operativo, no fiscal.
 *
 * Endpoint (no-proxy, envelope estándar):
 *  - POST /Billing/Summary -> 200 { data: { customers, totals, ... } }
 *
 * ⚠️ Endpoint administrativo: restringir a rol admin en el despliegue.
 */

export const BILLING_ENDPOINTS = {
  SUMMARY: '/Billing/Summary',
};

export interface BillingChannelRow {
  channel: string;
  label: string;
  sent: number;
  unitCost: number;
  amount: number;
}

export interface BillingCustomerRow {
  customerId: string;
  company: string;
  companyTin?: string | number;
  totalSent: number;
  subtotal: number;
  tax: number;
  total: number;
  byChannel: BillingChannelRow[];
}

export interface BillingTotals {
  totalSent: number;
  subtotal: number;
  tax: number;
  total: number;
}

export interface BillingSummaryData {
  currency: string;
  month: string;
  customers: BillingCustomerRow[];
  totals: BillingTotals;
  truncated?: boolean;
  note?: string;
}

export const billingService = {
  /** Resumen de facturación. month='YYYY-MM' (opcional), customerId (opcional). */
  summary: (month?: string, customerId?: string): Promise<ApiResponse<BillingSummaryData>> =>
    apiPost(BILLING_ENDPOINTS.SUMMARY, {
      ...(month ? { month } : {}),
      ...(customerId ? { customerId } : {}),
    }),
};
