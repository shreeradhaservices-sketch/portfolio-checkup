const express = require('express');
const multer = require('multer');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseCasText, buildSummary } = require('./parser');
const { isCdslCas, buildCdslSummary } = require('./cdsl-parser');
const { isCamsClassicCas, buildCamsClassicSummary } = require('./cams-classic-parser');

const app = express();
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/analyze', upload.single('casFile'), (req, res) => {
  const uploadedPath = req.file ? req.file.path : null;
  const decryptedPath = uploadedPath ? uploadedPath + '_dec.pdf' : null;

  // Always clean up, whatever happens.
  const cleanup = () => {
    try { if (uploadedPath && fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath); } catch (e) {}
    try { if (decryptedPath && fs.existsSync(decryptedPath)) fs.unlinkSync(decryptedPath); } catch (e) {}
  };

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file was uploaded.' });
    }
    const password = (req.body.password || '').trim();
    if (!password) {
      cleanup();
      return res.status(400).json({ error: 'Please enter the PAN used to open your statement.' });
    }

    // Step 1: decrypt with qpdf. Wrong password -> qpdf exits non-zero.
    try {
      execFileSync('qpdf', ['--password=' + password, '--decrypt', uploadedPath, decryptedPath]);
    } catch (e) {
      cleanup();
      return res.status(400).json({ error: 'Could not open the file. Please check the PAN entered and try again.' });
    }

    // Step 2: extract text
    const rawText = execFileSync('pdftotext', ['-layout', decryptedPath, '-']).toString();

    // Step 3: parse + summarize (detect which CAS format this is)
    let summary;
    if (isCdslCas(rawText)) {
      summary = buildCdslSummary(rawText);
      cleanup();
      if (summary.schemeCount === 0 && summary.allocation.length === 0) {
        return res.status(422).json({ error: 'We could not read holdings from this file. It may be in a format we do not yet support.' });
      }
    } else if (isCamsClassicCas(rawText)) {
      summary = buildCamsClassicSummary(rawText);
      cleanup();
      if (summary.schemeCount === 0 && summary.allocation.length === 0) {
        return res.status(422).json({ error: 'We could not read holdings from this file. It may be in a format we do not yet support.' });
      }
    } else {
      const holdings = parseCasText(rawText);
      cleanup();
      if (holdings.length === 0) {
        return res.status(422).json({ error: 'We could not read holdings from this file. It may be in a format we do not yet support.' });
      }
      summary = buildSummary(holdings);
      summary.format = 'cams';
    }

    return res.json(summary);

  } catch (err) {
    cleanup();
    console.error('Analyze error:', err.message);
    return res.status(500).json({ error: 'Something went wrong while processing your statement. Please try again.' });
  }
});

// TEMPORARY debug route — helps us see the real statement's text layout
// so the parser can be tuned to match it. Automatically masks every digit
// so no real amounts, folio numbers, or PAN details ever leave your screen.
app.post('/api/debug-extract', upload.single('casFile'), (req, res) => {
  const uploadedPath = req.file ? req.file.path : null;
  const decryptedPath = uploadedPath ? uploadedPath + '_dec.pdf' : null;
  const cleanup = () => {
    try { if (uploadedPath && fs.existsSync(uploadedPath)) fs.unlinkSync(uploadedPath); } catch (e) {}
    try { if (decryptedPath && fs.existsSync(decryptedPath)) fs.unlinkSync(decryptedPath); } catch (e) {}
  };
  try {
    const password = (req.body.password || '').trim();
    execFileSync('qpdf', ['--password=' + password, '--decrypt', uploadedPath, decryptedPath]);
    const rawText = execFileSync('pdftotext', ['-layout', decryptedPath, '-']).toString();
    cleanup();
    // Mask every digit so no real numbers (values, PAN, folio, mobile) are ever shown.
    const masked = rawText.replace(/\d/g, '#');
    res.type('text/plain').send(masked);
  } catch (e) {
    cleanup();
    res.status(400).send('Could not open file. Check the password.');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Portfolio X-Ray running on port ' + PORT));
