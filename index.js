require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const { askLLM, generateProactiveMessage } = require('./llm');
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

// เดาชนิดไฟล์คร่าวๆ จากนามสกุล (ใช้ตอนเก็บไฟล์ที่ไม่ใช่รูป)
function guessMimeFromName(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const map = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    txt: 'text/plain',
    zip: 'application/zip',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
  };
  return map[ext] || 'application/octet-stream';
}

// คำนวณรอบเตือนถัดไปสำหรับเตือนซ้ำ
function getNextOccurrence(currentDate, recurrence) {
  const next = new Date(currentDate);
  if (recurrence === 'daily') next.setDate(next.getDate() + 1);
  else if (recurrence === 'weekly') next.setDate(next.getDate() + 7);
  else if (recurrence === 'monthly') next.setMonth(next.getMonth() + 1);
  return next.toISOString();
}

app.post('/webhook', line.middleware(config), async (req, res) => {
  res.status(200).end(); // ตอบ LINE ทันทีก่อนประมวลผล

  for (const event of req.body.events) {
    if (event.source && event.source.userId) {
      await supabase.from('users').upsert({ user_id: event.source.userId, last_active_at: new Date().toISOString() });
    }

    if (event.type === 'message' && event.message.type === 'text') {
      const userId = event.source.userId;
      const reply = await askLLM(userId, event.message.text);

      await client.replyMessage({
        replyToken: event.replyToken,
        messages: [{ type: 'text', text: reply }],
      });
    } else if (event.type === 'message' && (event.message.type === 'image' || event.message.type === 'file')) {
      const userId = event.source.userId;
      const isImage = event.message.type === 'image';

      try {
        const stream = await blobClient.getMessageContent(event.message.id);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);

        const originalName = isImage ? `${event.message.id}.jpg` : (event.message.fileName || event.message.id);
        const mimeType = isImage ? 'image/jpeg' : guessMimeFromName(originalName);
        const storagePath = `${userId}/${event.message.id}_${originalName}`;

        const uploadResult = await supabase.storage.from('files').upload(storagePath, buffer, { contentType: mimeType });
        console.log('UPLOAD RESULT:', JSON.stringify(uploadResult));
        if (uploadResult.error) throw uploadResult.error;

        const insertResult = await supabase.from('images').insert({
          user_id: userId,
          file_path: storagePath,
          file_name: originalName,
          mime_type: mimeType,
        });
        console.log('INSERT RESULT:', JSON.stringify(insertResult));
        if (insertResult.error) throw insertResult.error;

        const successText = isImage
          ? 'เก็บรูปให้แล้วนะ 📸 อยากตั้งชื่อไหม พิมพ์ "ตั้งชื่อรูปล่าสุดว่า ..." ได้เลย'
          : 'เก็บไฟล์ให้แล้วนะ 📎 อยากตั้งชื่อไหม พิมพ์ "ตั้งชื่อไฟล์ล่าสุดว่า ..." ได้เลย';

        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: successText }],
        });
      } catch (err) {
        console.error('FILE UPLOAD ERROR:', err);
        await client.replyMessage({
          replyToken: event.replyToken,
          messages: [{ type: 'text', text: 'ขอโทษนะ เก็บไฟล์ไม่สำเร็จ ลองส่งใหม่อีกครั้งนะ' }],
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

    if (r.recurrence) {
      // เตือนซ้ำ: คำนวณรอบถัดไปแล้วรีเซ็ต ไม่ปิดถาวร
      const nextRemindAt = getNextOccurrence(r.remind_at, r.recurrence);
      await supabase.from('reminders').update({ remind_at: nextRemindAt }).eq('id', r.id);
    } else {
      await supabase.from('reminders').update({ sent: true }).eq('id', r.id);
    }
  }
  res.send(`checked ${due.length} reminders`);
});

app.get('/daily-greeting', async (req, res) => {
  const { data: users } = await supabase.from('users').select('user_id, nickname');
  let sentCount = 0;

  for (const u of users || []) {
    const { data: todos } = await supabase
      .from('todos')
      .select('task, due_date')
      .eq('user_id', u.user_id)
      .eq('done', false)
      .order('created_at', { ascending: true });

    const name = u.nickname ? u.nickname : 'เพื่อน';
    let text = `☀️ อรุณสวัสดิ์ ${name}! วันนี้พ่อมหามาทักทายก่อนใครเลย`;

    if (todos && todos.length > 0) {
      text += `\n\nงานที่ยังค้างอยู่มี:\n${todos.map((t, i) => `${i + 1}. ${t.task}`).join('\n')}\n\nลุยให้เสร็จๆ กันนะวันนี้ 💪`;
    } else {
      text += `\n\nตอนนี้ไม่มีงานค้างเลยนะ วันนี้สบายๆ ได้เลย 😊`;
    }

    try {
      await client.pushMessage({ to: u.user_id, messages: [{ type: 'text', text }] });
      sentCount++;
    } catch (err) {
      console.error('daily-greeting push error for', u.user_id, err);
    }
  }

  res.send(`sent daily greeting to ${sentCount} users`);
});

app.get('/proactive-checkin', async (req, res) => {
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  const { data: idleUsers } = await supabase
    .from('users')
    .select('user_id')
    .lt('last_active_at', sixHoursAgo)
    .or(`last_checkin_at.is.null,last_checkin_at.lt.${sixHoursAgo}`);

  let sentCount = 0;
  for (const u of idleUsers || []) {
    try {
      const text = await generateProactiveMessage(u.user_id);
      await client.pushMessage({ to: u.user_id, messages: [{ type: 'text', text }] });
      await supabase.from('users').update({ last_checkin_at: new Date().toISOString() }).eq('user_id', u.user_id);
      sentCount++;
    } catch (err) {
      console.error('proactive-checkin error for', u.user_id, err);
    }
  }

  res.send(`sent proactive check-in to ${sentCount} users`);
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