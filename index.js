require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const { askLLM } = require('./llm');

const config = {
  channelSecret: process.env.CHANNEL_SECRET,
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

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

app.get('/', (req, res) => res.send('พ่อมหา bot ทำงานอยู่'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));