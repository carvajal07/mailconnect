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
  InputAdornment
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import { API_CONFIG, buildUrl } from '../../config/api';

interface Cliente {
  id?: string;
  name: string;
  phone: string;
  email: string;
  company: string;
  companyTin: number;
  password?: string;
}

export const ClientesSection = () => {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [openDialog, setOpenDialog] = useState(false);
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create');
  const [selectedCliente, setSelectedCliente] = useState<Cliente | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState<Cliente>({
    name: '',
    phone: '',
    email: '',
    company: '',
    companyTin: 0,
    password: '',
  });

  const handleOpenDialog = (mode: 'create' | 'edit', cliente?: Cliente) => {
    setDialogMode(mode);
    if (mode === 'edit' && cliente) {
      setSelectedCliente(cliente);
      setFormData({ ...cliente, password: '' });
    } else {
      setFormData({
        name: '',
        phone: '',
        email: '',
        company: '',
        companyTin: 0,
        password: '',
      });
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setSelectedCliente(null);
  };

  const handleInputChange = (field: keyof Cliente, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    try {
      const url = dialogMode === 'create'
        ? buildUrl(API_CONFIG.CLIENTS.REGISTER)
        : buildUrl(API_CONFIG.CLIENTS.UPDATE, { id: selectedCliente?.id || '' });

      const response = await fetch(url, {
        method: dialogMode === 'create' ? 'POST' : 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        console.log('Cliente guardado exitosamente');
        handleCloseDialog();
        loadClientes();
      } else {
        console.error('Error al guardar cliente');
      }
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const loadClientes = async () => {
    try {
      const response = await fetch(buildUrl(API_CONFIG.CLIENTS.LIST));
      if (response.ok) {
        const data = await response.json();
        setClientes(data);
      }
    } catch (error) {
      console.error('Error al cargar clientes:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('¿Está seguro de eliminar este cliente?')) {
      try {
        const response = await fetch(buildUrl(API_CONFIG.CLIENTS.DELETE, { id }), {
          method: 'DELETE',
        });

        if (response.ok) {
          console.log('Cliente eliminado exitosamente');
          loadClientes();
        }
      } catch (error) {
        console.error('Error al eliminar cliente:', error);
      }
    }
  };

  const handleSearch = async () => {
    try {
      const url = `${buildUrl(API_CONFIG.CLIENTS.SEARCH)}?term=${searchTerm}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setClientes(data);
      }
    } catch (error) {
      console.error('Error en búsqueda:', error);
    }
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4">Clientes</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog('create')}
        >
          Registrar Cliente
        </Button>
      </Stack>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
          <TextField
            fullWidth
            placeholder="Buscar clientes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
            sx={{ flex: { md: 2 } }}
          />
          <Button variant="outlined" onClick={handleSearch} sx={{ minWidth: 120 }}>
            Buscar
          </Button>
          <Button variant="outlined" onClick={loadClientes} sx={{ minWidth: 120 }}>
            Listar Todos
          </Button>
        </Stack>
      </Paper>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Nombre</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Teléfono</TableCell>
              <TableCell>Empresa</TableCell>
              <TableCell>NIT</TableCell>
              <TableCell align="right">Acciones</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {clientes.map((cliente) => (
              <TableRow key={cliente.id}>
                <TableCell>{cliente.name}</TableCell>
                <TableCell>{cliente.email}</TableCell>
                <TableCell>{cliente.phone}</TableCell>
                <TableCell>{cliente.company}</TableCell>
                <TableCell>{cliente.companyTin}</TableCell>
                <TableCell align="right">
                  <IconButton
                    color="primary"
                    onClick={() => handleOpenDialog('edit', cliente)}
                  >
                    <EditIcon />
                  </IconButton>
                  <IconButton
                    color="error"
                    onClick={() => cliente.id && handleDelete(cliente.id)}
                  >
                    <DeleteIcon />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>
          {dialogMode === 'create' ? 'Registrar Cliente' : 'Editar Cliente'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 2 }}>
            <Stack spacing={2}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  fullWidth
                  label="Nombre"
                  value={formData.name}
                  onChange={(e) => handleInputChange('name', e.target.value)}
                />
                <TextField
                  fullWidth
                  label="Teléfono"
                  value={formData.phone}
                  onChange={(e) => handleInputChange('phone', e.target.value)}
                />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  fullWidth
                  label="Email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                />
                <TextField
                  fullWidth
                  label="Empresa"
                  value={formData.company}
                  onChange={(e) => handleInputChange('company', e.target.value)}
                />
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  fullWidth
                  label="NIT de la Empresa"
                  type="number"
                  value={formData.companyTin}
                  onChange={(e) => handleInputChange('companyTin', parseInt(e.target.value) || 0)}
                />
                <TextField
                  fullWidth
                  label={dialogMode === 'create' ? 'Contraseña' : 'Nueva Contraseña (opcional)'}
                  type="password"
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                />
              </Stack>
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancelar</Button>
          <Button variant="contained" onClick={handleSubmit}>
            {dialogMode === 'create' ? 'Registrar' : 'Guardar'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
