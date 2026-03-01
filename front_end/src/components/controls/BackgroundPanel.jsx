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
  return (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center">
          <WallpaperIcon fontSize="small" />
          <Typography sx={{ fontWeight: 600 }}>背景控制</Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button component="label" variant="outlined" startIcon={<UploadFileIcon />}>
              上传背景
              <input
                hidden
                type="file"
                accept="image/*"
                onChange={(event) => onUploadBackground(event.target.files?.[0])}
              />
            </Button>
            <Button variant="outlined" color="error" disabled={!hasBackground} onClick={onClearBackground}>
              清除当前背景
            </Button>
          </Stack>

          <Box>
            <Typography variant="body2" sx={{ mb: 1 }}>
              背景透明度: {(backgroundOpacity * 100).toFixed(0)}%
            </Typography>
            <Slider
              value={backgroundOpacity}
              min={0}
              max={1}
              step={0.01}
              onChange={(_, value) => onUpdateBackgroundOpacity(Number(value))}
            />
          </Box>

          <Typography variant="body2">缓存背景 ({cachedBackgrounds.length})</Typography>
          {cachedBackgrounds.length > 0 && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <Button variant="outlined" color="error" onClick={onClearAllCache}>
                清空缓存
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
                    应用
                  </Button>
                  <Button size="small" color="error" onClick={() => onRemoveCachedBackground(item.id)}>
                    删除
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
