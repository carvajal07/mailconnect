import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getUser } from '../services/authService';
import { isOk } from '../services/apiClient';
import { campaignsService, type CampaignSummary } from '../services/campaignsService';
import { databaseService, type DatabaseFile } from '../services/databaseService';
import { statsService } from '../services/statsService';
import { blacklistService, type BlacklistItem } from '../services/blacklistService';
import { messageTemplatesService, type MessageTemplate } from '../services/messageTemplatesService';
import type { CampaignStat } from '../components/portal/campaignData';
import { readCache, writeCache } from '../services/portalCache';

/**
 * Contexto de datos del portal (Capa 1: precarga + caché Stale-While-Revalidate).
 *
 * Al montar (justo tras el login, al entrar a /panel):
 *  1. HIDRATA cada dataset desde sessionStorage (caché por cliente) → la UI pinta al
 *     instante, incluso tras recargar la página.
 *  2. REFRESCA en segundo plano solo lo que esté "viejo" (TTL en portalCache), sin
 *     bloquear la vista si ya hay datos cacheados.
 * Cada sección consume de aquí (usePortalData) y puede refrescar su parte. La caché se
 * limpia en logout (authService.clearSession → clearPortalCache).
 */

interface Dataset<T> {
  items: T[];
  loading: boolean;
  loaded: boolean;
  error: string;
}

interface PortalData {
  campaigns: Dataset<CampaignSummary>;
  databases: Dataset<DatabaseFile>;
  stats: Dataset<CampaignStat>;
  blacklist: Dataset<BlacklistItem>;
  messageTemplates: Dataset<MessageTemplate>;
  refreshCampaigns: () => Promise<void>;
  refreshDatabases: () => Promise<void>;
  refreshStats: () => Promise<void>;
  refreshBlacklist: () => Promise<void>;
  refreshMessageTemplates: () => Promise<void>;
}

const emptyDataset = <T,>(): Dataset<T> => ({ items: [], loading: false, loaded: false, error: '' });

// Nombres de caché por dataset (la clave real incluye el customerId).
const CK = {
  campaigns: 'campaigns',
  databases: 'databases',
  stats: 'stats',
  blacklist: 'blacklist',
  messageTemplates: 'messageTemplates',
} as const;

/** Estado inicial de un dataset: hidratado desde la caché si existe. */
const initDataset = <T,>(customerId: string, name: string): Dataset<T> => {
  const cached = readCache<T[]>(customerId, name);
  return cached
    ? { items: cached.data, loading: false, loaded: true, error: '' }
    : emptyDataset<T>();
};

const PortalDataContext = createContext<PortalData | null>(null);

