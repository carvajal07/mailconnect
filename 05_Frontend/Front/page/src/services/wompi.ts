/**
 * Carga perezosa del Widget de Wompi (checkout.wompi.co/widget.js) y tipos del checkout.
 *
 * El script se inyecta UNA sola vez (memoizado). El pago lo abre el Widget con la
 * referencia + firma de integridad que devuelve /Balance/Topup-init; el saldo NO se
 * acredita aquí sino en el webhook firmado (el resultado del widget es solo informativo).
 */
const WOMPI_WIDGET_SRC = 'https://checkout.wompi.co/widget.js';

export interface WompiTransactionResult {
  transaction?: {
    id: string;
    status: string; // APPROVED | DECLINED | VOIDED | ERROR | PENDING
    reference: string;
    amountInCents?: number;
  };
}

export interface WidgetCheckoutConfig {
  currency: string;
  amountInCents: number;
  reference: string;
  publicKey: string;
  signature: { integrity: string };
  redirectUrl?: string;
}

export interface WidgetCheckoutInstance {
  open: (callback: (result: WompiTransactionResult) => void) => void;
}

export type WidgetCheckoutCtor = new (config: WidgetCheckoutConfig) => WidgetCheckoutInstance;

declare global {
  interface Window {
    WidgetCheckout?: WidgetCheckoutCtor;
  }
}

let loadPromise: Promise<WidgetCheckoutCtor> | null = null;

/** Carga el Widget de Wompi (una vez) y resuelve con el constructor WidgetCheckout. */
export const loadWompiWidget = (): Promise<WidgetCheckoutCtor> => {
  if (window.WidgetCheckout) return Promise.resolve(window.WidgetCheckout);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = WOMPI_WIDGET_SRC;
    script.async = true;
    script.onload = () => {
      if (window.WidgetCheckout) resolve(window.WidgetCheckout);
      else reject(new Error('El widget de Wompi no se cargó correctamente.'));
    };
    script.onerror = () => {
      loadPromise = null; // permite reintentar
      reject(new Error('No se pudo cargar el widget de pagos. Verifica tu conexión.'));
    };
    document.head.appendChild(script);
  });
  return loadPromise;
};
