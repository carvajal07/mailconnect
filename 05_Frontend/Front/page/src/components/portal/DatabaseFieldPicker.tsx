import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box,
  Paper,
  Stack,
  Typography,
  TextField,
  MenuItem,
  Chip,
  Alert,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import DataObjectIcon from '@mui/icons-material/DataObject';
import { getUser } from '../../services/authService';
import { databaseService } from '../../services/databaseService';
import type { DatabaseFile } from '../../services/databaseService';
import { isOk } from '../../services/apiClient';

/**
 * Selector de UNA base de datos que trae sus CAMPOS (encabezados del CSV) para usarlos
 * como variables {{campo}} en las plantillas. Es autónomo (carga las bases del cliente
 * con databaseService), así funciona tanto en el portal como en /admin.
 *
 * - `onInsert(field)`: si se pasa, al hacer clic en un campo se llama con el NOMBRE del
 *   campo (sin llaves); cada consumidor decide el formato (SMS lo envuelve en {{campo}},
 *   WSP/DOCX lo agregan a la lista de parámetros). Si no se pasa, el clic copia `{{campo}}`
 *   al portapapeles.
 * - `onFieldsChange(fields)`: notifica los campos de la base elegida (para menús externos).
 */
interface Props {
  onInsert?: (field: string) => void;
  onFieldsChange?: (fields: string[]) => void;
  compact?: boolean;
}

export const DatabaseFieldPicker = ({ onInsert, onFieldsChange, compact }: Props) => {
  const user = getUser();
  const customerId = user?.customerId ?? '';
  const customer = user?.customer ?? '';

  const [databases, setDatabases] = useState<DatabaseFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!customerId && !customer) return;
      setLoading(true);
      const res = await databaseService.list(customerId, customer);
      if (!alive) return;
      setLoading(false);
      if (isOk(res) && res.data?.files) setDatabases(res.data.files);
    })();
    return () => { alive = false; };
  }, [customerId, customer]);

  const selected = databases.find((d) => d.databaseFileId === selectedId);
  // Memoizado para no recrear el array en cada render (evita un loop del efecto de abajo).
  const fields = useMemo(() => selected?.columns ?? [], [selected]);

  const notifyFields = useCallback(onFieldsChange ?? (() => {}), [onFieldsChange]);
  useEffect(() => {
    notifyFields(fields);
  }, [fields, notifyFields]);

  const handleField = (field: string) => {
    if (onInsert) onInsert(field);
    else navigator.clipboard?.writeText(`{{${field}}}`).catch(() => { /* sin portapapeles: no pasa nada */ });
  };

  return (
    <Paper variant="outlined" sx={{ p: compact ? 1.5 : 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" mb={1}>
        <DataObjectIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" fontWeight={700}>Campos desde una base de datos</Typography>
        {loading && <CircularProgress size={14} />}
      </Stack>

      <TextField
        select
        size="small"
        fullWidth
        label="Base de datos"
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        helperText={
          databases.length === 0
            ? (loading ? 'Cargando bases…' : 'No tienes bases cargadas. Súbelas en "Bases de datos".')
            : 'Elige una base para ver sus campos.'
        }
      >
        {databases.length === 0 && (
          <MenuItem value="" disabled>{loading ? 'Cargando…' : 'Sin bases'}</MenuItem>
        )}
        {databases.map((d) => (
          <MenuItem key={d.databaseFileId} value={d.databaseFileId}>
            <StorageIcon fontSize="small" style={{ marginRight: 8, verticalAlign: 'middle' }} />
            {d.fileName} {d.channel ? `· ${d.channel}` : ''}
          </MenuItem>
        ))}
      </TextField>

      {selected && fields.length === 0 && (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          Esta base no tiene columnas registradas (se cargó antes de esta función). Vuelve a subirla
          para habilitar sus campos.
        </Alert>
      )}

      {fields.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="caption" color="text.secondary">
            {onInsert ? 'Haz clic en un campo para insertarlo:' : 'Haz clic para copiar el campo (úsalo como {{campo}}):'}
          </Typography>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 0.75 }}>
            {fields.map((f) => (
              <Tooltip key={f} title={`Insertar {{${f}}}`}>
                <Chip label={f} size="small" variant="outlined" color="primary" onClick={() => handleField(f)} clickable />
              </Tooltip>
            ))}
          </Stack>
        </Box>
      )}
    </Paper>
  );
};
