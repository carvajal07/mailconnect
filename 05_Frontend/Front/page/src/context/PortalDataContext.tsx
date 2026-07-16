import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getUser, isAdmin } from '../services/authService';
import { isOk } from '../services/apiClient';
import { campaignsService, type CampaignSummary } from '../services/campaignsService';
import { databaseService, type DatabaseFile } from '../services/databaseService';
import { statsService } from '../services/statsService';
import { blacklistService, type BlacklistItem } from '../services/blacklistService';
import { messageTemplatesService, type MessageTemplate } from '../services/messageTemplatesService';
import { customerService, type CustomerSummary } from '../services/customerService';
import { balanceService, type WalletTransaction } from '../services/balanceService';
import type { CampaignStat } from '../components/portal/campaignData';
import { readCache, writeCache } from '../services/portalCache';
import { bootstrapService } from '../services/bootstrapService';

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

/** Saldo del monedero (cobro PREPAGO): un valor + el historial de movimientos. */
interface BalanceState {
  value: number;
  currency: string;
  transactions: WalletTransaction[];
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
  // Solo ADMIN: lista de clientes (para tabs Clientes/Facturación/Tarifas). En un
  // portal de cliente queda vacío (no se llama al endpoint admin).
  customers: Dataset<CustomerSummary>;
  // Saldo del monedero (se precarga tras el login; lo usan la sección Saldo y el gate
  // de "Enviar campaña real" en Muestras). No se cachea en sessionStorage: el saldo
  // debe leerse fresco (una lectura vieja "suficiente" podría engañar al gate).
  balance: BalanceState;
  refreshCampaigns: () => Promise<void>;
  refreshDatabases: () => Promise<void>;
  refreshStats: () => Promise<void>;
  refreshBlacklist: () => Promise<void>;
  refreshMessageTemplates: () => Promise<void>;
  refreshCustomers: () => Promise<void>;
  refreshBalance: () => Promise<void>;
}

const emptyDataset = <T,>(): Dataset<T> => ({ items: [], loading: false, loaded: false, error: '' });
const emptyBalance = (): BalanceState => ({ value: 0, currency: 'COP', transactions: [], loading: false, loaded: false, error: '' });

