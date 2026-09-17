require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const { askLLM } = require('./llm');
const { createClient } = require('@supabase/supabase-js');
const { getOAuthClient, getAuthUrl } = require('./google-calendar');
const cors = require('cors');

const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

const blobClient = new line.messagingApi.MessagingApiBlobClient({
  channelAccessToken: config.channelAccessToken,
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const app = express();
app.use(cors());

app.post('/webhook', line.middleware(config), async (req, res) => {
  res.status(200).end(); // ตอบ LINE ทันทีก่อนประมวลผล

  for (const event of req.body.events) {
    if (event.type === 'message' && event.message.type === 'text') {
      const userId = event.source.userId;
      const reply = await askLLM(userId, event.message.text);

      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: reply }],
      });
    } else if (event.type === 'message' && event.message.type === 'image') {
      const userId = event.source.userId;

      try {
        const stream = await blobClient.getMessageContent(event.message.id);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);

        const fileName = `${userId}/${event.message.id}.jpg`;

        const uploadResult = await supabase.storage.from('files').upload(fileName, buffer, { contentType: 'image/jpeg' });
        console.log('UPLOAD RESULT:', JSON.stringify(uploadResult));
        if (uploadResult.error) throw uploadResult.error;

        const insertResult = await supabase.from('images').insert({ user_id: userId, file_path: fileName });
        console.log('INSERT RESULT:', JSON.stringify(insertResult));
        if (insertResult.error) throw insertResult.error;

        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: 'เก็บรูปให้แล้วนะ 📸 อยากตั้งชื่อไหม พิมพ์ "ตั้งชื่อรูปล่าสุดว่า ..." ได้เลย' }],
        });
      } catch (err) {
        console.error('IMAGE UPLOAD ERROR:', err);
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: 'ขอโทษนะ เก็บรูปไม่สำเร็จ ลองส่งใหม่อีกครั้งนะ' }],
        });
      }
    }
  }
});

app.get('/check-reminders', async (req, res) => {
  const { data: due } = await supabase
    .from('reminders')
    .select('*')
    .lte('remind_at', new Date().toISOString())
    .eq('sent', false);

  for (const r of due) {
    await client.pushMessage({
      to: r.user_id,
      messages: [{ type: 'text', text: `⏰ ถึงเวลาแล้ว: ${r.title}` }],
    });
    await supabase.from('reminders').update({ sent: true }).eq('id', r.id);
  }
  res.send(`checked ${due.length} reminders`);
});

app.get('/connect-calendar', (req, res) => {
  const userId = req.query.userId;
  res.redirect(getAuthUrl(userId));
});

app.get('/oauth/callback', async (req, res) => {
  const { code, state: userId } = req.query;
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);

  const { error } = await supabase.from('users').upsert({ user_id: userId, google_refresh_token: tokens.refresh_token });
  if (error) console.error('Supabase upsert error:', error);

  res.send('เชื่อมต่อ Google Calendar สำเร็จแล้ว ปิดหน้านี้แล้วกลับไปคุยกับพ่อมหาได้เลย');
});

app.post('/update-settings', express.json(), async (req, res) => {
  const { userId, nickname, tone } = req.body;

  if (!userId) {
    console.error('update-settings called without userId');
    return res.status(400).json({ ok: false, error: 'missing userId' });
  }

  const { error } = await supabase.from('users').upsert({ user_id: userId, nickname, tone });
  if (error) {
    console.error('Supabase upsert error:', error);
    return res.status(500).json({ ok: false, error: error.message });
  }

  res.json({ ok: true });
});

app.get('/', (req, res) => res.send('พ่อมหา bot ทำงานอยู่'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));