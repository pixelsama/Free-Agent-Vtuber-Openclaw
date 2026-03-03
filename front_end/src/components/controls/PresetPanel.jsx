import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Divider,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SaveIcon from '@mui/icons-material/Save';
import { useI18n } from '../../i18n/I18nContext.jsx';

export default function PresetPanel({
  newPresetName,
  onNewPresetNameChange,
  onSavePreset,
  savedPresets,
  onLoadPreset,
  onExportPreset,
  onDeletePreset,
  presetFileInputRef,
  onImportPreset,
  onHandlePresetFileImport,
}) {
  const { t } = useI18n();
  return (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center">
          <SaveIcon fontSize="small" />
          <Typography sx={{ fontWeight: 600 }}>{t('preset.title')}</Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              size="small"
              fullWidth
              label={t('preset.name')}
              value={newPresetName}
              onChange={(event) => onNewPresetNameChange(event.target.value)}
            />
            <Button variant="outlined" onClick={onSavePreset}>
              {t('preset.save')}
            </Button>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button variant="outlined" onClick={onImportPreset}>
              {t('preset.import')}
            </Button>
            <input
              ref={presetFileInputRef}
              hidden
              type="file"
              accept=".json"
              onChange={onHandlePresetFileImport}
            />
          </Stack>

          <Divider />

          {savedPresets.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              {t('preset.empty')}
            </Typography>
          )}

          {savedPresets.length > 0 && (
            <List disablePadding>
              {savedPresets.map((preset) => (
                <ListItem
                  key={preset.name}
                  sx={{ px: 0 }}
                  secondaryAction={
                    <Stack direction="row" spacing={1}>
                      <Button size="small" onClick={() => onLoadPreset(preset)}>
                        {t('preset.load')}
                      </Button>
                      <Button size="small" onClick={() => onExportPreset(preset)}>
                        {t('preset.export')}
                      </Button>
                      <Button size="small" color="error" onClick={() => onDeletePreset(preset.name)}>
                        {t('preset.delete')}
                      </Button>
                    </Stack>
                  }
                >
                  <Box sx={{ mr: 14 }}>
                    <ListItemText
                      primary={preset.name}
                      secondary={`${preset.modelName || t('preset.unknownModel')} · ${preset.createdAt || ''}`}
                    />
                  </Box>
                </ListItem>
              ))}
            </List>
          )}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
