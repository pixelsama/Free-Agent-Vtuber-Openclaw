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
  return (
    <Accordion>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center">
          <MoodIcon fontSize="small" />
          <Typography sx={{ fontWeight: 600 }}>表情控制</Typography>
          <Chip size="small" label={`${expressions.length} 个`} />
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          <TextField
            label="手动输入表情文件名（可选）"
            value={manualExpressionFiles}
            onChange={(event) => onManualExpressionFilesChange(event.target.value)}
            multiline
            minRows={3}
            placeholder={'留空可自动解析 model3.json；或每行一个文件名，例如:\nsmile_01\nangry_01'}
            size="small"
            fullWidth
          />
          <Button variant="outlined" onClick={onParseManualExpressionFiles} disabled={isParsingModelFiles}>
            {isParsingModelFiles ? '解析中...' : '自动解析（model3.json）/手动解析'}
          </Button>

          {availableExpressionFiles.length > 0 && (
            <Box>
              <Typography variant="body2" sx={{ mb: 1 }}>
                可用表情文件
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
              label="新表情名称"
              value={newExpressionName}
              onChange={(event) => onNewExpressionNameChange(event.target.value)}
              size="small"
              fullWidth
            />
            <Button variant="outlined" onClick={onAddExpression} disabled={!newExpressionName.trim()}>
              添加表情
            </Button>
          </Stack>

          <Divider />

          {expressions.map((expression) => (
            <Box key={expression.id} sx={{ p: 1.5, border: '1px solid #e5e7eb', borderRadius: 2 }}>
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
                    删除
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
                    上传表情文件
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
                      清除文件
                    </Button>
                  )}
                </Stack>

                {expression.fileName && (
                  <Typography variant="caption" color="success.main">
                    已关联: {expression.fileName}
                  </Typography>
                )}

                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!modelLoaded}
                    onClick={() => onSetExpression(expression.id)}
                  >
                    应用
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="primary"
                    onClick={() => onOpenClickAreaAssociation(expression.id, 'expression')}
                  >
                    点击区域
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
