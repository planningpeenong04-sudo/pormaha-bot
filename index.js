require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const { askLLM } = require('./llm');
const { createClient } = require('@supabase/supabase-js');

const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const app = express();

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

app.get('/', (req, res) => res.send('พ่อมหา bot ทำงานอยู่'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));