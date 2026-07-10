import { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getUser } from '../services/authService';
import { isOk } from '../services/apiClient';
import { campaignsService, type CampaignSummary } from '../services/campaignsService';
import { databaseService, type DatabaseFile } from '../services/databaseService';
import { statsService } from '../services/statsService';
import type { CampaignStat } from '../components/portal/campaignData';

/**
 * Contexto de datos del portal. Al montar (justo tras el login, cuando se entra a
 * /panel) precarga en paralelo campañas, bases de datos y estadísticas, de modo que
 * cuando el cliente abre cada tab la data ya está lista. Cada sección consume de
 * aquí y puede refrescar su parte.
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
  refreshCampaigns: () => Promise<void>;
  refreshDatabases: () => Promise<void>;
  refreshStats: () => Promise<void>;
}

const emptyDataset = <T,>(): Dataset<T> => ({ items: [], loading: false, loaded: false, error: '' });

const PortalDataContext = createContext<PortalData | null>(null);

export const PortalDataProvider = ({ children }: { children: ReactNode }) => {
  const customerId = getUser()?.customerId ?? '';
  const customer = getUser()?.customer ?? '';

  const [campaigns, setCampaigns] = useState<Dataset<CampaignSummary>>(emptyDataset());
  const [databases, setDatabases] = useState<Dataset<DatabaseFile>>(emptyDataset());
  const [stats, setStats] = useState<Dataset<CampaignStat>>(emptyDataset());

  const refreshCampaigns = useCallback(async () => {
    if (!customerId) return;
    setCampaigns((d) => ({ ...d, loading: true, error: '' }));
    const res = await campaignsService.list(customerId);
    setCampaigns({
      items: isOk(res) && res.data?.campaigns ? res.data.campaigns : [],
      loading: false,
      loaded: true,
      error: isOk(res) ? '' : res.description || 'No se pudieron cargar las campañas.',
    });
  }, [customerId]);

  const refreshDatabases = useCallback(async () => {
    if (!customerId && !customer) return;
    setDatabases((d) => ({ ...d, loading: true, error: '' }));
    const res = await databaseService.list(customerId, customer);
    setDatabases({
      items: isOk(res) && res.data?.files ? res.data.files : [],
      loading: false,
      loaded: true,
      error: isOk(res) ? '' : res.description || 'No se pudieron cargar las bases de datos.',
    });
  }, [customerId, customer]);

  const refreshStats = useCallback(async () => {
    if (!customerId || !customer) return;
    setStats((d) => ({ ...d, loading: true, error: '' }));
    const res = await statsService.statistics(customerId, customer);
    setStats({
      items: isOk(res) && res.data?.campaigns ? res.data.campaigns : [],
      loading: false,
      loaded: true,
      error: isOk(res) ? '' : res.description || 'No se pudieron cargar las estadísticas.',
    });
  }, [customerId, customer]);

  // Precarga al montar el portal (una vez).
  useEffect(() => {
    refreshCampaigns();
    refreshDatabases();
    refreshStats();
  }, [refreshCampaigns, refreshDatabases, refreshStats]);

  const value = useMemo<PortalData>(
    () => ({ campaigns, databases, stats, refreshCampaigns, refreshDatabases, refreshStats }),
    [campaigns, databases, stats, refreshCampaigns, refreshDatabases, refreshStats],
  );

  return <PortalDataContext.Provider value={value}>{children}</PortalDataContext.Provider>;
};

/** Acceso a los datos precargados del portal. */
export const usePortalData = (): PortalData => {
  const ctx = useContext(PortalDataContext);
  if (!ctx) throw new Error('usePortalData debe usarse dentro de <PortalDataProvider>');
  return ctx;
};