// Nombres de caché por dataset (la clave real incluye el customerId).
const CK = {
  campaigns: 'campaigns',
  databases: 'databases',
  stats: 'stats',
  blacklist: 'blacklist',
  messageTemplates: 'messageTemplates',
  customers: 'customers',
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
  const [customers, setCustomers] = useState<Dataset<CustomerSummary>>(() => initDataset(customerId, CK.customers));
  const [balance, setBalance] = useState<BalanceState>(emptyBalance);
  const admin = isAdmin(getUser());

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

  // Saldo del monedero (endpoint /Balance/Get). Se lee fresco (sin caché) para que el
  // gate de "Enviar campaña real" no use un saldo viejo.
  const refreshBalance = useCallback(async () => {
    if (!customerId) return;
    setBalance((d) => ({ ...d, loading: !d.loaded, error: '' }));
    const res = await balanceService.get();
    const ok = isOk(res) && !!res.data;
    setBalance({
      value: ok ? res.data!.balance : 0,
      currency: ok ? res.data!.currency : 'COP',
      transactions: ok ? res.data!.transactions ?? [] : [],
      loading: false,
      loaded: true,
      error: isOk(res) ? '' : res.description || 'No se pudo cargar el saldo.',
    });
  }, [customerId]);

  // Solo ADMIN: lista de clientes (endpoint /Customer/List). Un cliente normal no la
  // pide (evita 403 innecesarios). Se precarga tras el login como el resto.
  const refreshCustomers = useCallback(async () => {
    if (!admin) return;
    setCustomers((d) => ({ ...d, loading: d.items.length === 0, error: '' }));
    const res = await customerService.list();
    const items = isOk(res) && res.data?.customers ? res.data.customers : [];
    if (isOk(res)) writeCache(customerId, CK.customers, items);
    setCustomers({
      items,
      loading: false,
      loaded: true,
      error: isOk(res) ? '' : res.description || 'No se pudieron cargar los clientes.',
    });
  }, [admin, customerId]);

  // Capa 2: una sola llamada de arranque (/Portal/Bootstrap) llena los 4 datasets
  // ligeros de golpe. Devuelve false si el endpoint no está desplegado o falla,
  // para caer a los refrescos individuales (degradación elegante durante el rollout).
  const hydrateFromBootstrap = useCallback(async (): Promise<boolean> => {
    if (!customerId) return false;
    const res = await bootstrapService.load();
    if (!isOk(res) || !res.data) return false;
    const d = res.data;
    const campaignsItems = d.campaigns ?? [];
    const databasesItems = d.databases ?? [];
    const blacklistItems = d.blacklist ?? [];
    const templatesItems = d.messageTemplates ?? [];
    writeCache(customerId, CK.campaigns, campaignsItems);
    writeCache(customerId, CK.databases, databasesItems);
    writeCache(customerId, CK.blacklist, blacklistItems);
    writeCache(customerId, CK.messageTemplates, templatesItems);
    setCampaigns({ items: campaignsItems, loading: false, loaded: true, error: '' });
    setDatabases({ items: databasesItems, loading: false, loaded: true, error: '' });
    setBlacklist({ items: blacklistItems, loading: false, loaded: true, error: '' });
    setMessageTemplates({ items: templatesItems, loading: false, loaded: true, error: '' });
    // Estadísticas: si el bootstrap las trae, se usan; si no (versión vieja del
    // endpoint), se cargan aparte.
    if (d.stats) {
      writeCache(customerId, CK.stats, d.stats);
      setStats({ items: d.stats, loading: false, loaded: true, error: '' });
    } else {
      refreshStats();
    }
    return true;
  }, [customerId, refreshStats]);

  // Precarga al montar el portal: refresca en segundo plano solo lo que esté viejo
  // (la caché fresca ya hidrató el estado inicial, así que no se re-pide).
  useEffect(() => {
    const stale = (name: string) => {
      const c = readCache(customerId, name);
      return !c || !c.fresh;
    };
    const anyStale =
      stale(CK.campaigns) || stale(CK.databases) || stale(CK.blacklist) ||
      stale(CK.messageTemplates) || stale(CK.stats);
    if (anyStale) {
      // 1 sola request de arranque (incluye estadísticas). Si el endpoint no está
      // disponible, cae a los refrescos individuales.
      hydrateFromBootstrap().then((ok) => {
        if (ok) return;
        if (stale(CK.campaigns)) refreshCampaigns();
        if (stale(CK.databases)) refreshDatabases();
        if (stale(CK.blacklist)) refreshBlacklist();
        if (stale(CK.messageTemplates)) refreshMessageTemplates();
        if (stale(CK.stats)) refreshStats();
      });
    }
    // ADMIN: precargar la lista de clientes tras el login (la usan varios tabs del
    // panel). El Bootstrap del cliente no la incluye, así que va por su cuenta.
    if (admin && stale(CK.customers)) refreshCustomers();
    // Saldo del monedero: se precarga siempre (todos los usuarios tienen customerId).
    if (customerId) refreshBalance();
  }, [customerId, admin, hydrateFromBootstrap, refreshCampaigns, refreshDatabases, refreshStats, refreshBlacklist, refreshMessageTemplates, refreshCustomers, refreshBalance]);

  const value = useMemo<PortalData>(
    () => ({
      campaigns, databases, stats, blacklist, messageTemplates, customers, balance,
      refreshCampaigns, refreshDatabases, refreshStats, refreshBlacklist, refreshMessageTemplates, refreshCustomers, refreshBalance,
    }),
    [
      campaigns, databases, stats, blacklist, messageTemplates, customers, balance,
      refreshCampaigns, refreshDatabases, refreshStats, refreshBlacklist, refreshMessageTemplates, refreshCustomers, refreshBalance,
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
