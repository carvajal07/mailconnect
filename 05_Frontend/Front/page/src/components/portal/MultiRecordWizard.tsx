import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Step,
  StepLabel,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import PersonIcon from '@mui/icons-material/Person';
import LayersIcon from '@mui/icons-material/Layers';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import {
  analyzeMultiRecordTypes,
  buildMultiRecordMap,
  maxColumns,
  multiRecordToRows,
  rowsToCsv,
  suggestFieldName,
  type ContactType,
  type Delimiter,
  type MultiRecordColumnMap,
  type MultiRecordType,
} from './csv';

/** Resultado emitido al padre en cada cambio válido (o null si la configuración no sirve). */
export interface MultiRecordResult {
  csvText: string;
  rows: string[][];
  types: MultiRecordType[];
  tagCol: number;
  map: MultiRecordColumnMap;
  valid: boolean;
}

interface Props {
  /** Texto crudo del CSV multiregistro (sin encabezado). */
  rawText: string;
  /** Delimitador detectado del archivo. */
  delimiter: Delimiter;
  /** Tipo de contacto del canal elegido en el padre (correo o celular). */
  contact: ContactType;
  /** Se llama en cada cambio con la configuración generada (o null si no es válida). */
  onConfig: (result: MultiRecordResult | null) => void;
}

const STEPS = ['Detección del identificador', 'Alias de los canales', 'Nombres de columna'];

/** Override editable por canal (alias + nombres de campo por índice). */
interface Override {
  alias?: string;
  fieldNames?: Record<number, string>;
}

function applyOverride(t: MultiRecordType, ov?: Override): MultiRecordType {
  if (!ov) return t;
  return {
    ...t,
    alias: ov.alias ?? t.alias,
    fieldNames: t.fieldNames.map((n, i) => ov.fieldNames?.[i] ?? n),
  };
}

interface Validation {
  emptyByTag: Record<string, Set<number>>;
  dupByTag: Record<string, Set<number>>;
  warnings: string[];
  valid: boolean;
}

function validate(types: MultiRecordType[]): Validation {
  const emptyByTag: Record<string, Set<number>> = {};
  const dupByTag: Record<string, Set<number>> = {};
  const warnings: string[] = [];

  for (const t of types) {
    const empties = new Set<number>();
    const dups = new Set<number>();
    const seen = new Map<string, number>();
    t.fieldNames.forEach((n, i) => {
      const v = (n ?? '').trim();
      if (!v) { empties.add(i); return; }
      const key = v.toLowerCase();
      if (seen.has(key)) { dups.add(i); dups.add(seen.get(key)!); }
      else seen.set(key, i);
    });
    if (empties.size) emptyByTag[t.tag] = empties;
    if (dups.size) dupByTag[t.tag] = dups;
    if (!(t.alias ?? '').trim()) {
      warnings.push(`El canal “${t.tag}” no tiene nombre amigable (se usará “${t.tag}”).`);
    }
  }
  const anyEmpty = Object.keys(emptyByTag).length > 0;
  const anyDup = Object.keys(dupByTag).length > 0;
  if (anyEmpty) warnings.push('Hay columnas sin nombre: se usará “Campo N”, pero conviene nombrarlas.');
  if (anyDup) warnings.push('Hay nombres de columna repetidos dentro de un canal; se sobrescribirían entre sí.');
  return { emptyByTag, dupByTag, warnings, valid: !anyDup };
}

/** ¿La celda es un array JSON (columna hija)? Devuelve el número de ítems, o -1. */
function jsonItemCount(cell: string): number {
  const s = (cell ?? '').trim();
  if (!s.startsWith('[')) return -1;
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.length : -1;
  } catch {
    return -1;
  }
}