export const PortalDataProvider = ({ children }: { children: ReactNode }) => {
  const customerId = getUser()?.customerId ?? '';
  const customer = getUser()?.customer ?? '';

  const [campaigns, setCampaigns] = useState<Dataset<CampaignSummary>>(() => initDataset(customerId, CK.campaigns));
  const [databases, setDatabases] = useState<Dataset<DatabaseFile>>(() => initDataset(customerId, CK.databases));
  const [stats, setStats] = useState<Dataset<CampaignStat>>(() => initDataset(customerId, CK.stats));
  const [blacklist, setBlacklist] = useState<Dataset<BlacklistItem>>(() => initDataset(customerId, CK.blacklist));
  const [messageTemplates, setMessageTemplates] = useState<Dataset<MessageTemplate>>(() => initDataset(customerId, CK.messageTemplates));

  const refreshCampaigns = useCallback(async () => {
    if (!customerId) return;
    // No mostrar spinner si ya hay datos cacheados (refresco silencioso SWR).
    setCampaigns((d) => ({ ...d, loading: d.items.length === 0, error: '' }));
    const res = await campaignsService.list(customerId);
    const items = isOk(res) && res.data?.campaigns ? res.data.campaigns : [];
    if (isOk(res)) writeCache(customerId, CK.campaigns, items);
    setCampaigns({
      items,
      loading: false,
      loaded: true,
      error: isOk(res) ? '' : res.description || 'No se pudieron cargar las campañas.',
    });
  }, [customerId]);

  const refreshDatabases = useCallback(async () => {
    if (!customerId && !customer) return;
    setDatabases((d) => ({ ...d, loading: d.items.length === 0, error: '' }));
    const res = await databaseService.list(customerId, customer);
    const items = isOk(res) && res.data?.files ? res.data.files : [];
    if (isOk(res)) writeCache(customerId, CK.databases, items);
    setDatabases({
      items,
      loading: false,
      loaded: true,
      error: isOk(res) ? '' : res.description || 'No se pudieron cargar las bases de datos.',
    });
  }, [customerId, customer]);

  const refreshStats = useCallback(async () => {
    if (!customerId || !customer) return;
    setStats((d) => ({ ...d, loading: d.items.length === 0, error: '' }));
    const res = await statsService.statistics(customerId, customer);
    const items = isOk(res) && res.data?.campaigns ? res.data.campaigns : [];
    if (isOk(res)) writeCache(customerId, CK.stats, items);
    setStats({
      items,
      loading: false,
      loaded: true,
      error: isOk(res) ? '' : res.description || 'No se pudieron cargar las estadísticas.',
    });
  }, [customerId, customer]);

  const refreshBlacklist = useCallback(async () => {
    if (!customerId && !customer) return;
    setBlacklist((d) => ({ ...d, loading: d.items.length === 0, error: '' }));
    const res = await blacklistService.list(customerId, customer);
    const items = isOk(res) && res.data?.items ? res.data.items : [];
    if (isOk(res)) writeCache(customerId, CK.blacklist, items);
    setBlacklist({
      items,
      loading: false,
      loaded: true,
      error: isOk(res) ? '' : res.description || 'No se pudo cargar la lista negra.',
    });
  }, [customerId, customer]);

  const refreshMessageTemplates = useCallback(async () => {
    if (!customerId) return;
    setMessageTemplates((d) => ({ ...d, loading: d.items.length === 0, error: '' }));
    const res = await messageTemplatesService.list(customerId);
    const items = isOk(res) && res.data?.templates ? res.data.templates : [];
    if (isOk(res)) writeCache(customerId, CK.messageTemplates, items);
    setMessageTemplates({
      items,
      loading: false,
      loaded: true,
      error: isOk(res) ? '' : res.description || 'No se pudieron cargar las plantillas de mensaje.',
    });
  }, [customerId]);

  // Precarga al montar el portal: refresca en segundo plano solo lo que esté viejo
  // (la caché fresca ya hidrató el estado inicial, así que no se re-pide).
  useEffect(() => {
    const stale = (name: string) => {
      const c = readCache(customerId, name);
      return !c || !c.fresh;
    };
    if (stale(CK.campaigns)) refreshCampaigns();
    if (stale(CK.databases)) refreshDatabases();
    if (stale(CK.stats)) refreshStats();
    if (stale(CK.blacklist)) refreshBlacklist();
    if (stale(CK.messageTemplates)) refreshMessageTemplates();
  }, [customerId, refreshCampaigns, refreshDatabases, refreshStats, refreshBlacklist, refreshMessageTemplates]);

  const value = useMemo<PortalData>(
    () => ({
      campaigns, databases, stats, blacklist, messageTemplates,
      refreshCampaigns, refreshDatabases, refreshStats, refreshBlacklist, refreshMessageTemplates,
    }),
    [
      campaigns, databases, stats, blacklist, messageTemplates,
      refreshCampaigns, refreshDatabases, refreshStats, refreshBlacklist, refreshMessageTemplates,
    ],
  );

  return <PortalDataContext.Provider value={value}>{children}</PortalDataContext.Provider>;
};

/** Acceso a los datos precargados del portal. */
export const usePortalData = (): PortalData => {
  const ctx = useContext(PortalDataContext);
  if (!ctx) throw new Error('usePortalData debe usarse dentro de <PortalDataProvider>');
  return ctx;
};
