# 🎨 Paleta de Colores Dark/Cyberpunk

Esta es la guía completa de colores para el proyecto con tema oscuro y acentos neón electrizantes. Todos los colores están configurados en `theme.config.js` y se integran automáticamente con Material UI.

---

## 📋 Índice
- [Colores Base Oscuros](#colores-base-oscuros)
- [Colores de Acento Neón](#colores-de-acento-neón)
- [Colores de Estado](#colores-de-estado)
- [Colores para Cantidades](#colores-para-cantidades)
- [Colores Neutros](#colores-neutros)
- [Cómo Usar](#cómo-usar)
- [Ejemplos de Uso](#ejemplos-de-uso)

---

## 🌑 Colores Base Oscuros

### Dark Navy (Color Principal)
Usado para fondos principales, color primario de botones.

| Variante | Hex | Uso |
|----------|-----|-----|
| **Dark Navy** | `#0a1628` | Fondo principal, primary main |
| **Dark Blue** | `#1a2742` | Tarjetas, superficies, primary light |
| **Navy Blue** | `#2a3d5f` | Elementos secundarios |

### Teal Variants
Variantes alternativas de color base.

| Color | Hex | Uso |
|-------|-----|-----|
| **Teal Dark** | `#1e4756` | Alternativo oscuro |
| **Teal** | `#2d5f6f` | Elementos teal |
| **Cyan** | `#4a9fb8` | Cyan suave, transición |

```jsx
// Ejemplo de uso
<Box sx={{ 
  backgroundColor: 'primary.main',  // #0a1628
  color: 'white'
}}>
  Contenido con fondo dark navy
</Box>
```

---

## ⚡ Colores de Acento Neón (Electrizantes)

Estos colores tienen efectos de brillo y sombras neón para un aspecto futurista.

| Color | Hex | Uso Recomendado | Brillo |
|-------|-----|-----------------|--------|
| **Accent Cyan** | `#00c3ff` | Principal acento, info, enlaces | 🔵 Alto |
| **Accent Green** | `#00ff9d` | Éxito, confirmación, estados positivos | 🟢 Alto |
| **Purple Neon** | `#b74aff` | Premium, destacados especiales | 🟣 Medio |
| **Pink Neon** | `#ff006e` | Error, crítico, alerta importante | 🔴 Alto |
| **Yellow Neon** | `#ffed4e` | Advertencias, atención requerida | 🟡 Alto |

```jsx
// Ejemplo con acento cyan
<Typography sx={{ 
  color: theme => theme.palette.accent?.cyan || '#00c3ff',
  textShadow: '0 0 20px rgba(0, 195, 255, 0.6)'
}}>
  Texto con brillo neón
</Typography>
```

---

## ✅ Colores de Estado

### Success (Verde Neón)
Usado para confirmaciones, operaciones exitosas.

| Variante | Hex |
|----------|-----|
| **Main** | `#00ff9d` |
| **Light** | `#33ffb0` |
| **Dark** | `#00cc7d` |

```jsx
<Alert severity="success">Operación exitosa</Alert>
<Button color="success">Confirmar</Button>
```

### Warning (Amarillo Neón)
Usado para advertencias, atención requerida.

| Variante | Hex |
|----------|-----|
| **Main** | `#ffed4e` |
| **Light** | `#fff176` |
| **Dark** | `#ffd700` |

```jsx
<Alert severity="warning">Atención necesaria</Alert>
```

### Error (Rosa Neón)
Usado para errores, estados críticos, eliminaciones.

| Variante | Hex |
|----------|-----|
| **Main** | `#ff006e` |
| **Light** | `#ff3388` |
| **Dark** | `#cc0058` |

```jsx
<Alert severity="error">Error en la operación</Alert>
<TextField error helperText="Campo requerido" />
```

### Info (Cyan Neón)
Usado para información, mensajes informativos.

| Variante | Hex |
|----------|-----|
| **Main** | `#00c3ff` |
| **Light** | `#33d1ff` |
| **Dark** | `#009fcc` |

```jsx
<Alert severity="info">Información importante</Alert>
```

---

## 📊 Colores para Cantidades

Colores específicos para representar niveles de stock, cantidades, porcentajes.

| Estado | Hex | Uso | Rango |
|--------|-----|-----|-------|
| **Critical** | `#ff006e` | Crítico | < 10% |
| **Low** | `#ff6b35` | Bajo | 10-30% |
| **Medium** | `#ffed4e` | Medio | 30-70% |
| **High** | `#00ff9d` | Alto | > 70% |

```jsx
// Ejemplo: Indicador de stock con brillo
import { colorPalette } from './theme.config';

const getStockColor = (quantity, max) => {
  const percentage = (quantity / max) * 100;
  if (percentage < 10) return colorPalette.quantity.critical;
  if (percentage < 30) return colorPalette.quantity.low;
  if (percentage < 70) return colorPalette.quantity.medium;
  return colorPalette.quantity.high;
};

<Typography sx={{ 
  color: getStockColor(stock, maxStock),
  textShadow: `0 0 15px ${getStockColor(stock, maxStock)}`,
  fontWeight: 600
}}>
  Stock: {stock}
</Typography>
```

---

## ⚫ Colores Neutros (Grises Oscuros)

Escala de grises para fondos, bordes y elementos secundarios en tema oscuro.

| Nivel | Hex | Uso |
|-------|-----|-----|
| 50 | `#1a2742` | Fondo más claro |
| 100 | `#2a3d5f` | Superficies |
| 200 | `#3a4d6f` | Bordes suaves |
| 300 | `#4a5d7f` | Bordes visibles |
| 400 | `#5a6d8f` | Separadores |
| 500 | `#6a7d9f` | Texto deshabilitado |
| 600 | `#7a8daf` | Texto secundario claro |
| 700 | `#8a9dbf` | Texto secundario |
| 800 | `#9aadcf` | Texto secundario enfatizado |
| 900 | `#aabddf` | Texto secundario principal |

---

## 🎨 Fondos y Superficies

| Tipo | Hex | Uso |
|------|-----|-----|
| **Default** | `#0a1628` | Fondo general de la app (Dark Navy) |
| **Paper** | `#1a2742` | Tarjetas, modales (Dark Blue) |
| **Card** | `#2a3d5f` | Superficies de tarjetas (Navy Blue) |
| **Dark** | `#050b14` | Fondos extra oscuros |
| **Overlay** | `rgba(0,0,0,0.7)` | Modales, dropdowns |

---

## 📝 Colores de Texto

| Tipo | Hex | Uso |
|------|-----|-----|
| **Primary** | `#FFFFFF` | Texto principal (blanco) |
| **Secondary** | `#aabddf` | Texto secundario (gris claro azulado) |
| **Disabled** | `#6a7d9f` | Texto deshabilitado |
| **Hint** | `#4a5d7f` | Texto de ayuda |
| **Accent** | `#00c3ff` | Texto con énfasis (cyan) |

---

## 🚀 Cómo Usar

### 1. Configurar el tema en tu aplicación

En tu archivo `main.jsx` o `App.jsx`:

```jsx
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme, { colorPalette } from './theme.config';

function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* Tu aplicación */}
    </ThemeProvider>
  );
}

export default App;
```

### 2. Usar colores del tema en componentes

#### Opción A: Props de Material UI (Recomendado)
```jsx
<Button color="primary">Botón Primary</Button>
<Alert severity="success">Éxito con brillo neón</Alert>
<Chip color="error" label="Error" />
```

#### Opción B: Con sx prop y efectos neón
```jsx
<Box sx={{ 
  backgroundColor: 'primary.main',
  color: 'text.primary',
  padding: 3,
  borderRadius: 2,
  border: '2px solid',
  borderColor: 'info.main',
  boxShadow: '0 0 30px rgba(0, 195, 255, 0.3)',
  transition: 'all 0.3s ease',
  '&:hover': {
    boxShadow: '0 0 50px rgba(0, 195, 255, 0.6)',
    transform: 'translateY(-4px)'
  }
}}>
  Tarjeta con efecto neón
</Box>
```

#### Opción C: Acceso directo a la paleta
```jsx
import { colorPalette } from './theme.config';

<Typography sx={{ 
  color: colorPalette.accent.cyan,
  textShadow: '0 0 20px rgba(0, 195, 255, 0.6)'
}}>
  Texto con brillo cyan
</Typography>
```

#### Opción D: Con hook useTheme
```jsx
import { useTheme } from '@mui/material/styles';

function MyComponent() {
  const theme = useTheme();
  
  return (
    <Box sx={{ 
      backgroundColor: theme.palette.background.paper,
      color: theme.palette.text.primary,
      border: `2px solid ${theme.palette.info.main}`,
      boxShadow: '0 0 30px rgba(0, 195, 255, 0.3)'
    }}>
      Contenido
    </Box>
  );
}
```

---

## 💡 Ejemplos de Uso

### Login/Registro con tema oscuro
```jsx
<Box sx={{ 
  backgroundColor: 'background.default',
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundImage: 'linear-gradient(135deg, #0a1628 0%, #1a2742 100%)'
}}>
  <Card sx={{ 
    maxWidth: 450,
    p: 4,
    backgroundColor: 'background.paper',
    border: '2px solid',
    borderColor: 'rgba(74, 159, 184, 0.3)',
    boxShadow: '0 0 40px rgba(0, 195, 255, 0.2)',
    '&:hover': {
      borderColor: 'info.main',
      boxShadow: '0 0 60px rgba(0, 195, 255, 0.4)'
    }
  }}>
    <Typography 
      variant="h4" 
      sx={{ 
        color: 'info.main',
        textShadow: '0 0 20px rgba(0, 195, 255, 0.6)',
        mb: 3 
      }}
    >
      Iniciar Sesión
    </Typography>
    
    <TextField
      fullWidth
      label="Email"
      margin="normal"
      error={hasError}
      helperText={hasError && "Email inválido"}
      sx={{
        '& .MuiOutlinedInput-root': {
          '&.Mui-focused fieldset': {
            borderColor: 'info.main',
            boxShadow: '0 0 15px rgba(0, 195, 255, 0.3)'
          }
        }
      }}
    />
    
    <Button 
      fullWidth 
      variant="contained" 
      color="primary"
      sx={{ 
        mt: 3,
        boxShadow: '0 0 20px rgba(0, 195, 255, 0.3)',
        '&:hover': {
          boxShadow: '0 0 35px rgba(0, 195, 255, 0.6)'
        }
      }}
    >
      Entrar
    </Button>
  </Card>
</Box>
```

### Dashboard con indicadores neón
```jsx
import { colorPalette } from './theme.config';

<Grid container spacing={3}>
  {/* Card de éxito con brillo verde */}
  <Grid item xs={12} md={4}>
    <Card sx={{
      '&:hover': {
        borderColor: colorPalette.success.main,
        boxShadow: `0 0 40px ${colorPalette.success.main}40`
      }
    }}>
      <CardContent>
        <Typography color="text.secondary" gutterBottom>
          Ventas Totales
        </Typography>
        <Typography 
          variant="h4" 
          sx={{ 
            color: colorPalette.success.main,
            textShadow: `0 0 20px ${colorPalette.success.main}60`
          }}
        >
          +12.5%
        </Typography>
      </CardContent>
    </Card>
  </Grid>
  
  {/* Card de advertencia con brillo amarillo */}
  <Grid item xs={12} md={4}>
    <Card sx={{
      '&:hover': {
        borderColor: colorPalette.warning.main,
        boxShadow: `0 0 40px ${colorPalette.warning.main}40`
      }
    }}>
      <CardContent>
        <Typography color="text.secondary" gutterBottom>
          Stock Bajo
        </Typography>
        <Typography 
          variant="h4" 
          sx={{ 
            color: colorPalette.warning.main,
            textShadow: `0 0 20px ${colorPalette.warning.main}60`
          }}
        >
          15 items
        </Typography>
      </CardContent>
    </Card>
  </Grid>
  
  {/* Card de error con brillo rosa */}
  <Grid item xs={12} md={4}>
    <Card sx={{
      '&:hover': {
        borderColor: colorPalette.error.main,
        boxShadow: `0 0 40px ${colorPalette.error.main}40`
      }
    }}>
      <CardContent>
        <Typography color="text.secondary" gutterBottom>
          Pedidos Pendientes
        </Typography>
        <Typography 
          variant="h4" 
          sx={{ 
            color: colorPalette.error.main,
            textShadow: `0 0 20px ${colorPalette.error.main}60`
          }}
        >
          8
        </Typography>
      </CardContent>
    </Card>
  </Grid>
</Grid>
```

### Tabla con estados y efectos
```jsx
import { colorPalette } from './theme.config';

const getQuantityStyle = (quantity, max) => {
  const percentage = (quantity / max) * 100;
  let color = colorPalette.quantity.high;
  
  if (percentage < 10) color = colorPalette.quantity.critical;
  else if (percentage < 30) color = colorPalette.quantity.low;
  else if (percentage < 70) color = colorPalette.quantity.medium;
  
  return { 
    color,
    fontWeight: 'bold',
    textShadow: `0 0 15px ${color}60`
  };
};

<TableCell>
  <Typography sx={getQuantityStyle(item.stock, item.maxStock)}>
    {item.stock} / {item.maxStock}
  </Typography>
</TableCell>
```

### Botón con gradiente y efecto neón
```jsx
<Button
  variant="contained"
  sx={{
    background: 'linear-gradient(135deg, #0a1628, #2a3d5f)',
    border: '2px solid',
    borderColor: 'info.main',
    color: 'info.main',
    fontWeight: 600,
    boxShadow: '0 0 20px rgba(0, 195, 255, 0.3)',
    transition: 'all 0.3s ease',
    '&:hover': {
      background: 'linear-gradient(135deg, #1a2742, #3a4d7f)',
      boxShadow: '0 0 35px rgba(0, 195, 255, 0.6)',
      transform: 'translateY(-2px)'
    }
  }}
>
  Acción Principal
</Button>
```

### Badges con colores neón
```jsx
import { colorPalette } from './theme.config';

{/* Badge cyan con brillo */}
<Chip 
  label="Premium" 
  sx={{ 
    backgroundColor: colorPalette.accent.cyan,
    color: colorPalette.primary.main,
    fontWeight: 700,
    boxShadow: `0 0 20px ${colorPalette.accent.cyan}60`,
    '&:hover': {
      boxShadow: `0 0 30px ${colorPalette.accent.cyan}80`
    }
  }} 
/>

{/* Badge púrpura premium */}
<Chip 
  label="VIP" 
  sx={{ 
    backgroundColor: colorPalette.accent.purple,
    color: 'white',
    fontWeight: 700,
    boxShadow: `0 0 20px ${colorPalette.accent.purple}60`
  }} 
/>
```

---

## 🎯 Tips y Mejores Prácticas

1. **Efectos Neón**: Usa `textShadow` y `boxShadow` con colores de acento para lograr el efecto cyberpunk
2. **Transiciones**: Agrega `transition: 'all 0.3s ease'` para suavizar efectos hover
3. **Contraste**: El tema oscuro necesita buen contraste - usa colores neón brillantes sobre fondos oscuros
4. **Hover States**: Incrementa la intensidad del brillo en hover para feedback visual
5. **Jerarquía**: Usa Dark Navy (#0a1628) para fondo, Dark Blue (#1a2742) para tarjetas, y Navy Blue (#2a3d5f) para elementos elevados
6. **Gradientes**: Combina colores base oscuros con `linear-gradient` para profundidad
7. **Bordes**: Usa bordes con colores cyan semi-transparentes para definir elementos

---

## 🌟 Animaciones Recomendadas

```jsx
// Animación de pulso para elementos importantes
'@keyframes pulse': {
  '0%, 100%': {
    opacity: 1,
  },
  '50%': {
    opacity: 0.5,
  },
}

// Brillo rotativo en hover
'@keyframes glow': {
  'from': {
    boxShadow: '0 0 20px rgba(0, 195, 255, 0.4)',
  },
  'to': {
    boxShadow: '0 0 40px rgba(0, 195, 255, 0.8)',
  },
}
```

---

**Última actualización**: Noviembre 2024  
**Versión**: 1.0.0  
**Tema**: Dark/Cyberpunk con acentos neón
