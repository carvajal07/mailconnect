import { useEffect } from 'react';
import { useParams, Navigate, Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Container,
  Typography,
  Button,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  Link,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { MailConnectLogo } from '../../components/MailConnectLogo';
import { LEGAL_DOCS, getLegalDoc, COMPANY } from './legalContent';

/**
 * Página legal genérica: renderiza el documento correspondiente a /legal/:slug
 * (Habeas Data, Términos, Anti-spam, Privacidad). Theme-aware (claro/oscuro).
 */
export const LegalPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const doc = getLegalDoc(slug);

  // Al abrir una página legal (o cambiar de una a otra), arranca arriba.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  if (!doc) return <Navigate to="/" replace />;

  return (
    <Box sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100vh' }}>
      {/* Barra superior */}
      <Box
        component="header"
        sx={{
          borderBottom: '1px solid',
          borderColor: 'divider',
          position: 'sticky',
          top: 0,
          bgcolor: 'background.paper',
          zIndex: 10,
        }}
      >
        <Container maxWidth="md">
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ py: 1.5 }}>
            <RouterLink to="/" style={{ display: 'inline-flex', alignItems: 'center' }} aria-label="Ir al inicio">
              <MailConnectLogo height={34} />
            </RouterLink>
            <Button component={RouterLink} to="/" startIcon={<ArrowBackIcon />} size="small">
              Volver al inicio
            </Button>
          </Stack>
        </Container>
      </Box>

      {/* Contenido del documento */}
      <Container maxWidth="md" sx={{ py: { xs: 4, md: 6 } }}>
        <Typography variant="h4" fontWeight={800} gutterBottom>
          {doc.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Última actualización: {COMPANY.updated}
        </Typography>

        <Typography variant="body1" sx={{ mb: 4, lineHeight: 1.75 }}>
          {doc.intro}
        </Typography>

        {doc.sections.map((sec, i) => (
          <Box key={i} sx={{ mb: 3.5 }}>
            {sec.heading && (
              <Typography variant="h6" fontWeight={700} sx={{ mb: 1 }}>
                {sec.heading}
              </Typography>
            )}
            {sec.body?.map((p, j) => (
              <Typography key={j} variant="body1" sx={{ mb: 1.25, lineHeight: 1.75 }}>
                {p}
              </Typography>
            ))}
            {sec.list && (
              <List dense sx={{ listStyleType: 'disc', pl: 3, py: 0 }}>
                {sec.list.map((item, k) => (
                  <ListItem key={k} sx={{ display: 'list-item', px: 0, py: 0.25 }}>
                    <ListItemText primaryTypographyProps={{ sx: { lineHeight: 1.7 } }} primary={item} />
                  </ListItem>
                ))}
              </List>
            )}
          </Box>
        ))}

        <Divider sx={{ my: 4 }} />

        {/* Navegación entre documentos legales */}
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          Otros documentos legales
        </Typography>
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mb: 3 }}>
          {LEGAL_DOCS.filter((d) => d.slug !== doc.slug).map((d) => (
            <Link key={d.slug} component={RouterLink} to={`/legal/${d.slug}`} underline="hover">
              {d.title}
            </Link>
          ))}
        </Stack>

        <Typography variant="caption" color="text.secondary">
          © 2026 {COMPANY.brand} · {COMPANY.web} · Para dudas sobre datos personales escribe a{' '}
          <Link href={`mailto:${COMPANY.dataEmail}`} underline="hover">
            {COMPANY.dataEmail}
          </Link>
          .
        </Typography>
      </Container>
    </Box>
  );
};
