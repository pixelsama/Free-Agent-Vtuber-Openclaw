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

export default function MotionPanel({
  modelLoaded,
  motions,
  availableMotionFiles,
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
  return (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center">
          <MovieIcon fontSize="small" />
          <Typography sx={{ fontWeight: 600 }}>动作控制</Typography>
          <Chip size="small" label={`${motions.length} 个`} />
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          <TextField
            label="手动输入动作文件名"
            value={manualMotionFiles}
            onChange={(event) => onManualMotionFilesChange(event.target.value)}
            multiline
            minRows={3}
            placeholder={'每行一个文件名，例如:\nidle_01\ntap_body_01'}
            size="small"
            fullWidth
          />
          <Button variant="outlined" onClick={onParseManualMotionFiles}>
            解析文件名
          </Button>

          {availableMotionFiles.length > 0 && (
            <Box>
              <Typography variant="body2" sx={{ mb: 1 }}>
                可用动作文件
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
              label="新动作名称"
              value={newMotionName}
              onChange={(event) => onNewMotionNameChange(event.target.value)}
              size="small"
              fullWidth
            />
            <Button variant="outlined" onClick={onAddMotion} disabled={!newMotionName.trim()}>
              添加动作
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
                    删除
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
                    上传动作文件
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
                      清除文件
                    </Button>
                  )}
                </Stack>

                {motion.fileName && (
                  <Typography variant="caption" color="success.main">
                    已关联: {motion.fileName}
                  </Typography>
                )}

                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!modelLoaded}
                    onClick={() => onPlayMotion(motion.group, motion.index, motion.id)}
                  >
                    播放
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="primary"
                    onClick={() => onOpenClickAreaAssociation(motion.id, 'motion')}
                  >
                    点击区域
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