export default function MultiRecordWizard({ rawText, delimiter, contact, onConfig }: Props) {
  const [activeStep, setActiveStep] = useState(0);
  const [tagCol, setTagCol] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});

  const nCols = useMemo(() => Math.max(1, maxColumns(rawText, delimiter)), [rawText, delimiter]);

  // Análisis base (re-deriva al cambiar el archivo, el canal o la columna del identificador).
  const base = useMemo(() => {
    try {
      return { ...analyzeMultiRecordTypes(rawText, delimiter, contact, tagCol), error: '' };
    } catch (e) {
      return { types: [] as MultiRecordType[], error: e instanceof Error ? e.message : 'Archivo inválido.' };
    }
  }, [rawText, delimiter, contact, tagCol]);

  // Tipos efectivos = base + overrides del usuario.
  const types = useMemo(
    () => base.types.map((t) => applyOverride(t, overrides[t.tag])),
    [base.types, overrides],
  );

  // Conversión al modelo interno (encabezado + filas) + mapa de salida.
  const built = useMemo(() => {
    if (!types.length) return null;
    try {
      const rows = multiRecordToRows(rawText, delimiter, types, tagCol);
      return { rows, csvText: rowsToCsv(rows, ';'), map: buildMultiRecordMap(types, tagCol) };
    } catch {
      return null;
    }
  }, [rawText, delimiter, types, tagCol]);

  const validation = useMemo(() => validate(types), [types]);

  // Emitir al padre en cada cambio (ref para no exigir memoización del callback).
  const onConfigRef = useRef(onConfig);
  onConfigRef.current = onConfig;
  useEffect(() => {
    if (!built) { onConfigRef.current(null); return; }
    onConfigRef.current({ ...built, types, tagCol, valid: validation.valid });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built?.csvText, validation.valid, tagCol]);

  const master = types.find((t) => t.isMaster) ?? null;

  const changeTagCol = (col: number) => {
    setTagCol(col);
    setOverrides({}); // la estructura cambió → los nombres previos ya no aplican
  };

  const setAlias = (tag: string, alias: string) =>
    setOverrides((o) => ({ ...o, [tag]: { ...o[tag], alias } }));

  const setField = (tag: string, i: number, value: string) =>
    setOverrides((o) => ({
      ...o,
      [tag]: { ...o[tag], fieldNames: { ...o[tag]?.fieldNames, [i]: value } },
    }));

  // ── Vista previa en vivo (encabezados mapeados + primeras filas) ──
  const preview = useMemo(() => {
    if (!built) return null;
    const [header, ...rows] = built.rows;
    const childStart = master ? Math.max(master.maxFields, master.fieldNames.length) : header.length;
    return { header, rows: rows.slice(0, 5), childStart };
  }, [built, master]);

  if (base.error) {
    return <Alert severity="error">{base.error}</Alert>;
  }

  return (
    <Box>
      <Stepper activeStep={activeStep} alternativeLabel sx={{ mb: 3 }}>
        {STEPS.map((label, i) => (
          <Step key={label} completed={activeStep > i} sx={{ cursor: 'pointer' }}
                onClick={() => setActiveStep(i)}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {/* ── PASO 1: Detección del identificador de canal ── */}
      {activeStep === 0 && (
        <Stack spacing={2.5}>
          <FormControl size="small" sx={{ maxWidth: 380 }}>
            <InputLabel id="tagcol-label">¿En qué columna está el tipo de registro?</InputLabel>
            <Select
              labelId="tagcol-label"
              label="¿En qué columna está el tipo de registro?"
              value={tagCol}
              onChange={(e) => changeTagCol(Number(e.target.value))}
            >
              {Array.from({ length: nCols }, (_, i) => (
                <MenuItem key={i} value={i}>Columna {i + 1}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Canales detectados en la muestra (primeras 20 líneas)
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {types.map((t) => (
                <Chip
                  key={t.tag}
                  icon={t.isMaster ? <PersonIcon /> : <LayersIcon />}
                  color={t.isMaster ? 'primary' : 'default'}
                  variant={t.isMaster ? 'filled' : 'outlined'}
                  label={t.isMaster ? `${t.tag} · principal` : t.tag}
                />
              ))}
              {!types.length && <Typography variant="body2" color="text.secondary">Sin canales detectados.</Typography>}
            </Stack>
          </Box>

          <Alert severity="info">
            El tipo de la <strong>primera línea</strong> (<strong>{master?.tag ?? '—'}</strong>) es el
            <strong> principal</strong>: cada una de sus líneas abre un destinatario y las líneas de los
            demás canales se agrupan debajo, hasta el siguiente principal.
          </Alert>
        </Stack>
      )}

      {/* ── PASO 2: Alias de los canales ── */}
      {activeStep === 1 && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Dale un <strong>nombre amigable</strong> a cada canal. En los canales secundarios ese nombre
            será además el de la <strong>columna</strong> que agrupa sus líneas (la que vinculas con una
            tabla en la plantilla del Estudio PDF).
          </Typography>
          {types.map((t) => (
            <Card key={t.tag} variant="outlined"
                  sx={{ borderColor: t.isMaster ? 'primary.main' : undefined }}>
              <CardContent>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
                  <Stack spacing={0.5} sx={{ minWidth: 200 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Chip size="small" color={t.isMaster ? 'primary' : 'default'}
                            variant={t.isMaster ? 'filled' : 'outlined'}
                            icon={t.isMaster ? <PersonIcon /> : <LayersIcon />}
                            label={t.tag} />
                      {t.isMaster && <Typography variant="caption" color="primary">principal</Typography>}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {t.tag} • {t.sampleCount} línea{t.sampleCount === 1 ? '' : 's'} en la muestra
                      {t.count !== t.sampleCount && ` (${t.count} en total)`}
                    </Typography>
                  </Stack>
                  <TextField
                    size="small"
                    fullWidth
                    label="Nombre amigable para este canal"
                    placeholder={t.isMaster ? 'Datos del destinatario' : t.tag}
                    value={t.alias}
                    onChange={(e) => setAlias(t.tag, e.target.value)}
                    helperText={t.isMaster
                      ? 'Etiqueta del destinatario (sus campos van como columnas principales).'
                      : 'Será el nombre de la columna con la lista de líneas de este canal.'}
                  />
                </Stack>
              </CardContent>
            </Card>
          ))}
          <PreviewBlock preview={preview} />
        </Stack>
      )}

      {/* ── PASO 3: Mapeo dinámico de columnas ── */}
      {activeStep === 2 && (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Ponle nombre a <strong>cada columna</strong> de cada canal. En el canal principal, las 3
            primeras deben ser <strong>Identificación</strong>, <strong>{contact === 'phone' ? 'Celular' : 'Correo'}</strong> y
            <strong> Nombre</strong> (el sistema las lee por posición). En los canales secundarios, usa los
            mismos nombres que las columnas de la tabla en tu plantilla.
          </Typography>

          {types.map((t) => {
            const empties = validation.emptyByTag[t.tag];
            const dups = validation.dupByTag[t.tag];
            return (
              <Card key={t.tag} variant="outlined"
                    sx={{ borderColor: t.isMaster ? 'primary.main' : undefined }}>
                <CardContent>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
                    <Chip size="small" color={t.isMaster ? 'primary' : 'default'}
                          variant={t.isMaster ? 'filled' : 'outlined'}
                          icon={t.isMaster ? <PersonIcon /> : <LayersIcon />}
                          label={childAliasLabel(t)} />
                    <Typography variant="caption" color="text.secondary">
                      {t.tag} • {t.maxFields} columna{t.maxFields === 1 ? '' : 's'}
                    </Typography>
                  </Stack>
                  {t.maxFields === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      Este canal no tiene columnas de datos (solo la etiqueta).
                    </Typography>
                  ) : (
                    <Box sx={{
                      display: 'grid',
                      gap: 1.5,
                      gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))',
                    }}>
                      {Array.from({ length: t.maxFields }, (_, i) => (
                        <TextField
                          key={i}
                          size="small"
                          label={`Nombre del Campo ${i + 1}`}
                          placeholder={suggestFieldName(t.isMaster, i, contact)}
                          value={t.fieldNames[i] ?? ''}
                          onChange={(e) => setField(t.tag, i, e.target.value)}
                          error={!!empties?.has(i) || !!dups?.has(i)}
                          helperText={
                            dups?.has(i) ? 'Nombre repetido en este canal'
                              : empties?.has(i) ? 'Sin nombre (se usará “Campo ' + (i + 1) + '”)'
                                : undefined
                          }
                        />
                      ))}
                    </Box>
                  )}
                </CardContent>
              </Card>
            );
          })}

          {validation.warnings.length > 0 && (
            <Alert severity={validation.valid ? 'warning' : 'error'}>
              <Stack spacing={0.25}>
                {validation.warnings.map((w, i) => <span key={i}>{w}</span>)}
              </Stack>
            </Alert>
          )}
          <PreviewBlock preview={preview} />
        </Stack>
      )}

      {/* ── Navegación ── */}
      <Divider sx={{ my: 2.5 }} />
      <Stack direction="row" justifyContent="space-between">
        <Button startIcon={<ArrowBackIcon />} disabled={activeStep === 0}
                onClick={() => setActiveStep((s) => s - 1)}>
          Atrás
        </Button>
        {activeStep < STEPS.length - 1 ? (
          <Button variant="contained" endIcon={<ArrowForwardIcon />}
                  onClick={() => setActiveStep((s) => s + 1)}>
            Siguiente
          </Button>
        ) : (
          <Chip color={validation.valid ? 'success' : 'error'}
                icon={<CheckCircleIcon />}
                label={validation.valid ? 'Configuración lista' : 'Corrige los nombres repetidos'} />
        )}
      </Stack>
    </Box>
  );
}

const childAliasLabel = (t: MultiRecordType): string =>
  t.isMaster ? (t.alias || t.tag) : (t.alias || t.tag);

/** Bloque de vista previa en vivo (encabezados mapeados + primeras filas). Las
 *  columnas hijas muestran el número de ítems de su lista, no el JSON crudo. */
function PreviewBlock({ preview }: {
  preview: { header: string[]; rows: string[][]; childStart: number } | null;
}) {
  if (!preview || !preview.header.length) return null;
  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
        Vista previa (se actualiza en tiempo real)
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 260 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {preview.header.map((h, i) => (
                <TableCell key={i} sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {h}
                  {i >= preview.childStart && (
                    <Chip size="small" label="lista" variant="outlined" sx={{ ml: 0.5, height: 18 }} />
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {preview.rows.map((row, r) => (
              <TableRow key={r}>
                {preview.header.map((_, c) => {
                  const cell = row[c] ?? '';
                  const items = c >= preview.childStart ? jsonItemCount(cell) : -1;
                  return (
                    <TableCell key={c} sx={{ whiteSpace: 'nowrap' }}>
                      {items >= 0
                        ? <Chip size="small" color="info" variant="outlined"
                                label={`${items} ítem${items === 1 ? '' : 's'}`} />
                        : (cell.length > 40 ? cell.slice(0, 40) + '…' : cell)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
            {!preview.rows.length && (
              <TableRow><TableCell colSpan={preview.header.length}>
                <Typography variant="body2" color="text.secondary">Sin filas para previsualizar.</Typography>
              </TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
