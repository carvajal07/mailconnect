import { useState } from 'react';
import {
  Box,
  Button,
  Paper,
  TextField,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Stack,
  InputAdornment,
  Chip,
  Switch,
  CircularProgress,
  Alert,
  Divider,
  Tooltip,
  Select,
  MenuItem,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import RefreshIcon from '@mui/icons-material/Refresh';
import ApartmentIcon from '@mui/icons-material/Apartment';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import PersonIcon from '@mui/icons-material/Person';
import { customerService } from '../../services/customerService';
import type { CustomerSummary, CustomerDetail, CustomerUser, UserRole, TenantRole } from '../../services/customerService';
import { isOk } from '../../services/apiClient';
import { formatDateTime } from '../../utils/datetime';
import { useFeedback } from '../../hooks/useFeedback';
import { useConfirm } from '../../hooks/useConfirm';
import { getUser } from '../../services/authService';
import { usePortalData } from '../../context/PortalDataContext';

/**
 * Sección admin: CLIENTES. Lista los clientes reales (customerService.list) y abre
 * la FICHA de cada uno: datos, toggle de envíos reales y los usuarios de la empresa,
 * con promover/degradar rol (admin ↔ client) sin tocar la consola de DynamoDB.
 */
export const ClientesSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  const { confirm, ConfirmDialog } = useConfirm();
  const me = getUser();

  // Clientes precargados en el login (contexto admin); no se re-piden al entrar al tab.
  const { customers: customersCtx, refreshCustomers } = usePortalData();
  const customers = customersCtx.items;
  const loading = customersCtx.loading;
  const error = customersCtx.error;
  const [search, setSearch] = useState('');

  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [savingSend, setSavingSend] = useState(false);
  const [roleBusy, setRoleBusy] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = refreshCustomers;

  /** Elimina un cliente (empresa) + sus cuentas. Confirmación fuerte; no purga el histórico. */
  const handleDelete = async (c: CustomerSummary) => {
    const ok = await confirm({
      title: 'Eliminar cliente',
      message: `¿Eliminar la empresa "${c.company}" y todas sus cuentas de usuario? No podrán volver `
        + `a iniciar sesión. El histórico (campañas, envíos, saldo) se conserva. Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar cliente',
      confirmColor: 'error',
    });
    if (!ok) return;
    setDeletingId(c.customerId);
    const res = await customerService.delete(c.customerId);
    setDeletingId(null);
    if (isOk(res)) {
      notify(`Cliente "${c.company}" eliminado.`, 'success');
      if (detail?.customer.customerId === c.customerId) closeFicha();
      refreshCustomers();
    } else {
      notify(res.description || 'No se pudo eliminar el cliente.', 'error');
    }
  };

  const openFicha = async (c: CustomerSummary) => {
    setOpen(true);
    setDetail(null);
    setDetailLoading(true);
    const res = await customerService.detail(c.customerId);
    setDetailLoading(false);
    if (isOk(res) && res.data) setDetail(res.data);
    else notify(res.description || 'No se pudo cargar la ficha.', 'error');
  };

  const closeFicha = () => {
    setOpen(false);
    setDetail(null);
  };

  const toggleSend = async () => {
    if (!detail) return;
    const next = !detail.customer.realSendEnabled;
    setSavingSend(true);
    const res = await customerService.setRealSendEnabled(detail.customer.customerId, next);
    setSavingSend(false);
    if (isOk(res)) {
      setDetail({ ...detail, customer: { ...detail.customer, realSendEnabled: next } });
      // Refresca la lista compartida (contexto) para reflejar el nuevo estado en la tabla.
      refreshCustomers();
      notify(`Envíos reales ${next ? 'habilitados' : 'deshabilitados'}.`, next ? 'success' : 'warning');
    } else {
      notify(res.description || 'No se pudo actualizar.', 'error');
    }
  };

  const changeRole = async (u: CustomerUser) => {
    if (!detail) return;
    const next: UserRole = u.role === 'admin' ? 'client' : 'admin';
    const ok = await confirm({
      title: next === 'admin' ? 'Promover a administrador' : 'Quitar administrador',
      message:
        next === 'admin'
          ? `¿Dar rol de administrador a ${u.email}? Podrá gestionar clientes, tarifas y configuración global.`
          : `¿Quitar el rol de administrador a ${u.email}? Volverá a ser usuario cliente.`,
      confirmText: next === 'admin' ? 'Promover' : 'Degradar',
      confirmColor: next === 'admin' ? 'primary' : 'error',
    });
    if (!ok) return;
    setRoleBusy(u.userId);
    const res = await customerService.setUserRole(u.userId, next);
    setRoleBusy(null);
    if (isOk(res)) {
      setDetail({ ...detail, users: detail.users.map((x) => (x.userId === u.userId ? { ...x, role: next } : x)) });
      notify(`Rol actualizado a ${next === 'admin' ? 'administrador' : 'cliente'}.`, 'success');
    } else {
      notify(res.description || 'No se pudo cambiar el rol.', 'error');
    }
  };

  /** Cambia el sub-rol de empresa (owner|approver|operator) de un usuario. */
  const changeTenantRole = async (u: CustomerUser, next: TenantRole) => {
    if (!detail || next === (u.tenantRole ?? 'owner')) return;
    setRoleBusy(u.userId);
    const res = await customerService.setTenantRole(u.userId, next);
    setRoleBusy(null);
    if (isOk(res)) {
      setDetail({ ...detail, users: detail.users.map((x) => (x.userId === u.userId ? { ...x, tenantRole: next } : x)) });
      notify(`Sub-rol actualizado a ${next}.`, 'success');
    } else {
      notify(res.description || 'No se pudo cambiar el sub-rol.', 'error');
    }
  };

  const filtered = customers.filter((c) =>
    `${c.company} ${c.companyTin ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" useFlexGap>
        <Typography variant="h4">Clientes</Typography>
        <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
          Refrescar
        </Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Empresas registradas en la plataforma. Abre la <strong>ficha</strong> para ver sus
        usuarios, habilitar/deshabilitar envíos reales y promover administradores.
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" size="small" onClick={load}>Reintentar</Button>}>
          {error}
        </Alert>
      )}

      <Paper sx={{ p: 2, mb: 2 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="Buscar por empresa o NIT…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon /></InputAdornment>) }}
        />
      </Paper>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Empresa</TableCell>
              <TableCell>NIT</TableCell>
              <TableCell>Envíos reales</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && customers.length === 0 && (
              <TableRow><TableCell colSpan={4} align="center" sx={{ py: 4 }}><CircularProgress size={26} /></TableCell></TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  {customers.length === 0 ? 'No hay clientes registrados.' : 'Sin resultados para la búsqueda.'}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((c) => (
              <TableRow key={c.customerId} hover>
                <TableCell>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <ApartmentIcon fontSize="small" color="action" />
                    <Typography fontWeight={600}>{c.company || '—'}</Typography>
                  </Stack>
                </TableCell>
                <TableCell>{c.companyTin ?? '—'}</TableCell>
                <TableCell>
                  <Chip size="small" variant="outlined" color={c.realSendEnabled ? 'success' : 'error'}
                    label={c.realSendEnabled ? 'Habilitado' : 'Deshabilitado'} />
                </TableCell>
                <TableCell align="right">
                  <Button size="small" startIcon={<EditIcon />} onClick={() => openFicha(c)}>
                    Ver ficha
                  </Button>
                  <Tooltip title={c.customerId === me?.customerId ? 'No puedes eliminar tu propia empresa' : 'Eliminar cliente'}>
                    <span>
                      <IconButton
                        size="small"
                        color="error"
                        sx={{ ml: 0.5 }}
                        onClick={() => handleDelete(c)}
                        disabled={deletingId === c.customerId || c.customerId === me?.customerId}
                      >
                        {deletingId === c.customerId ? <CircularProgress size={18} /> : <DeleteIcon fontSize="small" />}
                      </IconButton>
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Ficha del cliente */}
      <Dialog open={open} onClose={closeFicha} maxWidth="md" fullWidth>
        <DialogTitle>
          <Stack direction="row" spacing={1} alignItems="center">
            <ApartmentIcon color="primary" />
            <span>{detail?.customer.company || 'Ficha del cliente'}</span>
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {detailLoading && <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress /></Box>}
          {!detailLoading && detail && (
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} flexWrap="wrap" useFlexGap>
                <Box>
                  <Typography variant="caption" color="text.secondary">NIT</Typography>
                  <Typography fontWeight={600}>{detail.customer.companyTin || '—'}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Registrado</Typography>
                  <Typography fontWeight={600}>{formatDateTime(detail.customer.date)}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Usuarios</Typography>
                  <Typography fontWeight={600}>{detail.count}</Typography>
                </Box>
              </Stack>

              <Paper variant="outlined" sx={{ p: 2 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Box>
                    <Typography fontWeight={700}>Envíos reales</Typography>
                    <Typography variant="caption" color="text.secondary">
                      Si se deshabilita, el cliente solo puede enviar muestras.
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip size="small" variant="outlined" color={detail.customer.realSendEnabled ? 'success' : 'error'}
                      label={detail.customer.realSendEnabled ? 'Habilitado' : 'Deshabilitado'} />
                    {savingSend ? <CircularProgress size={20} /> : (
                      <Switch checked={detail.customer.realSendEnabled} onChange={toggleSend} color="success" />
                    )}
                  </Stack>
                </Stack>
              </Paper>

              <Box>
                <Typography variant="subtitle1" fontWeight={700} gutterBottom>Usuarios de la empresa</Typography>
                <Divider sx={{ mb: 1 }} />
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Nombre</TableCell>
                        <TableCell>Email</TableCell>
                        <TableCell>Rol</TableCell>
                        <TableCell>
                          <Tooltip title="Sub-rol dentro de la empresa (RBAC): owner (todo), approver (aprueba + envía), operator (solo prepara y solicita aprobación).">
                            <Box component="span" sx={{ cursor: 'help' }}>Sub-rol</Box>
                          </Tooltip>
                        </TableCell>
                        <TableCell>Estado</TableCell>
                        <TableCell align="right">Acciones</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detail.users.length === 0 && (
                        <TableRow><TableCell colSpan={6} align="center" sx={{ py: 2, color: 'text.secondary' }}>Sin usuarios.</TableCell></TableRow>
                      )}
                      {detail.users.map((u) => (
                        <TableRow key={u.userId} hover>
                          <TableCell>{u.name || '—'}{me?.email && u.email === me.email && <Chip size="small" label="tú" sx={{ ml: 1, height: 18 }} />}</TableCell>
                          <TableCell>{u.email}</TableCell>
                          <TableCell>
                            <Chip size="small" icon={u.role === 'admin' ? <AdminPanelSettingsIcon /> : <PersonIcon />}
                              color={u.role === 'admin' ? 'primary' : 'default'} variant={u.role === 'admin' ? 'filled' : 'outlined'}
                              label={u.role === 'admin' ? 'Administrador' : 'Cliente'} />
                          </TableCell>
                          <TableCell>
                            <Select
                              size="small"
                              value={u.tenantRole ?? 'owner'}
                              onChange={(e) => changeTenantRole(u, e.target.value as TenantRole)}
                              disabled={roleBusy === u.userId}
                              sx={{ minWidth: 120 }}
                            >
                              <MenuItem value="owner">Owner</MenuItem>
                              <MenuItem value="approver">Aprobador</MenuItem>
                              <MenuItem value="operator">Funcional</MenuItem>
                            </Select>
                          </TableCell>
                          <TableCell>
                            <Chip size="small" variant="outlined" color={u.active ? 'success' : 'warning'}
                              label={u.active ? 'Activo' : 'Inactivo'} />
                          </TableCell>
                          <TableCell align="right">
                            <Tooltip title={u.role === 'admin' ? 'Quitar administrador' : 'Promover a administrador'}>
                              <span>
                                <IconButton size="small" color={u.role === 'admin' ? 'error' : 'primary'}
                                  onClick={() => changeRole(u)} disabled={roleBusy === u.userId}>
                                  {roleBusy === u.userId ? <CircularProgress size={16} /> : (u.role === 'admin' ? <PersonIcon fontSize="small" /> : <AdminPanelSettingsIcon fontSize="small" />)}
                                </IconButton>
                              </span>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeFicha}>Cerrar</Button>
        </DialogActions>
      </Dialog>

      {FeedbackSnackbar}
      {ConfirmDialog}
    </Box>
  );
};
