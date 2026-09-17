const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const { createCalendarEvent } = require('./google-calendar');

const conversations = new Map();

const SYSTEM_PROMPT = `คุณคือ "พ่อมหา" ผู้ช่วยส่วนตัวใน LINE
หน้าที่ของคุณ: พูดคุยเป็นกันเอง ช่วยตอบคำถามทั่วไป
ตอบสั้น กระชับ เป็นธรรมชาติเหมือนเพื่อนคุยกัน ไม่ตอบยาวเกินจำเป็น`;

const tools = [{
  functionDeclarations: [
    {
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
    },
    {
      name: 'create_calendar_event',
      description: 'สร้างนัดหมายลงใน Google Calendar ของผู้ใช้ เรียกเมื่อผู้ใช้ขอให้นัดหมาย/จดตารางงาน/สร้างอีเวนต์',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'ชื่อของนัดหมาย' },
          start_time: { type: 'string', description: 'เวลาเริ่ม รูปแบบ ISO เช่น 2026-09-12T14:00:00+07:00' },
          end_time: { type: 'string', description: 'เวลาสิ้นสุด รูปแบบ ISO' },
        },
        required: ['title', 'start_time', 'end_time'],
      },
    },
    {
      name: 'add_todo',
      description: 'เพิ่มรายการสิ่งที่ต้องทำ เรียกเมื่อผู้ใช้บอกให้จดงาน/จดสิ่งที่ต้องทำไว้ (ไม่ใช่การเตือนตามเวลา)',
      parameters: {
        type: 'object',
        properties: { task: { type: 'string', description: 'สิ่งที่ต้องทำ' } },
        required: ['task'],
      },
    },
    {
      name: 'list_todos',
      description: 'แสดงรายการสิ่งที่ต้องทำทั้งหมดที่ยังไม่เสร็จ เรียกเมื่อผู้ใช้ถามว่ามีอะไรต้องทำบ้าง',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'complete_todo',
      description: 'ทำเครื่องหมายว่างานเสร็จแล้ว เรียกเมื่อผู้ใช้บอกว่าทำสิ่งนั้นเสร็จแล้ว',
      parameters: {
        type: 'object',
        properties: { task: { type: 'string', description: 'ชื่องานที่ทำเสร็จแล้ว (เอามาจากที่ผู้ใช้พูด)' } },
        required: ['task'],
      },
    },
    {
      name: 'label_last_image',
      description: 'ตั้งชื่อ/ป้ายกำกับให้รูปล่าสุดที่ผู้ใช้เพิ่งส่งมา เรียกเมื่อผู้ใช้บอกให้ตั้งชื่อรูป',
      parameters: {
        type: 'object',
        properties: { label: { type: 'string', description: 'ชื่อที่จะตั้งให้รูป' } },
        required: ['label'],
      },
    },
    {
      name: 'list_images',
      description: 'แสดงรายการรูปที่เคยเก็บไว้ทั้งหมด เรียกเมื่อผู้ใช้ถามว่ามีรูปอะไรเก็บไว้บ้าง',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'get_image',
      description: 'ดึงลิงก์รูปที่เคยเก็บไว้ตามชื่อที่ตั้ง เรียกเมื่อผู้ใช้ขอดูรูปที่เคยตั้งชื่อไว้',
      parameters: {
        type: 'object',
        properties: { label: { type: 'string', description: 'ชื่อรูปที่ต้องการดู' } },
        required: ['label'],
      },
    },
    {
      name: 'delete_image',
      description: 'ลบรูปที่เคยเก็บไว้ เรียกเมื่อผู้ใช้ขอให้ลบรูป',
      parameters: {
        type: 'object',
        properties: { label: { type: 'string', description: 'ชื่อรูปที่ต้องการลบ' } },
        required: ['label'],
      },
    },
  ],
}];

async function saveReminder(userId, title, remindAt) {
  await supabase.from('reminders').insert({ user_id: userId, title, remind_at: remindAt });
}

async function addTodo(userId, task) {
  await supabase.from('todos').insert({ user_id: userId, task });
}

async function listTodos(userId) {
  const { data } = await supabase.from('todos').select('task').eq('user_id', userId).eq('done', false);
  return data || [];
}

async function completeTodo(userId, task) {
  const { data } = await supabase.from('todos').select('id, task').eq('user_id', userId).eq('done', false);
  const match = data?.find(t => t.task.includes(task) || task.includes(t.task));
  if (match) {
    await supabase.from('todos').update({ done: true }).eq('id', match.id);
    return match.task;
  }
  return null;
}

async function labelLastImage(userId, label) {
  const { data } = await supabase.from('images').select('id').eq('user_id', userId).order('created_at', { ascending: false }).limit(1);
  if (!data || data.length === 0) return false;
  await supabase.from('images').update({ label }).eq('id', data[0].id);
  return true;
}

