import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Stack,
  TextField,
  Button,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Alert,
  CircularProgress,
  InputAdornment,
  Tooltip,
} from '@mui/material';
import BlockIcon from '@mui/icons-material/Block';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import { getUser } from '../../services/authService';
import { blacklistService } from '../../services/blacklistService';
import type { BlacklistItem } from '../../services/blacklistService';
import { isOk } from '../../services/apiClient';
import { useFeedback } from '../../hooks/useFeedback';
import { useConfirm } from '../../hooks/useConfirm';
import { validateContact } from './csv';

/**
 * Sección "Lista negra": contactos (correo o celular) que NO reciben envíos. Se llena
 * sola con rebotes/quejas y el cliente puede agregar/quitar manualmente. Prepare-batch
 * la filtra en el envío real.
 */
export const ListaNegraSection = () => {
  const user = getUser();
  const customerId = user?.customerId ?? '';
  const customer = user?.customer ?? '';
  const { notify, FeedbackSnackbar } = useFeedback();
  const { confirm, ConfirmDialog } = useConfirm();

  const [items, setItems] = useState<BlacklistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [newContact, setNewContact] = useState('');
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!customerId && !customer) return;
    setLoading(true);
    const res = await blacklistService.list(customerId, customer);
    setLoading(false);
    if (isOk(res) && res.data?.items) setItems(res.data.items);
  }, [customerId, customer]);

  useEffect(() => {
    load();
  }, [load]);

  // Validación en vivo del contacto (correo o celular E.164) para avisar antes de enviar.
  const contactError =
    newContact.trim() && !validateContact(newContact).valid
      ? validateContact(newContact).type === 'email'
        ? 'El correo no tiene un formato válido.'
        : 'El celular debe ir en formato E.164 (+57…).'
      : '';

  const handleAdd = async () => {
    const contact = newContact.trim();
    if (!contact) return notify('Escribe el correo o celular a bloquear.', 'warning');
    // Valida el formato ANTES de pegarle al backend (correo si trae '@', si no celular E.164).
    const { valid, type } = validateContact(contact);
    if (!valid) {
      return notify(
        type === 'email' ? 'El correo no tiene un formato válido.' : 'El celular debe ir en formato E.164 (+57…).',
        'warning',
      );
    }
    setAdding(true);
    const res = await blacklistService.add(contact, reason.trim() || undefined, customerId, customer);
    setAdding(false);
    if (isOk(res)) {
      notify('Contacto agregado a la lista negra.', 'success');
      setNewContact('');
      setReason('');
      load();
    } else {
      notify(res.description || 'No se pudo agregar el contacto.', 'error');
    }
  };

  const handleRemove = async (contact: string) => {
    const ok = await confirm({
      title: 'Quitar de la lista negra',
      message: `¿Quitar "${contact}" de la lista negra? Volverá a poder recibir tus envíos.`,
      confirmText: 'Quitar',
      confirmColor: 'error',
    });
    if (!ok) return;
    setDeletingKey(contact);
    const res = await blacklistService.remove(contact, customerId, customer);
    setDeletingKey(null);
    if (isOk(res)) {
      setItems((prev) => prev.filter((x) => x.email !== contact));
      notify('Contacto quitado de la lista negra.', 'success');
    } else {
      notify(res.description || 'No se pudo quitar el contacto.', 'error');
    }
  };

  const filtered = items.filter((i) => i.email.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
        <BlockIcon color="error" />
        <Typography variant="h4">Lista negra</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Contactos (correo o celular) que <strong>no reciben tus envíos</strong>. Se agregan
        automáticamente por rebotes/quejas y también puedes gestionarlos aquí.
      </Typography>

      <Alert severity="info" sx={{ mb: 2 }}>
        Al enviar una campaña real, estos contactos se excluyen automáticamente. Para celulares usa
        formato E.164 (+57…), igual que en las bases de SMS/WhatsApp/Voz.
      </Alert>

      {/* Agregar */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-start' }}>
          <TextField
            label="Correo o celular"
            value={newContact}
            onChange={(e) => setNewContact(e.target.value)}
            size="small"
            fullWidth
            placeholder="cliente@correo.com  o  +573001234567"
            error={!!contactError}
            helperText={contactError || ' '}
          />
          <TextField
            label="Motivo (opcional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            size="small"
            fullWidth
            helperText=" "
          />
          <Button
            variant="contained"
            color="error"
            startIcon={adding ? <CircularProgress size={16} color="inherit" /> : <AddIcon />}
            onClick={handleAdd}
            disabled={adding || !!contactError || !newContact.trim()}
            sx={{ whiteSpace: 'nowrap', flexShrink: 0, minWidth: 140, alignSelf: { xs: 'stretch', sm: 'flex-start' } }}
          >
            Bloquear
          </Button>
        </Stack>
      </Paper>

      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1} gap={1} flexWrap="wrap">
        <TextField
          size="small"
          placeholder="Buscar…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>) }}
          sx={{ maxWidth: 280, flex: 1 }}
        />
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip size="small" label={`${items.length} bloqueado(s)`} />
          <Button size="small" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>Refrescar</Button>
        </Stack>
      </Stack>

      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Contacto</TableCell>
              <TableCell>Motivo</TableCell>
              <TableCell>Origen</TableCell>
              <TableCell>Fecha</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading && items.length === 0 && (
              <TableRow><TableCell colSpan={5} align="center" sx={{ py: 4 }}><CircularProgress size={24} /></TableCell></TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                  {items.length === 0 ? 'La lista negra está vacía.' : 'Sin resultados.'}
                </TableCell>
              </TableRow>
            )}
            {filtered.map((i) => (
              <TableRow key={i.email} hover>
                <TableCell><Typography fontWeight={600}>{i.email}</Typography></TableCell>
                <TableCell>{i.description || '—'}</TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={i.rejectionType === 'manual' ? 'Manual' : (i.rejectionType || 'Automático')}
                    color={i.rejectionType === 'manual' ? 'default' : 'warning'}
                  />
                </TableCell>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{i.date || '—'}</TableCell>
                <TableCell align="right">
                  <Tooltip title="Quitar de la lista negra">
                    <span>
                      <IconButton color="error" size="small" onClick={() => handleRemove(i.email)} disabled={deletingKey === i.email}>
                        {deletingKey === i.email ? <CircularProgress size={16} /> : <DeleteIcon fontSize="small" />}
                      </IconButton>
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {FeedbackSnackbar}
      {ConfirmDialog}
    </Box>
  );
};
