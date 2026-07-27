import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  InputAdornment,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import SupportAgentIcon from '@mui/icons-material/SupportAgent';
import SearchIcon from '@mui/icons-material/Search';
import DnsIcon from '@mui/icons-material/Dns';
import DescriptionIcon from '@mui/icons-material/Description';
import PersonSearchIcon from '@mui/icons-material/PersonSearch';
import { customerService, type CustomerSummary } from '../../services/customerService';
import { supportService } from '../../services/supportService';
import type { RecipientLookupData, SesTemplateRow, GlobalDomainRow } from '../../services/supportService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { formatDateTime } from '../../utils/datetime';

/**
 * SOPORTE (admin): la caja de herramientas del día a día.
 *  - Buscar destinatario: "¿qué le llegó a fulano@x.com?" → línea de tiempo completa.
 *  - Dominios remitentes: los senderDomain de TODOS los clientes con su estado.
 *  - Plantillas SES: listado GLOBAL (no solo lo creado en la sesión).
 * Las acciones sobre usuarios (reenviar activación, forzar reseteo, cerrar sesiones)
 * viven en la FICHA del cliente (sección Clientes).
 */

const STATE_COLOR: Record<number, 'default' | 'success' | 'error' | 'warning' | 'info'> = {
  1: 'info', 2: 'success', 3: 'error', 4: 'success', 5: 'success',
  6: 'error', 7: 'error', 8: 'error', 9: 'warning', 11: 'error',
};

const DOMAIN_STATUS: Record<string, { label: string; color: 'success' | 'warning' | 'error' }> = {
  verified: { label: 'Verificado', color: 'success' },
  pending: { label: 'Pendiente', color: 'warning' },
  failed: { label: 'Falló', color: 'error' },
};

