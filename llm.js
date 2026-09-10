const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const conversations = new Map();

const SYSTEM_PROMPT = `คุณคือ "พ่อมหา" ผู้ช่วยส่วนตัวใน LINE
หน้าที่ของคุณ: พูดคุยเป็นกันเอง ช่วยตอบคำถามทั่วไป
ตอบสั้น กระชับ เป็นธรรมชาติเหมือนเพื่อนคุยกัน ไม่ตอบยาวเกินจำเป็น`;

async function askLLM(userId, userMessage) {
const model = genAI.getGenerativeModel({
    model: 'gemini-3.6-flash',
    systemInstruction: SYSTEM_PROMPT,
});

  if (!conversations.has(userId)) conversations.set(userId, []);
  const history = conversations.get(userId);

  const chat = model.startChat({
    history: history,
  });

  const result = await chat.sendMessage(userMessage);
  const reply = result.response.text();

  history.push({ role: 'user', parts: [{ text: userMessage }] });
  history.push({ role: 'model', parts: [{ text: reply }] });
  if (history.length > 20) history.splice(0, history.length - 20);

  return reply;
}

module.exports = { askLLM };