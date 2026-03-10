import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MoodIcon from '@mui/icons-material/Mood';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useI18n } from '../../i18n/I18nContext.jsx';

export default function ExpressionPanel({
  modelLoaded,
  expressions,
  availableExpressionFiles,
  isParsingModelFiles,
  manualExpressionFiles,
  onManualExpressionFilesChange,
  onParseManualExpressionFiles,
  newExpressionName,
  onNewExpressionNameChange,
  onAddExpression,
  onRemoveExpression,
  onLinkExpressionFile,
  onUploadExpressionFile,
  onClearExpressionFile,
  onSetExpression,
  onOpenClickAreaAssociation,
}) {
  const { t } = useI18n();
  return (
    <Accordion
      disableGutters
      elevation={0}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 1, '&::before': { display: 'none' } }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center">
          <MoodIcon fontSize="small" />
          <Typography sx={{ fontWeight: 600 }}>{t('expression.title')}</Typography>
          <Chip size="small" label={t('common.countItems', { count: expressions.length })} />
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          <TextField
            label={t('expression.manualInput')}
            value={manualExpressionFiles}
            onChange={(event) => onManualExpressionFilesChange(event.target.value)}
            multiline
            minRows={3}
            placeholder={t('expression.manualPlaceholder')}
            size="small"
            fullWidth
          />
          <Button variant="outlined" onClick={onParseManualExpressionFiles} disabled={isParsingModelFiles}>
            {isParsingModelFiles ? t('expression.parsing') : t('expression.parse')}
          </Button>

          {availableExpressionFiles.length > 0 && (
            <Box>
              <Typography variant="body2" sx={{ mb: 1 }}>
                {t('expression.availableFiles')}
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {availableExpressionFiles.map((file) => (
                  <Chip key={file.path} size="small" variant="outlined" label={file.name} />
                ))}
              </Stack>
            </Box>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              label={t('expression.newName')}
              value={newExpressionName}
              onChange={(event) => onNewExpressionNameChange(event.target.value)}
              size="small"
              fullWidth
            />
            <Button variant="outlined" onClick={onAddExpression} disabled={!newExpressionName.trim()}>
              {t('expression.add')}
            </Button>
          </Stack>

          <Divider />

          {expressions.map((expression) => (
            <Box key={expression.id} sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 1 }}>
              <Stack spacing={1}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {expression.name}
                  </Typography>
                  <Button
                    size="small"
                    color="error"
                    variant="text"
                    onClick={() => onRemoveExpression(expression.id)}
                    disabled={expressions.length <= 1}
                  >
                    {t('common.delete')}
                  </Button>
                </Stack>

                {availableExpressionFiles.length > 0 && (
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    {availableExpressionFiles.map((file) => (
                      <Button
                        key={file.path}
                        size="small"
                        variant={expression.filePath === file.path ? 'contained' : 'outlined'}
                        onClick={() => onLinkExpressionFile(expression.id, file)}
                      >
                        {file.name}
                      </Button>
                    ))}
                  </Stack>
                )}

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="center">
                  <Button component="label" variant="outlined" size="small" startIcon={<UploadFileIcon />}>
                    {t('expression.upload')}
                    <input
                      hidden
                      type="file"
                      accept=".exp3.json"
                      onChange={(event) => onUploadExpressionFile(expression.id, event.target.files?.[0])}
                    />
                  </Button>
                  {expression.filePath && (
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      onClick={() => onClearExpressionFile(expression.id)}
                    >
                      {t('expression.clearFile')}
                    </Button>
                  )}
                </Stack>

                {expression.fileName && (
                  <Typography variant="caption" color="success.main">
                    {t('expression.linked', { fileName: expression.fileName })}
                  </Typography>
                )}

                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!modelLoaded}
                    onClick={() => onSetExpression(expression.id)}
                  >
                    {t('expression.apply')}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="primary"
                    onClick={() => onOpenClickAreaAssociation(expression.id, 'expression')}
                  >
                    {t('expression.clickArea')}
                    {Array.isArray(expression.clickAreas) && expression.clickAreas.length > 0
                      ? ` (${expression.clickAreas.length})`
                      : ''}
                  </Button>
                </Stack>
              </Stack>
            </Box>
          ))}
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
