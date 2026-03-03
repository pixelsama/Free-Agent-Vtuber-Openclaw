import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Card,
  CardActions,
  CardMedia,
  Slider,
  Stack,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import WallpaperIcon from '@mui/icons-material/Wallpaper';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useI18n } from '../../i18n/I18nContext.jsx';

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** power;
  return `${value.toFixed(2)} ${units[power]}`;
}

export default function BackgroundPanel({
  hasBackground,
  backgroundOpacity,
  cachedBackgrounds,
  onUploadBackground,
  onUpdateBackgroundOpacity,
  onClearBackground,
  onSelectCachedBackground,
  onRemoveCachedBackground,
  onClearAllCache,
}) {
  const { t } = useI18n();
  return (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center">
          <WallpaperIcon fontSize="small" />
          <Typography sx={{ fontWeight: 600 }}>{t('background.title')}</Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button component="label" variant="outlined" startIcon={<UploadFileIcon />}>
              {t('background.upload')}
              <input
                hidden
                type="file"
                accept="image/*"
                onChange={(event) => onUploadBackground(event.target.files?.[0])}
              />
            </Button>
            <Button variant="outlined" color="error" disabled={!hasBackground} onClick={onClearBackground}>
              {t('background.clearCurrent')}
            </Button>
          </Stack>

          <Box>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {t('background.opacity', { opacity: (backgroundOpacity * 100).toFixed(0) })}
            </Typography>
            <Slider
              value={backgroundOpacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(_, value) => onUpdateBackgroundOpacity(Number(value))}
            />
          </Box>

          <Typography variant="body2">
            {t('background.cached', { count: cachedBackgrounds.length })}
          </Typography>
          {cachedBackgrounds.length > 0 && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button variant="outlined" color="error" onClick={onClearAllCache}>
                {t('background.clearCache')}
              </Button>
            </Stack>
          )}

          <Stack spacing={1}>
            {cachedBackgrounds.map((item) => (
              <Card key={item.id} variant="outlined">
                <CardMedia
                  component="img"
                  height="100"
                  image={item.dataUrl}
                  alt={item.name}
                  sx={{ objectFit: 'cover' }}
                />
                <Box sx={{ p: 1 }}>
                  <Typography variant="caption" display="block" noWrap>
                    {item.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatFileSize(item.size)}
                  </Typography>
                </Box>
                <CardActions>
                  <Button size="small" onClick={() => onSelectCachedBackground(item)}>
                    {t('background.apply')}
                  </Button>
                  <Button size="small" color="error" onClick={() => onRemoveCachedBackground(item.id)}>
                    {t('background.delete')}
                  </Button>
                </CardActions>
              </Card>
            ))}
          </Stack>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
