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
  return (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center">
          <SaveIcon fontSize="small" />
          <Typography sx={{ fontWeight: 600 }}>预设管理</Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              size="small"
              fullWidth
              label="预设名称"
              value={newPresetName}
              onChange={(event) => onNewPresetNameChange(event.target.value)}
            />
            <Button variant="outlined" onClick={onSavePreset}>
              保存预设
            </Button>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button variant="outlined" onClick={onImportPreset}>
              导入预设
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
              暂无已保存预设
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
                        加载
                      </Button>
                      <Button size="small" onClick={() => onExportPreset(preset)}>
                        导出
                      </Button>
                      <Button size="small" color="error" onClick={() => onDeletePreset(preset.name)}>
                        删除
                      </Button>
                    </Stack>
                  }
                >
                  <Box sx={{ mr: 14 }}>
                    <ListItemText
                      primary={preset.name}
                      secondary={`${preset.modelName || '未知模型'} · ${preset.createdAt || ''}`}
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
