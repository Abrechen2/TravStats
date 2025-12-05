const MsgReader = require('@kenjiuno/msgreader');
const fs = require('fs');
const path = require('path');

const SAMPLE_EMAILS_DIR = path.join(process.cwd(), '..', 'Sample Emails');

const files = fs.readdirSync(SAMPLE_EMAILS_DIR).filter(f => f.endsWith('.msg'));

files.forEach(file => {
  const filepath = path.join(SAMPLE_EMAILS_DIR, file);
  try {
    const buffer = fs.readFileSync(filepath);
    const msgReader = new MsgReader(buffer);
    const data = msgReader.getFileData();
    
    console.log('\n' + '='.repeat(80));
    console.log(`FILE: ${file}`);
    console.log('='.repeat(80));
    console.log('SUBJECT:', data.subject);
    console.log('\nBODY (first 3000 chars):');
    console.log(data.body.substring(0, 3000));
    console.log('\n...\n');
  } catch (e) {
    console.error(`ERROR reading ${file}:`, e.message);
  }
});
