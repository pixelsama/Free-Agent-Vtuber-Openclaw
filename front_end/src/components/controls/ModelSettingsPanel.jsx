import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SettingsSuggestIcon from '@mui/icons-material/SettingsSuggest';
import { useI18n } from '../../i18n/I18nContext.jsx';

export default function ModelSettingsPanel({
  modelLoaded,
  availableModels,
  selectedModel,
  onChangeModel,
  isImportingModel,
  onImportModelZip,
  modelLibraryError,
  autoEyeBlink,
  onToggleAutoEyeBlink,
  autoBreath,
  onToggleAutoBreath,
  eyeTracking,
  onToggleEyeTracking,
  modelScale,
  onChangeModelScale,
  onCommitModelScale,
  onResetModel,
}) {
  const { t } = useI18n();
  const hasModels = availableModels.length > 0;
  const selectValue = hasModels ? selectedModel || availableModels[0].path : '';
  const statusLabel = selectedModel
    ? (modelLoaded ? t('model.status.loaded') : t('model.status.loading'))
    : t('model.status.unloaded');
  const statusColor = selectedModel ? (modelLoaded ? 'success' : 'warning') : 'default';

  return (
    <Accordion
      defaultExpanded
      disableGutters
      elevation={0}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, '&::before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
          <SettingsSuggestIcon fontSize="small" />
          <Typography sx={{ fontWeight: 600 }}>{t('modelSettings.title')}</Typography>
          <Chip
            size="small"
            color={statusColor}
            label={statusLabel}
          />
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          <Button
            variant="outlined"
            onClick={onImportModelZip}
            disabled={isImportingModel}
          >
            {isImportingModel ? t('modelSettings.importing') : t('modelSettings.importZip')}
          </Button>

          <FormControl fullWidth size="small">
            <InputLabel id="model-select-label">{t('modelSettings.modelLabel')}</InputLabel>
            <Select
              labelId="model-select-label"
              value={selectValue}
              label={t('modelSettings.modelLabel')}
              disabled={!hasModels}
              onChange={(event) => onChangeModel(event.target.value)}
            >
              {!hasModels && (
                <MenuItem value="" disabled>
                  {t('modelSettings.noModels')}
                </MenuItem>
              )}
              {availableModels.map((model) => (
                <MenuItem key={model.path} value={model.path}>
                  {model.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {!hasModels && (
            <Typography variant="caption" color="text.secondary">
              {t('modelSettings.zipHint')}
            </Typography>
          )}

          {modelLibraryError && (
            <Typography variant="caption" color="error">
              {modelLibraryError}
            </Typography>
          )}

          <Box>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {t('modelSettings.scale', { scale: modelScale.toFixed(2) })}
            </Typography>
            <Slider
              value={modelScale}
              min={0.1}
              max={3}
              step={0.1}
              onChange={(_, value) => onChangeModelScale(Number(value))}
              onChangeCommitted={(_, value) => onCommitModelScale?.(Number(value))}
            />
          </Box>

          <FormControlLabel
            control={
              <Switch
                checked={autoEyeBlink}
                onChange={(event) => onToggleAutoEyeBlink(event.target.checked)}
              />
            }
            label={t('modelSettings.autoEyeBlink')}
          />
          <FormControlLabel
            control={
              <Switch
                checked={autoBreath}
                onChange={(event) => onToggleAutoBreath(event.target.checked)}
              />
            }
            label={t('modelSettings.autoBreath')}
          />
          <FormControlLabel
            control={
              <Switch
                checked={eyeTracking}
                onChange={(event) => onToggleEyeTracking(event.target.checked)}
              />
            }
            label={t('modelSettings.eyeTracking')}
          />

          <Button variant="outlined" onClick={onResetModel}>
            {t('modelSettings.reset')}
          </Button>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
