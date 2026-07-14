require('dotenv').config();
const { google } = require('googleapis');
const Anthropic = require('@anthropic-ai/sdk');
const nodemailer = require('nodemailer');
const cron = require('node-cron');

// --- AUTH ---
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });
const claude = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

// --- FETCH DATA FROM SHEETS ---
async function fetchSalesData() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SHEET_ID,
    range: 'Sheet1!A1:F100',
  });
  const [headers, ...rows] = res.data.values;
  return rows.map(row =>
    Object.fromEntries(headers.map((h, i) => [h, row[i] || '']))
  );
}

// --- GENERATE REPORT WITH CLAUDE ---
async function generateReport(data) {
  const message = await claude.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `You are a business analyst. Analyse this weekly sales data and generate a concise, formatted report with: 
1. Key highlights (what went well)
2. Underperformers (missed targets)
3. Regional insights
4. One actionable recommendation

Data:
${JSON.stringify(data, null, 2)}

Format it clearly for a business owner reading it Monday morning.`,
      },
    ],
  });
  return message.content[0].text;
}

// --- SEND EMAIL VIA MAILTRAP ---
async function sendReport(report) {
  const transporter = nodemailer.createTransport({
    host: 'sandbox.smtp.mailtrap.io',
    port: 2525,
    auth: {
      user: process.env.MAILTRAP_USER,
      pass: process.env.MAILTRAP_PASS,
    },
  });

  await transporter.sendMail({
    from: '"Weekly Report Bot" <bot@weeklyreport.com>',
    to: process.env.EMAIL_TO,
    subject: `📊 Weekly Sales Report — ${new Date().toDateString()}`,
    text: report,
  });

  console.log('✅ Report sent successfully!');
}

// --- MAIN PIPELINE ---
async function runReport() {
  console.log('🚀 Starting weekly report generation...');
  try {
    const data = await fetchSalesData();
    console.log(`📥 Fetched ${data.length} rows from Google Sheets`);

    const report = await generateReport(data);
    console.log('🤖 Claude generated the report');

    await sendReport(report);
  } catch (err) {
    if (err.message?.includes('sheets')) {
      console.error('❌ Google Sheets not connected:', err.message);
    } else if (err.message?.includes('anthropic') || err.status === 401) {
      console.error('❌ Unable to connect Claude API:', err.message);
    } else {
      console.error('❌ Mail delivery failed — notify developer:', err.message);
    }
  }
}

// --- CRON: Every Monday at 9am ---
cron.schedule('0 9 * * 1', () => {
  console.log('⏰ Cron triggered — Monday 9am');
  runReport();
});

// --- RUN ONCE NOW FOR TESTING ---
runReport();