const express = require('express');
const multer = require('multer');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseCasText, buildSummary } = require('./parser');

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

    // Step 3: parse + summarize
    const holdings = parseCasText(rawText);
    cleanup(); // delete both files immediately, before responding

    if (holdings.length === 0) {
      return res.status(422).json({ error: 'We could not read holdings from this file. It may be in a format we do not yet support.' });
    }

    const summary = buildSummary(holdings);
    return res.json(summary);

  } catch (err) {
    cleanup();
    console.error('Analyze error:', err.message);
    return res.status(500).json({ error: 'Something went wrong while processing your statement. Please try again.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Portfolio X-Ray running on port ' + PORT));