export const SoporteSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  const [tab, setTab] = useState(0);

  // ── Buscar destinatario ──
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [customer, setCustomer] = useState<CustomerSummary | null>(null);
  const [contact, setContact] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<RecipientLookupData | null>(null);

  // ── Dominios globales ──
  const [domains, setDomains] = useState<GlobalDomainRow[] | null>(null);

  // ── Plantillas SES globales ──
  const [templates, setTemplates] = useState<SesTemplateRow[] | null>(null);
  const [templateFilter, setTemplateFilter] = useState('');
  const [tplPage, setTplPage] = useState(0);
  const [tplRows, setTplRows] = useState(25);

  useEffect(() => {
    void (async () => {
      const res = await customerService.list();
      if (isOk(res)) setCustomers(res.data?.customers ?? []);
    })();
  }, []);

  // Carga perezosa por pestaña (dominios/plantillas solo al entrar).
  useEffect(() => {
    if (tab === 1 && domains === null) {
      void (async () => {
        const res = await supportService.listDomains();
        if (isOk(res)) setDomains(res.data?.domains ?? []);
        else notify(res.description || 'No se pudieron cargar los dominios.', 'error');
      })();
    }
    if (tab === 2 && templates === null) {
      void (async () => {
        const res = await supportService.listTemplates();
        if (isOk(res)) setTemplates(res.data?.templates ?? []);
        else notify(res.description || 'No se pudieron cargar las plantillas.', 'error');
      })();
    }
  }, [tab, domains, templates, notify]);

  const search = async () => {
    if (!customer || !contact.trim()) {
      notify('Elige el cliente y escribe el correo o celular a buscar.', 'warning');
      return;
    }
    setSearching(true);
    setResult(null);
    const res = await supportService.recipientLookup(customer.customerId, contact.trim());
    setSearching(false);
    if (isOk(res) && res.data) setResult(res.data);
    else notify(res.description || 'No se pudo consultar el contacto.', 'error');
  };

  const filteredTemplates = useMemo(() => {
    const q = templateFilter.trim().toLowerCase();
    const list = templates ?? [];
    return q ? list.filter((t) => t.name.toLowerCase().includes(q)) : list;
  }, [templates, templateFilter]);

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <SupportAgentIcon color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>Soporte</Typography>
      </Stack>

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab icon={<PersonSearchIcon />} iconPosition="start" label="Buscar destinatario" />
        <Tab icon={<DnsIcon />} iconPosition="start" label="Dominios remitentes" />
        <Tab icon={<DescriptionIcon />} iconPosition="start" label="Plantillas SES" />
      </Tabs>

      {/* ── Tab 1: buscar destinatario ── */}
      {tab === 0 && (
        <Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
            <Autocomplete
              options={customers}
              value={customer}
              onChange={(_, v) => setCustomer(v)}
              getOptionLabel={(c) => c.company || c.customerId}
              isOptionEqualToValue={(a, b) => a.customerId === b.customerId}
              sx={{ minWidth: 260 }}
              renderInput={(p) => <TextField {...p} label="Cliente" size="small" />}
            />
            <TextField
              size="small"
              fullWidth
              label="Correo o celular del destinatario"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void search(); }}
              InputProps={{ startAdornment: (
                <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>) }}
            />
            <Button variant="contained" onClick={() => void search()} disabled={searching}
                    sx={{ minWidth: 120 }}>
              {searching ? <CircularProgress size={22} /> : 'Buscar'}
            </Button>
          </Stack>

          {result && (
            <>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
                <Chip label={`${result.company} · ${result.contact}`} />
                <Chip label={`${result.count} evento(s)`} variant="outlined" />
                {result.lists.blacklisted && <Chip color="error" label="En lista negra" />}
                {result.lists.unsubscribed && <Chip color="warning" label="Desuscrito" />}
                {result.truncated && <Chip variant="outlined" label="resultado parcial" />}
              </Stack>
              {result.timeline.length === 0 ? (
                <Alert severity="info">No hay envíos registrados para ese contacto en este cliente.</Alert>
              ) : (
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Fecha</TableCell>
                        <TableCell>Campaña</TableCell>
                        <TableCell>Canal</TableCell>
                        <TableCell>Estado</TableCell>
                        <TableCell>Detalle</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {result.timeline.map((t, i) => (
                        <TableRow key={i} hover>
                          <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(t.date)}</TableCell>
                          <TableCell>{t.campaignName || t.processId}</TableCell>
                          <TableCell><Chip size="small" variant="outlined" label={t.channel || '—'} /></TableCell>
                          <TableCell>
                            <Chip size="small" color={STATE_COLOR[t.state] ?? 'default'} label={t.stateLabel} />
                          </TableCell>
                          <TableCell>
                            <Typography variant="caption" color="text.secondary">{t.detail || '—'}</Typography>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </>
          )}
        </Box>
      )}

      {/* ── Tab 2: dominios remitentes globales ── */}
      {tab === 1 && (
        domains === null ? <CircularProgress size={26} /> : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Cliente</TableCell>
                  <TableCell>Tipo</TableCell>
                  <TableCell>Dominio / correo</TableCell>
                  <TableCell>Estado</TableCell>
                  <TableCell>Creado</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {domains.length === 0 && (
                  <TableRow><TableCell colSpan={5} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                    Ningún cliente ha registrado dominios o correos remitentes.
                  </TableCell></TableRow>
                )}
                {domains.map((d) => {
                  const meta = DOMAIN_STATUS[d.status] ?? DOMAIN_STATUS.pending;
                  return (
                    <TableRow key={d.domainId} hover>
                      <TableCell>{d.company || d.customerId}</TableCell>
                      <TableCell>
                        <Chip size="small" variant="outlined" label={d.kind === 'email' ? 'Correo' : 'Dominio'} />
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{d.domain}</TableCell>
                      <TableCell><Chip size="small" color={meta.color} label={meta.label} /></TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDateTime(d.createdAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )
      )}

      {/* ── Tab 3: plantillas SES globales ── */}
      {tab === 2 && (
        templates === null ? <CircularProgress size={26} /> : (
          <Box>
            <TextField
              size="small"
              label="Filtrar por nombre"
              value={templateFilter}
              onChange={(e) => { setTemplateFilter(e.target.value); setTplPage(0); }}
              sx={{ mb: 1.5, minWidth: 280 }}
            />
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Cliente (prefijo)</TableCell>
                    <TableCell>Plantilla</TableCell>
                    <TableCell>Creada</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredTemplates.length === 0 && (
                    <TableRow><TableCell colSpan={3} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                      Sin plantillas para el filtro.
                    </TableCell></TableRow>
                  )}
                  {filteredTemplates
                    .slice(tplPage * tplRows, tplPage * tplRows + tplRows)
                    .map((t) => (
                      <TableRow key={t.name} hover>
                        <TableCell><Chip size="small" variant="outlined" label={t.customerPrefix || '—'} /></TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>{t.name}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>{t.createdAt ? formatDateTime(t.createdAt) : '—'}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              {filteredTemplates.length > 10 && (
                <TablePagination
                  component="div"
                  count={filteredTemplates.length}
                  page={tplPage}
                  onPageChange={(_, p) => setTplPage(p)}
                  rowsPerPage={tplRows}
                  onRowsPerPageChange={(e) => { setTplRows(parseInt(e.target.value, 10)); setTplPage(0); }}
                  rowsPerPageOptions={[10, 25, 50, 100]}
                  labelRowsPerPage="Filas por página"
                  labelDisplayedRows={({ from, to, count }) => `${from}–${to} de ${count}`}
                />
              )}
            </TableContainer>
          </Box>
        )
      )}

      {FeedbackSnackbar}
    </Box>
  );
};
