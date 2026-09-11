const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const conversations = new Map();

const SYSTEM_PROMPT = `คุณคือ "พ่อมหา" ผู้ช่วยส่วนตัวใน LINE
หน้าที่ของคุณ: พูดคุยเป็นกันเอง ช่วยตอบคำถามทั่วไป
ตอบสั้น กระชับ เป็นธรรมชาติเหมือนเพื่อนคุยกัน ไม่ตอบยาวเกินจำเป็น`;

const tools = [{
  functionDeclarations: [{
    name: 'set_reminder',
    description: 'ตั้งการแจ้งเตือนให้ผู้ใช้ เรียกเมื่อผู้ใช้ขอให้เตือนเรื่องอะไรบางอย่างในเวลาที่กำหนด',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'หัวข้อเรื่องที่จะเตือน' },
        remind_at: { type: 'string', description: 'วันเวลาที่จะเตือน รูปแบบ ISO เช่น 2026-09-11T18:00:00+07:00' },
      },
      required: ['title', 'remind_at'],
    },
  }],
}];

async function saveReminder(userId, title, remindAt) {
  await supabase.from('reminders').insert({ user_id: userId, title, remind_at: remindAt });
}

async function askLLM(userId, userMessage) {
  const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

  const model = genAI.getGenerativeModel({
    model: 'gemini-3.6-flash',
    tools,
    systemInstruction: SYSTEM_PROMPT + `\nเวลาปัจจุบันคือ ${now} (เขตเวลาไทย)`,
  });

  if (!conversations.has(userId)) conversations.set(userId, []);
  const history = conversations.get(userId);

  const chat = model.startChat({ history });

  const result = await chat.sendMessage(userMessage);
  const call = result.response.functionCalls()?.[0];

  let reply;
  if (call && call.name === 'set_reminder') {
    await saveReminder(userId, call.args.title, call.args.remind_at);
    reply = `จำให้แล้วนะ จะเตือนเรื่อง "${call.args.title}" ให้`;
  } else {
    reply = result.response.text();
  }

  history.push({ role: 'user', parts: [{ text: userMessage }] });
  history.push({ role: 'model', parts: [{ text: reply }] });
  if (history.length > 20) history.splice(0, history.length - 20);

  return reply;
}

module.exports = { askLLM };