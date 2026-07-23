import { useCallback, useEffect, useState } from 'react';
import {
  Box, Paper, Stack, Typography, Button, IconButton, Tooltip, Chip, MenuItem, TextField,
  Dialog, DialogTitle, DialogContent, DialogActions, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, FormControl, InputLabel, Select, CircularProgress,
  Alert, LinearProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteIcon from '@mui/icons-material/Delete';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import { usersService, ROLE_LABEL } from '../../services/usersService';
import type { TeamUser } from '../../services/usersService';
import { authService } from '../../services/authService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { useConfirm } from '../../hooks/useConfirm';

const ROLE_COLOR: Record<string, 'default' | 'primary' | 'success' | 'info'> = {
  owner: 'primary', approver: 'success', operator: 'info',
};

export const UsuariosSection = () => {
  const { notify, FeedbackSnackbar } = useFeedback();
  const { confirm, ConfirmDialog } = useConfirm();
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [max, setMax] = useState(2);
  const [canAdd, setCanAdd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'operator' | 'approver'>('operator');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await usersService.list();
    setLoading(false);
    if (isOk(res) && res.data?.users) {
      setUsers(res.data.users);
      setMax(res.data.max ?? 2);
      setCanAdd(Boolean(res.data.canAdd));
    } else {
      notify(res.description || 'No se pudieron cargar los usuarios.', 'error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const resetForm = () => { setName(''); setEmail(''); setPhone(''); setRole('operator'); };

  const submit = async () => {
    if (!name.trim() || !email.trim()) { notify('Nombre y correo son obligatorios.', 'warning'); return; }
    setSubmitting(true);
    const res = await usersService.create({ name: name.trim(), email: email.trim().toLowerCase(), phone: phone.trim(), tenantRole: role });
    if (!isOk(res)) { setSubmitting(false); notify(res.description || 'No se pudo crear el usuario.', 'error'); return; }
    // Dispara el correo para que el nuevo usuario defina su contraseña (OTP / reset).
    await authService.forgotPassword(email.trim().toLowerCase()).catch(() => undefined);
    setSubmitting(false);
    notify('Usuario creado. Le enviamos un correo para que defina su contraseña.', 'success');
    setOpen(false); resetForm(); load();
  };

  const doDelete = async (u: TeamUser) => {
    const ok = await confirm({
      title: 'Eliminar usuario',
      message: `¿Eliminar a ${u.name || u.email}? Perderá el acceso a la plataforma. Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar', confirmColor: 'error',
    });
    if (!ok) return;
    setBusy(u.userId);
    const res = await usersService.delete(u.userId);
    setBusy('');
    if (isOk(res)) { notify('Usuario eliminado.', 'info'); load(); }
    else notify(res.description || 'No se pudo eliminar.', 'error');
  };

  const resend = async (u: TeamUser) => {
    setBusy(u.userId);
    await authService.forgotPassword(u.email).catch(() => undefined);
    setBusy('');
    notify(`Le reenviamos a ${u.email} el correo para definir su contraseña.`, 'info');
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h4">Usuarios</Typography>
          <Typography variant="body2" color="text.secondary">
            Agrega a tu equipo (hasta {max} además de ti): un <strong>funcional</strong> que prepara y
            envía muestras, y un <strong>aprobador</strong> que aprueba y hace el envío real.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button size="small" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>Refrescar</Button>
          <Tooltip title={canAdd ? '' : `Alcanzaste el máximo de ${max} usuarios`}>
            <span>
              <Button size="small" variant="contained" startIcon={<AddIcon />} disabled={!canAdd}
                onClick={() => { resetForm(); setOpen(true); }}>
                Agregar usuario
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      {loading && <LinearProgress sx={{ mb: 1 }} />}

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Nombre</TableCell><TableCell>Correo</TableCell>
              <TableCell>Rol</TableCell><TableCell>Estado</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.userId} hover>
                <TableCell><strong>{u.name || '—'}</strong></TableCell>
                <TableCell>{u.email}</TableCell>
                <TableCell><Chip size="small" color={ROLE_COLOR[u.tenantRole] || 'default'} label={ROLE_LABEL[u.tenantRole] || u.tenantRole} /></TableCell>
                <TableCell>
                  {u.active
                    ? <Chip size="small" variant="outlined" color="success" label="Activo" />
                    : <Chip size="small" variant="outlined" color="warning" label="Pendiente" />}
                </TableCell>
                <TableCell align="right">
                  {!u.isOwner && (
                    <>
                      <Tooltip title="Reenviar correo para definir contraseña">
                        <span><IconButton size="small" disabled={busy === u.userId} onClick={() => resend(u)}><MarkEmailReadIcon fontSize="small" /></IconButton></span>
                      </Tooltip>
                      <Tooltip title="Eliminar">
                        <span><IconButton size="small" color="error" disabled={busy === u.userId} onClick={() => doDelete(u)}><DeleteIcon fontSize="small" /></IconButton></span>
                      </Tooltip>
                    </>
                  )}
                  {u.isOwner && <Typography variant="caption" color="text.secondary">Tú (dueño)</Typography>}
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && !loading && (
              <TableRow><TableCell colSpan={5}><Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                Aún no hay usuarios adicionales. Agrega a tu equipo.
              </Typography></TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Agregar usuario</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField label="Nombre" value={name} onChange={(e) => setName(e.target.value)} size="small" fullWidth />
            <TextField label="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} size="small" fullWidth />
            <TextField label="Celular (opcional)" value={phone} onChange={(e) => setPhone(e.target.value)} size="small" fullWidth />
            <FormControl fullWidth size="small">
              <InputLabel>Rol</InputLabel>
              <Select value={role} label="Rol" onChange={(e) => setRole(e.target.value as 'operator' | 'approver')}>
                <MenuItem value="operator">Funcional — prepara y envía muestras</MenuItem>
                <MenuItem value="approver">Aprobador — aprueba y hace el envío real</MenuItem>
              </Select>
            </FormControl>
            <Alert severity="info">
              Le llegará un correo para <strong>definir su contraseña</strong>. Queda activo apenas la defina.
            </Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="contained" onClick={submit} disabled={submitting} startIcon={submitting ? <CircularProgress size={16} /> : undefined}>
            {submitting ? 'Creando…' : 'Crear usuario'}
          </Button>
        </DialogActions>
      </Dialog>

      {ConfirmDialog}
      {FeedbackSnackbar}
    </Box>
  );
};
