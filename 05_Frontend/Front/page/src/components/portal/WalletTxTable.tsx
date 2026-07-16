import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Typography,
  Paper,
} from '@mui/material';
import { formatCOP } from '../../services/costService';
import { TX_LABEL, type WalletTransaction } from '../../services/balanceService';

/**
 * Tabla reutilizable de MOVIMIENTOS del monedero (ledger). La usan la sección Saldo del
 * portal (movimientos del cliente) y la sección Saldos del admin (ledger global). El
 * monto se pinta con signo y color: crédito (+, verde) / débito (−).
 */
const TX_COLOR: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  topup_manual: 'success',
  topup_wompi: 'success',
  debit: 'default',
  refund: 'warning',
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
            return (
              <TableRow key={t.txId} hover>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>{t.date || '—'}</TableCell>
                {showCompany && (
                  <TableCell>{(t as { company?: string }).company || '—'}</TableCell>
                )}
                <TableCell>
                  <Chip size="small" variant="outlined" color={TX_COLOR[t.type] ?? 'default'} label={TX_LABEL[t.type] ?? t.type} />
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">{t.detail || '—'}</Typography>
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: credit ? 'success.main' : 'text.primary', fontWeight: 600 }}>
                  {credit ? '+' : '−'}{formatCOP(Math.abs(t.amount))}
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{formatCOP(t.balanceAfter)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
};