async function listImages(userId) {
  const { data } = await supabase.from('images').select('label, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(10);
  return data || [];
}

async function getImageUrl(userId, label) {
  const { data } = await supabase.from('images').select('file_path, label').eq('user_id', userId);
  const match = data?.find(r => r.label && (r.label.includes(label) || label.includes(r.label)));
  if (!match) return null;
  const { data: urlData } = supabase.storage.from('files').getPublicUrl(match.file_path);
  return urlData.publicUrl;
}

async function deleteImage(userId, label) {
  const { data } = await supabase.from('images').select('id, file_path, label').eq('user_id', userId);
  const match = data?.find(r => r.label && (r.label.includes(label) || label.includes(r.label)));
  if (!match) return null;
  await supabase.storage.from('files').remove([match.file_path]);
  await supabase.from('images').delete().eq('id', match.id);
  return match.label;
}

async function askLLM(userId, userMessage) {
  try {
    const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

    const { data: userRow } = await supabase.from('users').select('nickname, tone').eq('user_id', userId).single();
    const personalizedPrompt = SYSTEM_PROMPT
      + (userRow?.nickname ? `\nเรียกผู้ใช้ว่า "${userRow.nickname}"` : '')
      + (userRow?.tone ? `\nโทนการพูด: ${userRow.tone}` : '')
      + `\nเวลาปัจจุบันคือ ${now} (เขตเวลาไทย)`;

    const model = genAI.getGenerativeModel({
      model: 'gemini-3.1-flash-lite',
      tools,
      systemInstruction: personalizedPrompt,
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
    } else if (call && call.name === 'create_calendar_event') {
      const { data: userRow2 } = await supabase.from('users').select('google_refresh_token').eq('user_id', userId).single();
      if (!userRow2 || !userRow2.google_refresh_token) {
        reply = `ยังไม่ได้เชื่อมต่อ Google Calendar เลยนะ เชื่อมก่อนได้ที่ลิงก์นี้: https://pormaha-bot.onrender.com/connect-calendar?userId=${userId}`;
      } else {
        const link = await createCalendarEvent(userRow2.google_refresh_token, call.args.title, call.args.start_time, call.args.end_time);
        reply = `นัดหมายเรียบร้อยแล้วนะ: ${link}`;
      }
    } else if (call && call.name === 'add_todo') {
      await addTodo(userId, call.args.task);
      reply = `จดไว้แล้วนะ: "${call.args.task}"`;
    } else if (call && call.name === 'list_todos') {
      const todos = await listTodos(userId);
      reply = todos.length
        ? `สิ่งที่ต้องทำตอนนี้มี:\n${todos.map((t, i) => `${i + 1}. ${t.task}`).join('\n')}`
        : `ตอนนี้ไม่มีสิ่งที่ต้องทำค้างอยู่เลยนะ`;
    } else if (call && call.name === 'complete_todo') {
      const done = await completeTodo(userId, call.args.task);
      reply = done ? `เก่งมาก! "${done}" เสร็จแล้วนะ` : `หางานนี้ไม่เจอในลิสต์เลย ลองพูดชื่องานให้ตรงกว่านี้ดูนะ`;
    } else if (call && call.name === 'label_last_image') {
      const ok = await labelLastImage(userId, call.args.label);
      reply = ok ? `ตั้งชื่อรูปว่า "${call.args.label}" ให้แล้วนะ` : `ยังไม่มีรูปที่เก็บไว้เลย ส่งรูปมาก่อนนะ`;
    } else if (call && call.name === 'list_images') {
      const images = await listImages(userId);
      reply = images.length
        ? `รูปที่เก็บไว้มี:\n${images.map((im, i) => `${i + 1}. ${im.label || '(ยังไม่ได้ตั้งชื่อ)'}`).join('\n')}`
        : `ยังไม่มีรูปที่เก็บไว้เลยนะ`;
    } else if (call && call.name === 'get_image') {
      const url = await getImageUrl(userId, call.args.label);
      reply = url || `หารูปชื่อนี้ไม่เจอเลยนะ`;
    } else if (call && call.name === 'delete_image') {
      const deleted = await deleteImage(userId, call.args.label);
      reply = deleted ? `ลบรูป "${deleted}" ให้แล้วนะ` : `หารูปชื่อนี้ไม่เจอเลยนะ`;
    } else {
      reply = result.response.text();
    }

    history.push({ role: 'user', parts: [{ text: userMessage }] });
    history.push({ role: 'model', parts: [{ text: reply }] });
    if (history.length > 20) history.splice(0, history.length - 20);

    return reply;
  } catch (err) {
    console.error('askLLM error:', err);
    return 'ขอโทษนะ ตอนนี้พ่อมหาตอบไม่ได้ ลองพิมพ์ใหม่อีกครั้งนะ';
  }
}

module.exports = { askLLM };