import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Stack,
  Tooltip,
  Typography,
  Paper,
} from '@mui/material';
import { formatCOP } from '../../services/costService';
import { TX_LABEL, type WalletTransaction, type WalletTxStatus } from '../../services/balanceService';

/**
 * Tabla reutilizable de MOVIMIENTOS del monedero (ledger). La usan la sección Saldo del
 * portal (movimientos del cliente) y la sección Saldos del admin (ledger global). El
 * monto se pinta con signo y color: crédito (+, verde) / débito (−). Las solicitudes
 * manuales pendientes/rechazadas muestran su estado (aún no afectan el saldo).
 */
const TX_COLOR: Record<string, 'success' | 'error' | 'warning' | 'default' | 'info'> = {
  topup_manual: 'success',
  topup_wompi: 'success',
  adjustment: 'info',
  debit_send: 'default',
  refund_send: 'warning',
};

const STATUS_META: Record<string, { label: string; color: 'warning' | 'error' | 'default' }> = {
  pending: { label: 'Pendiente', color: 'warning' },
  declined: { label: 'Rechazada', color: 'error' },
};

interface Props {
  transactions: WalletTransaction[];
  emptyText?: string;
  /** Muestra una columna con la empresa (vista admin del ledger global). */
  showCompany?: boolean;
}

export const WalletTxTable = ({ transactions, emptyText = 'Sin movimientos.', showCompany = false }: Props) => {
  const cols = showCompany ? 6 : 5;
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Fecha</TableCell>
            {showCompany && <TableCell>Empresa</TableCell>}
            <TableCell>Movimiento</TableCell>
            <TableCell>Detalle</TableCell>
            <TableCell align="right">Monto</TableCell>
            <TableCell align="right">Saldo</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {transactions.length === 0 && (
            <TableRow>
              <TableCell colSpan={cols} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                {emptyText}
              </TableCell>
            </TableRow>
          )}
          {transactions.map((t) => {
            const credit = t.amount >= 0;
            const status = (t.status || '') as WalletTxStatus;
            const applied = status !== 'pending' && status !== 'declined';   // ya afectó el saldo
            const statusMeta = STATUS_META[status];
            return (
              <TableRow key={t.txId} hover>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{t.createdAt || '—'}</TableCell>
                {showCompany && (
                  <TableCell>{(t as { company?: string }).company || '—'}</TableCell>
                )}
                <TableCell>
                  <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Chip size="small" variant="outlined" color={TX_COLOR[t.type] ?? 'default'} label={TX_LABEL[t.type] ?? t.type} />
                    {statusMeta && (
                      <Tooltip title={status === 'declined' && t.rejectReason ? `Motivo: ${t.rejectReason}` : ''}>
                        <Chip size="small" color={statusMeta.color} label={statusMeta.label} />
                      </Tooltip>
                    )}
                  </Stack>
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">{t.detail || '—'}</Typography>
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: credit ? 'success.main' : 'text.primary', fontWeight: 600 }}>
                  {credit ? '+' : '−'}{formatCOP(Math.abs(t.amount))}
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  {applied ? formatCOP(t.balanceAfter) : '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};
