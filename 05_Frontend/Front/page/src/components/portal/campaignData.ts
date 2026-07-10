/**
 * Datos de campañas compartidos por Estadísticas y Reportes.
 *
 * Hoy son ILUSTRATIVOS (demo). Cuando el backend exponga métricas agregadas
 * (p. ej. Api_V1_Agent_Reports: status_summary / open_rate / campaign_comparison),
 * un servicio reemplazará `DEMO_CAMPAIGNS` por la respuesta real con la misma forma.
 */

export type Estado = 'pendiente' | 'creada' | 'enviada';

export interface CampaignStat {
  id: string;
  name: string;
  estado: Estado;
  /** Estado real de la campaña en el backend (Pendiente/Muestras/Enviando/…). */
  rawState?: string;
  enviados: number;
  entregados: number;
  abiertos: number;
  clics: number;
  rebotes: number;
  quejas: number;
}

export const ESTADO_LABEL: Record<Estado, string> = {
  pendiente: 'Pendiente',
  creada: 'Creada',
  enviada: 'Enviada',
};

export const DEMO_CAMPAIGNS: CampaignStat[] = [
  { id: '1', name: 'Bienvenida Julio', estado: 'enviada', enviados: 12450, entregados: 12010, abiertos: 5220, clics: 1310, rebotes: 440, quejas: 12 },
  { id: '2', name: 'Promo Aniversario', estado: 'enviada', enviados: 8300, entregados: 8110, abiertos: 3980, clics: 990, rebotes: 190, quejas: 6 },
  { id: '3', name: 'Newsletter Agosto', estado: 'enviada', enviados: 15600, entregados: 15020, abiertos: 6110, clics: 1420, rebotes: 580, quejas: 21 },
  { id: '4', name: 'Reactivación clientes', estado: 'creada', enviados: 0, entregados: 0, abiertos: 0, clics: 0, rebotes: 0, quejas: 0 },
  { id: '5', name: 'Encuesta satisfacción', estado: 'creada', enviados: 0, entregados: 0, abiertos: 0, clics: 0, rebotes: 0, quejas: 0 },
  { id: '6', name: 'Lanzamiento producto', estado: 'pendiente', enviados: 0, entregados: 0, abiertos: 0, clics: 0, rebotes: 0, quejas: 0 },
];

export const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);
