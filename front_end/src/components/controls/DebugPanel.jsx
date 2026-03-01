import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import BugReportIcon from '@mui/icons-material/BugReport';

export default function DebugPanel({
  debugInfo,
  modelLoaded,
  isTestingLipSync,
  onTestLipSync,
  onTestRandomMotion,
}) {
  return (
    <Accordion defaultExpanded>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={1} alignItems="center">
          <BugReportIcon fontSize="small" />
          <Typography sx={{ fontWeight: 600 }}>调试面板</Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={2}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Button
              size="small"
              variant="outlined"
              onClick={onTestLipSync}
              disabled={!modelLoaded || isTestingLipSync}
            >
              {isTestingLipSync ? '口型测试中' : '测试口型同步'}
            </Button>
            <Button size="small" variant="outlined" onClick={onTestRandomMotion} disabled={!modelLoaded}>
              测试随机动作
            </Button>
          </Stack>

          <Box>
            <TextField
              value={debugInfo}
              multiline
              minRows={8}
              maxRows={16}
              fullWidth
              InputProps={{
                readOnly: true,
              }}
            />
          </Box>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}
