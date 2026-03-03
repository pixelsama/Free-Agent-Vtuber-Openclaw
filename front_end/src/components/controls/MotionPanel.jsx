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
import MovieIcon from '@mui/icons-material/Movie';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useI18n } from '../../i18n/I18nContext.jsx';

export default function MotionPanel({
  modelLoaded,
  motions,
  availableMotionFiles,
  isParsingModelFiles,
  manualMotionFiles,
  onManualMotionFilesChange,
  onParseManualMotionFiles,
  newMotionName,
  onNewMotionNameChange,
  onAddMotion,
  onRemoveMotion,
  onLinkMotionFile,
  onUploadMotionFile,
  onClearMotionFile,
  onPlayMotion,
  onOpenClickAreaAssociation,
}) {
  const { t } = useI18n();
  return (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center">
          <MovieIcon fontSize="small" />
          <Typography sx={{ fontWeight: 600 }}>{t('motion.title')}</Typography>
          <Chip size="small" label={t('common.countItems', { count: motions.length })} />
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          <TextField
            label={t('motion.manualInput')}
            value={manualMotionFiles}
            onChange={(event) => onManualMotionFilesChange(event.target.value)}
            multiline
            minRows={3}
            placeholder={t('motion.manualPlaceholder')}
            size="small"
            fullWidth
          />
          <Button variant="outlined" onClick={onParseManualMotionFiles} disabled={isParsingModelFiles}>
            {isParsingModelFiles ? t('motion.parsing') : t('motion.parse')}
          </Button>

          {availableMotionFiles.length > 0 && (
            <Box>
              <Typography variant="body2" sx={{ mb: 1 }}>
                {t('motion.availableFiles')}
              </Typography>
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                {availableMotionFiles.map((file) => (
                  <Chip key={file.path} size="small" variant="outlined" label={file.name} />
                ))}
              </Stack>
            </Box>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              label={t('motion.newName')}
              value={newMotionName}
              onChange={(event) => onNewMotionNameChange(event.target.value)}
              size="small"
              fullWidth
            />
            <Button variant="outlined" onClick={onAddMotion} disabled={!newMotionName.trim()}>
              {t('motion.add')}
            </Button>
          </Stack>

          <Divider />

          {motions.map((motion) => (
            <Box key={motion.id} sx={{ p: 1.5, border: '1px solid #e5e7eb', borderRadius: 2 }}>
              <Stack spacing={1}>
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {motion.name}
                  </Typography>
                  <Button
                    size="small"
                    color="error"
                    variant="text"
                    onClick={() => onRemoveMotion(motion.id)}
                    disabled={motions.length <= 1}
                  >
                    {t('common.delete')}
                  </Button>
                </Stack>

                {availableMotionFiles.length > 0 && (
                  <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                    {availableMotionFiles.map((file) => (
                      <Button
                        key={file.path}
                        size="small"
                        variant={motion.filePath === file.path ? 'contained' : 'outlined'}
                        onClick={() => onLinkMotionFile(motion.id, file)}
                      >
                        {file.name}
                      </Button>
                    ))}
                  </Stack>
                )}

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="center">
                  <Button component="label" variant="outlined" size="small" startIcon={<UploadFileIcon />}>
                    {t('motion.upload')}
                    <input
                      hidden
                      type="file"
                      accept=".motion3.json"
                      onChange={(event) => onUploadMotionFile(motion.id, event.target.files?.[0])}
                    />
                  </Button>
                  {motion.filePath && (
                    <Button
                      size="small"
                      color="error"
                      variant="outlined"
                      onClick={() => onClearMotionFile(motion.id)}
                    >
                      {t('motion.clearFile')}
                    </Button>
                  )}
                </Stack>

                {motion.fileName && (
                  <Typography variant="caption" color="success.main">
                    {t('motion.linked', { fileName: motion.fileName })}
                  </Typography>
                )}

                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!modelLoaded}
                    onClick={() => onPlayMotion(motion.group, motion.index, motion.id)}
                  >
                    {t('motion.play')}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="primary"
                    onClick={() => onOpenClickAreaAssociation(motion.id, 'motion')}
                  >
                    {t('motion.clickArea')}
                    {Array.isArray(motion.clickAreas) && motion.clickAreas.length > 0
                      ? ` (${motion.clickAreas.length})`
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
