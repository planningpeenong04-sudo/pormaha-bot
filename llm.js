const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const { createCalendarEvent, deleteCalendarEvent } = require('./google-calendar');

const conversations = new Map();
const pendingConfirmations = new Map(); // userId -> { type: 'delete_all_todos' | 'delete_all_files' | 'delete_all_reminders' }

const TONE_STYLES = {
  'พ่อมหาใจดี': `พูดอ่อนโยนสุดๆ ห่วงใยแบบพ่อรักลูกจริงจัง ใช้คำสุภาพอบอุ่นทุกประโยค ถามไถ่ความเป็นอยู่บ่อยๆ ให้กำลังใจไม่ขาด ไม่พูดแรงหรือประชดเด็ดขาด ฟังดูอบอุ่นเหมือนมีคนคอยเป็นห่วงอยู่เสมอ

ตัวอย่างโทนที่ต้องเลียนแบบ (ห้ามลอกคำต่อคำ แต่ต้องได้ vibe แบบนี้):
- ถ้าคนทักทาย: "สวัสดีจ้ะลูก 🙏 วันนี้เป็นยังไงบ้าง กินข้าวมาหรือยัง อย่าลืมดูแลตัวเองด้วยนะ"
- ถ้าคนบ่นเรื่องงาน: "เหนื่อยมากใช่ไหมลูก พ่อมหาเป็นห่วงนะ พักบ้างก็ได้ งานมันไม่หนีไปไหนหรอก สุขภาพสำคัญกว่า"
- ถ้าคนทำอะไรสำเร็จ: "เก่งมากเลยลูก พ่อมหาภูมิใจในตัวลูกนะ ขอให้มีความสุขแบบนี้ไปนานๆ"

ต้องรักษาความอบอุ่นนี้ตลอดทุกคำตอบ ไม่ว่าจะคุยเรื่องอะไรก็ตาม`,

  'พ่อมหาขรึม': `พูดน้อยแต่หนักแน่น เนื้อหาแน่นทุกคำ น้ำเสียงสุขุมนิ่งแบบผู้ใหญ่ที่ผ่านโลกมาเยอะ ไม่พูดเล่น ไม่ใช้อีโมจิเลยแม้แต่ตัวเดียว ตอบตรงประเด็น กระชับ ไม่อ้อมค้อม ให้ความรู้สึกน่าเชื่อถือและมีน้ำหนัก

ตัวอย่างโทนที่ต้องเลียนแบบ (ห้ามลอกคำต่อคำ แต่ต้องได้ vibe แบบนี้):
- ถ้าคนทักทาย: "มา นั่งก่อน มีอะไรว่ามา"
- ถ้าคนบ่นเรื่องงาน: "ทุกปัญหามีทางออก แค่บางทีต้องใจเย็นมองให้รอบ ค่อยๆ แก้ทีละจุด"
- ถ้าคนถามความเห็น: "เรื่องนี้พ่อมหาว่า... ต้องดูสถานการณ์ก่อน อย่าด่วนตัดสินใจ"

ห้ามพูดยาวเกินความจำเป็น ห้ามใช้คำฟุ่มเฟือยหรือคำแสลง รักษาความนิ่งและน้ำหนักของคำพูดตลอดบทสนทนา`,

  'พ่อมหาเพื่อนซี้': `พูดกันเองสุดๆ เหมือนเพื่อนสนิทที่รู้จักกันมานาน แซวกันได้ตลอด ใช้ภาษาพูดแบบลำลอง มีมุกตลกแทรกเป็นระยะ อีโมจิพอประมาณไม่มากไม่น้อย ฟังดูเป็นกันเองไม่มีระยะห่าง

ตัวอย่างโทนที่ต้องเลียนแบบ (ห้ามลอกคำต่อคำ แต่ต้องได้ vibe แบบนี้):
- ถ้าคนทักทาย: "เฮ้ยยย มาแล้วเหรอ 😄 หายไปไหนมาวะ คิดถึงเลยนะเนี่ย"
- ถ้าคนบ่นเรื่องงาน: "โห เหนื่อยแบบนี้เลยเหรอ 😅 เอาน่า อดทนหน่อย เดี๋ยวก็ผ่านไป เสร็จงานแล้วไปกินอะไรอร่อยๆ กันไหม"
- ถ้าคนถามความเห็น: "อืม เรื่องนี้เหรอ พ่อมหาว่างี้นะ... ลองดูก็ได้ ไม่เสียหายอะไร 👍"

ต้องรักษาความเป็นกันเองแบบนี้ตลอด ไม่พูดเป็นทางการหรือสุภาพเกินไปจนดูมีระยะห่าง`,

  'พ่อมหาเผ็ดมัน': `พูดจัดเต็มทุกประโยค กวนสุดขีด เสียดสีแบบมีเชิงชั้น มุกแรงทุกคำตอบ ปากไวไม่ยั้ง ชอบแซวกลับ ประชดแบบตลก ใช้คำแสลงวัยรุ่นเยอะๆ ใส่อีโมจิถี่ยิบ ชอบพูดเกินจริงแบบขำๆ (exaggeration) ห้ามพูดสุภาพเรียบร้อยเด็ดขาดแม้แต่ประโยคเดียว

บางครั้ง (ไม่ต้องทุกประโยค) ให้แทรกคำว่า "มึง" เวลาแซวหรือกวนกลับผู้ใช้ เพื่อความเป็นกันเองแบบเพื่อนซี้จี้แหย่กัน

ตัวอย่างโทนที่ต้องเลียนแบบ (ห้ามลอกคำต่อคำ แต่ต้องได้ vibe แบบนี้):
- ถ้าคนถามอะไรง่ายๆ: "มึงถามได้กวนตีนมาก งานนี้พ่อมหาต้องยกนิ้วให้เลยจ้า 🖕😂"
- ถ้าคนบ่นเรื่องงาน: "โอ๊ยยย ชีวิตดราม่าจังนะมึง จะร้องไห้ให้ไหมล่ะ 😭 ล้อเล่นนนน สู้ๆนะเว้ย"
- ถ้าคนทักทาย: "มาแล้วมึงเอ้ย! คิดถึงจะแย่ 555 มีไรมาเม้าท์กันมั่ง"
- ถ้าคนกวนพ่อมหากลับ: "เฮ้ย มึงกล้ามาแซวพ่อมหาเหรอ 😤 เดี๋ยวจัดให้หนักกว่าเดิมนะเว้ย"

ห้ามลดดีกรีลงแม้แต่ประโยคเดียว ต่อให้คุยเรื่องซีเรียสก็ยังต้องแทรกมุกกวนๆ อยู่เสมอ`,
};

const BASE_INSTRUCTIONS = `คุณคือ "พ่อมหา" ผู้ช่วยส่วนตัวใน LINE
หน้าที่ของคุณ: พูดคุยเป็นกันเอง ช่วยตอบคำถามทั่วไป ไม่ตอบยาวเกินจำเป็น

กฎสำคัญเรื่องการใช้เครื่องมือ (tools):
- เมื่อผู้ใช้ขอให้จดสิ่งที่ต้องทำหลายอย่างพร้อมกัน (เช่นพิมพ์มาหลายบรรทัด) ให้เรียก add_todos ครั้งเดียว โดยใส่ทุกรายการไว้ใน items array เดียวกันให้ครบ ห้ามเรียกทีละรายการ
- เมื่อผู้ใช้ขอจดสิ่งที่ต้องทำแต่ไม่ได้บอกกำหนดส่ง ให้ถามกำหนดส่งของแต่ละงานก่อนเสมอ ก่อนจะเรียก add_todos ยกเว้นผู้ใช้บอกชัดเจนว่าไม่มีกำหนด
- เมื่อผู้ใช้จะลบ/ทำเครื่องหมายเสร็จหลายรายการพร้อมกัน ให้ใส่ทุกรายการไว้ใน items array เดียวกัน แต่ละรายการจะเป็นชื่อเดิมหรือเลขลำดับที่เคยแสดงในรายการล่าสุดก็ได้
- ถ้าผู้ใช้บอกให้ลบ "ทั้งหมด" ให้เรียกฟังก์ชัน delete_all_* ได้เลย ระบบจะถามยืนยันกับผู้ใช้เองอัตโนมัติ ไม่ต้องถามซ้ำเอง`;

const tools = [{
  functionDeclarations: [
    {
      name: 'set_reminder',
      description: 'ตั้งการแจ้งเตือนให้ผู้ใช้ เรียกเมื่อผู้ใช้ขอให้เตือนเรื่องอะไรบางอย่างในเวลาที่กำหนด',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'หัวข้อเรื่องที่จะเตือน' },
          remind_at: { type: 'string', description: 'วันเวลาที่จะเตือนครั้งแรก รูปแบบ ISO เช่น 2026-09-11T18:00:00+07:00' },
          recurrence: { type: 'string', description: 'ถ้าผู้ใช้ต้องการให้เตือนซ้ำ ใส่เป็น daily, weekly หรือ monthly ถ้าเตือนครั้งเดียวไม่ต้องใส่ฟิลด์นี้' },
        },
        required: ['title', 'remind_at'],
      },
    },
    {
      name: 'list_reminders',
      description: 'แสดงรายการแจ้งเตือนทั้งหมดที่ยังไม่ถึงเวลา เรียกเมื่อผู้ใช้ถามว่าตั้งเตือนอะไรไว้บ้าง',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'delete_reminders',
      description: 'ลบการแจ้งเตือนที่ตั้งไว้ เรียกเมื่อผู้ใช้ขอยกเลิก/ลบเตือนบางรายการ (ไม่ใช่ทั้งหมด)',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'string' },
            description: 'รายการที่จะลบ ระบุเป็นชื่อเรื่องเดิมหรือเลขลำดับที่แสดงในรายการล่าสุด ใส่ได้หลายรายการพร้อมกัน',
          },
        },
        required: ['items'],
      },
    },
    {
      name: 'delete_all_reminders',
      description: 'ลบการแจ้งเตือนทั้งหมดของผู้ใช้ เรียกเมื่อผู้ใช้ขอให้ลบเตือนทั้งหมด/ล้างเตือนทั้งหมด',
      parameters: { type: 'object', properties: {} },
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
      name: 'list_calendar_events',
      description: 'แสดงนัดหมายใน Google Calendar ที่เคยสร้างผ่านพ่อมหาไว้ทั้งหมด เรียกเมื่อผู้ใช้ถามว่ามีนัดอะไรบ้าง',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'delete_calendar_events',
      description: 'ลบนัดหมายใน Google Calendar เรียกเมื่อผู้ใช้ขอยกเลิก/ลบนัดบางรายการ (ไม่ใช่ทั้งหมด)',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'string' },
            description: 'รายการที่จะลบ ระบุเป็นชื่อนัดเดิมหรือเลขลำดับที่แสดงในรายการล่าสุด ใส่ได้หลายรายการพร้อมกัน',
          },
        },
        required: ['items'],
      },
    },
    {
      name: 'add_todos',
      description: 'เพิ่มรายการสิ่งที่ต้องทำ รองรับเพิ่มหลายรายการพร้อมกันในครั้งเดียว',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                task: { type: 'string', description: 'สิ่งที่ต้องทำ' },
                due_date: { type: 'string', description: 'กำหนดส่ง รูปแบบ ISO ถ้าผู้ใช้ไม่ได้ระบุให้เว้นว่างไว้' },
              },
              required: ['task'],
            },
            description: 'รายการสิ่งที่ต้องทำทั้งหมดที่ผู้ใช้พูดมาในเทิร์นนี้ ใส่ทุกรายการไว้ในอาร์เรย์เดียวกัน',
          },
        },
        required: ['items'],
      },
    },
    {
      name: 'list_todos',
      description: 'แสดงรายการสิ่งที่ต้องทำทั้งหมดที่ยังไม่เสร็จ เรียกเมื่อผู้ใช้ถามว่ามีอะไรต้องทำบ้าง',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'complete_todos',
      description: 'ทำเครื่องหมายว่างานเสร็จแล้ว รองรับหลายรายการพร้อมกัน',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'string' },
            description: 'รายการที่ทำเสร็จแล้ว ระบุเป็นชื่องานเดิมหรือเลขลำดับที่แสดงในรายการล่าสุด ใส่ได้หลายรายการพร้อมกัน',
          },
        },
        required: ['items'],
      },
    },
    {
      name: 'delete_todos',
      description: 'ลบรายการสิ่งที่ต้องทำ เรียกเมื่อผู้ใช้ขอลบบางรายการ (ไม่ใช่ทั้งหมด)',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'string' },
            description: 'รายการที่จะลบ ระบุเป็นชื่องานเดิมหรือเลขลำดับที่แสดงในรายการล่าสุด ใส่ได้หลายรายการพร้อมกัน',
          },
        },
        required: ['items'],
      },
    },
    {
      name: 'delete_all_todos',
      description: 'ลบสิ่งที่ต้องทำทั้งหมดของผู้ใช้ เรียกเมื่อผู้ใช้ขอให้ลบทั้งหมด/ล้างลิสต์ทั้งหมด',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'label_last_file',
      description: 'ตั้งชื่อ/ป้ายกำกับให้ไฟล์หรือรูปล่าสุดที่ผู้ใช้เพิ่งส่งมา เรียกเมื่อผู้ใช้บอกให้ตั้งชื่อไฟล์/รูป',
      parameters: {
        type: 'object',
        properties: { label: { type: 'string', description: 'ชื่อที่จะตั้งให้' } },
        required: ['label'],
      },
    },
    {
      name: 'list_files',
      description: 'แสดงรายการไฟล์/รูปที่เคยเก็บไว้ทั้งหมด เรียกเมื่อผู้ใช้ถามว่ามีไฟล์หรือรูปอะไรเก็บไว้บ้าง',
      parameters: { type: 'object', properties: {} },
    },
    {
      name: 'get_file',
      description: 'ดึงลิงก์ไฟล์/รูปที่เคยเก็บไว้ตามชื่อหรือลำดับ เรียกเมื่อผู้ใช้ขอดูไฟล์ที่เคยตั้งชื่อไว้',
      parameters: {
        type: 'object',
        properties: { item: { type: 'string', description: 'ชื่อหรือเลขลำดับของไฟล์ที่ต้องการดู' } },
        required: ['item'],
      },
    },
    {
      name: 'delete_files',
      description: 'ลบไฟล์/รูปที่เคยเก็บไว้ เรียกเมื่อผู้ใช้ขอลบบางรายการ (ไม่ใช่ทั้งหมด) รองรับหลายรายการพร้อมกัน',
      parameters: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'string' },
            description: 'รายการที่จะลบ ระบุเป็นชื่อเดิมหรือเลขลำดับที่แสดงในรายการล่าสุด ใส่ได้หลายรายการพร้อมกัน',
          },
        },
        required: ['items'],
      },
    },
    {
      name: 'delete_all_files',
      description: 'ลบไฟล์/รูปทั้งหมดของผู้ใช้ เรียกเมื่อผู้ใช้ขอให้ลบทั้งหมด/ล้างทั้งหมด',
      parameters: { type: 'object', properties: {} },
    },
  ],
}];

// ---------- helper ----------

function formatDateTH(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

// รับ pool (รายการตามลำดับที่เคยแสดงผล) + รายการที่ผู้ใช้ขอ (ชื่อ หรือ เลขลำดับ) แล้วจับคู่ให้
function resolveItems(pool, itemsRequested) {
  const matched = [];
  const usedIds = new Set();
  for (const req of itemsRequested || []) {
    const trimmed = String(req).trim();
    const asNumber = parseInt(trimmed, 10);
    let found = null;

    if (!isNaN(asNumber) && String(asNumber) === trimmed && asNumber >= 1 && asNumber <= pool.length) {
      found = pool[asNumber - 1];
    } else {
      found = pool.find(p => !usedIds.has(p.id) && (p.displayName.includes(trimmed) || trimmed.includes(p.displayName)));
    }

    if (found && !usedIds.has(found.id)) {
      matched.push(found);
      usedIds.add(found.id);
    }
  }
  return matched;
}

// ---------- reminders ----------

async function saveReminder(userId, title, remindAt, recurrence) {
  const { data } = await supabase.from('reminders')
    .insert({ user_id: userId, title, remind_at: remindAt, recurrence: recurrence || null })
    .select().single();
  return data;
}

async function listRemindersRows(userId) {
  const { data } = await supabase.from('reminders')
    .select('id, title, remind_at, recurrence')
    .eq('user_id', userId).eq('sent', false)
    .order('remind_at', { ascending: true });
  return data || [];
}

async function deleteReminders(userId, itemsRequested) {
  const pool = await listRemindersRows(userId);
  const poolMapped = pool.map(p => ({ id: p.id, displayName: p.title }));
  const matched = resolveItems(poolMapped, itemsRequested);
  const deletedList = [];
  for (const m of matched) {
    await supabase.from('reminders').delete().eq('id', m.id);
    deletedList.push(m.displayName);
  }
  return deletedList;
}

async function deleteAllReminders(userId) {
  await supabase.from('reminders').delete().eq('user_id', userId).eq('sent', false);
}

// ---------- calendar ----------

async function saveCalendarEventRecord(userId, googleEventId, title, startTime) {
  await supabase.from('calendar_events').insert({ user_id: userId, google_event_id: googleEventId, title, start_time: startTime });
}

async function listCalendarEventsRows(userId) {
  const { data } = await supabase.from('calendar_events')
    .select('id, google_event_id, title, start_time')
    .eq('user_id', userId)
    .order('start_time', { ascending: true });
  return data || [];
}

async function deleteCalendarEvents(userId, itemsRequested, refreshToken) {
  const pool = await listCalendarEventsRows(userId);
  const poolMapped = pool.map(p => ({ id: p.id, displayName: p.title, google_event_id: p.google_event_id }));
  const matched = resolveItems(poolMapped, itemsRequested);
  const deletedList = [];
  for (const m of matched) {
    try {
      await deleteCalendarEvent(refreshToken, m.google_event_id);
    } catch (err) {
      console.error('delete calendar event error:', err);
    }
    await supabase.from('calendar_events').delete().eq('id', m.id);
    deletedList.push(m.displayName);
  }
  return deletedList;
}

// ---------- todos ----------

async function addTodos(userId, items) {
  const createdTasks = [];
  for (const it of items) {
    const { data: todoRow } = await supabase.from('todos')
      .insert({ user_id: userId, task: it.task, due_date: it.due_date || null })
      .select().single();

    if (it.due_date && todoRow) {
      const reminderRow = await saveReminder(userId, `ครบกำหนด: ${it.task}`, it.due_date, null);
      if (reminderRow) {
        await supabase.from('todos').update({ reminder_id: reminderRow.id }).eq('id', todoRow.id);
      }
    }
    createdTasks.push(it.task);
  }
  return createdTasks;
}

async function listTodosRows(userId) {
  const { data } = await supabase.from('todos')
    .select('id, task, due_date, reminder_id')
    .eq('user_id', userId).eq('done', false)
    .order('created_at', { ascending: true });
  return data || [];
}

async function completeTodos(userId, itemsRequested) {
  const pool = await listTodosRows(userId);
  const poolMapped = pool.map(p => ({ id: p.id, displayName: p.task, reminder_id: p.reminder_id }));
  const matched = resolveItems(poolMapped, itemsRequested);
  const doneList = [];
  for (const m of matched) {
    await supabase.from('todos').update({ done: true }).eq('id', m.id);
    if (m.reminder_id) await supabase.from('reminders').delete().eq('id', m.reminder_id);
    doneList.push(m.displayName);
  }
  return doneList;
}

async function deleteTodos(userId, itemsRequested) {
  const pool = await listTodosRows(userId);
  const poolMapped = pool.map(p => ({ id: p.id, displayName: p.task, reminder_id: p.reminder_id }));
  const matched = resolveItems(poolMapped, itemsRequested);
  const deletedList = [];
  for (const m of matched) {
    await supabase.from('todos').delete().eq('id', m.id);
    if (m.reminder_id) await supabase.from('reminders').delete().eq('id', m.reminder_id);
    deletedList.push(m.displayName);
  }
  return deletedList;
}

async function deleteAllTodos(userId) {
  const pool = await listTodosRows(userId);
  const reminderIds = pool.map(p => p.reminder_id).filter(Boolean);
  if (reminderIds.length) await supabase.from('reminders').delete().in('id', reminderIds);
  await supabase.from('todos').delete().eq('user_id', userId).eq('done', false);
}

// ---------- files / images ----------

async function labelLastFile(userId, label) {
  const { data } = await supabase.from('images').select('id').eq('user_id', userId).order('created_at', { ascending: false }).limit(1);
  if (!data || data.length === 0) return false;
  await supabase.from('images').update({ label }).eq('id', data[0].id);
  return true;
}

async function listFilesRows(userId) {
  const { data } = await supabase.from('images')
    .select('id, file_path, label, file_name, mime_type, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  return data || [];
}

async function getFileUrl(userId, item) {
  const pool = await listFilesRows(userId);
  const poolMapped = pool.map((p, i) => ({ id: p.id, displayName: p.label || `ไฟล์ที่ ${i + 1}`, file_path: p.file_path }));
  const matched = resolveItems(poolMapped, [item]);
  if (matched.length === 0) return null;
  const { data: urlData } = supabase.storage.from('files').getPublicUrl(matched[0].file_path);
  return urlData.publicUrl;
}

async function deleteFiles(userId, itemsRequested) {
  const pool = await listFilesRows(userId);
  const poolMapped = pool.map((p, i) => ({ id: p.id, displayName: p.label || `ไฟล์ที่ ${i + 1}`, file_path: p.file_path }));
  const matched = resolveItems(poolMapped, itemsRequested);
  const deletedList = [];
  for (const m of matched) {
    await supabase.storage.from('files').remove([m.file_path]);
    await supabase.from('images').delete().eq('id', m.id);
    deletedList.push(m.displayName);
  }
  return deletedList;
}

async function deleteAllFiles(userId) {
  const pool = await listFilesRows(userId);
  const paths = pool.map(p => p.file_path);
  if (paths.length) await supabase.storage.from('files').remove(paths);
  await supabase.from('images').delete().eq('user_id', userId);
}

// ---------- confirmation flow (ลบทั้งหมด) ----------

async function performPendingAction(userId, pending) {
  if (pending.type === 'delete_all_todos') {
    await deleteAllTodos(userId);
    return 'ลบสิ่งที่ต้องทำทั้งหมดให้แล้วนะ';
  }
  if (pending.type === 'delete_all_files') {
    await deleteAllFiles(userId);
    return 'ลบไฟล์/รูปทั้งหมดให้แล้วนะ';
  }
  if (pending.type === 'delete_all_reminders') {
    await deleteAllReminders(userId);
    return 'ลบการแจ้งเตือนทั้งหมดให้แล้วนะ';
  }
  return 'ไม่แน่ใจว่าจะยืนยันอะไร ลองพิมพ์คำสั่งใหม่นะ';
}

// ---------- dispatch การเรียกเครื่องมือแต่ละอัน ----------

async function executeCall(userId, call) {
  const args = call.args || {};

  switch (call.name) {
    case 'set_reminder': {
      await saveReminder(userId, args.title, args.remind_at, args.recurrence);
      const recurText = args.recurrence ? ` (เตือนซ้ำแบบ ${args.recurrence})` : '';
      return `จำให้แล้วนะ จะเตือนเรื่อง "${args.title}" ให้${recurText}`;
    }

    case 'list_reminders': {
      const rows = await listRemindersRows(userId);
      return rows.length
        ? `เตือนที่ตั้งไว้มี:\n${rows.map((r, i) => `${i + 1}. ${r.title} - ${formatDateTH(r.remind_at)}${r.recurrence ? ` (ซ้ำ ${r.recurrence})` : ''}`).join('\n')}`
        : 'ตอนนี้ไม่มีเตือนที่ตั้งไว้เลยนะ';
    }

    case 'delete_reminders': {
      const deleted = await deleteReminders(userId, args.items);
      return deleted.length
        ? `ลบเตือนให้แล้วนะ: ${deleted.join(', ')}`
        : 'หาเตือนที่ว่ามาไม่เจอเลยนะ ลองเช็คชื่อ/ลำดับอีกทีนะ';
    }

    case 'delete_all_reminders': {
      pendingConfirmations.set(userId, { type: 'delete_all_reminders' });
      return 'แน่ใจนะว่าจะลบเตือนทั้งหมด? พิมพ์ "ยืนยัน" เพื่อลบจริง หรือ "ยกเลิก" ถ้าเปลี่ยนใจ';
    }

    case 'create_calendar_event': {
      const { data: userRow } = await supabase.from('users').select('google_refresh_token').eq('user_id', userId).single();
      if (!userRow || !userRow.google_refresh_token) {
        return `ยังไม่ได้เชื่อมต่อ Google Calendar เลยนะ เชื่อมก่อนได้ที่ลิงก์นี้: https://pormaha-bot.onrender.com/connect-calendar?userId=${userId}`;
      }
      const { link, eventId } = await createCalendarEvent(userRow.google_refresh_token, args.title, args.start_time, args.end_time);
      await saveCalendarEventRecord(userId, eventId, args.title, args.start_time);
      return `นัดหมายเรียบร้อยแล้วนะ: ${link}`;
    }

    case 'list_calendar_events': {
      const rows = await listCalendarEventsRows(userId);
      return rows.length
        ? `นัดหมายที่มีอยู่:\n${rows.map((r, i) => `${i + 1}. ${r.title} - ${formatDateTH(r.start_time)}`).join('\n')}`
        : 'ยังไม่มีนัดหมายที่สร้างไว้เลยนะ';
    }

    case 'delete_calendar_events': {
      const { data: userRow } = await supabase.from('users').select('google_refresh_token').eq('user_id', userId).single();
      if (!userRow || !userRow.google_refresh_token) {
        return 'ยังไม่ได้เชื่อมต่อ Google Calendar เลยนะ ลบนัดให้ไม่ได้';
      }
      const deleted = await deleteCalendarEvents(userId, args.items, userRow.google_refresh_token);
      return deleted.length
        ? `ลบนัดหมายให้แล้วนะ: ${deleted.join(', ')}`
        : 'หานัดหมายที่ว่ามาไม่เจอเลยนะ';
    }

    case 'add_todos': {
      const created = await addTodos(userId, args.items || []);
      return created.length
        ? `จดไว้แล้วนะ ${created.length} รายการ:\n${created.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
        : 'ไม่ได้จดอะไรเลยนะ ลองพูดใหม่อีกทีนะ';
    }

    case 'list_todos': {
      const rows = await listTodosRows(userId);
      return rows.length
        ? `สิ่งที่ต้องทำตอนนี้มี:\n${rows.map((t, i) => `${i + 1}. ${t.task}${t.due_date ? ` (กำหนด ${formatDateTH(t.due_date)})` : ''}`).join('\n')}`
        : 'ตอนนี้ไม่มีสิ่งที่ต้องทำค้างอยู่เลยนะ';
    }

    case 'complete_todos': {
      const done = await completeTodos(userId, args.items);
      return done.length
        ? `✅ เสร็จแล้วนะ: ${done.join(', ')}`
        : 'หางานนี้ไม่เจอในลิสต์เลย ลองพูดชื่อ/ลำดับให้ตรงกว่านี้ดูนะ';
    }

    case 'delete_todos': {
      const deleted = await deleteTodos(userId, args.items);
      return deleted.length
        ? `ลบให้แล้วนะ: ${deleted.join(', ')}`
        : 'หางานนี้ไม่เจอในลิสต์เลยนะ';
    }

    case 'delete_all_todos': {
      pendingConfirmations.set(userId, { type: 'delete_all_todos' });
      return 'แน่ใจนะว่าจะลบสิ่งที่ต้องทำทั้งหมด? พิมพ์ "ยืนยัน" เพื่อลบจริง หรือ "ยกเลิก" ถ้าเปลี่ยนใจ';
    }

    case 'label_last_file': {
      const ok = await labelLastFile(userId, args.label);
      return ok ? `ตั้งชื่อว่า "${args.label}" ให้แล้วนะ` : 'ยังไม่มีไฟล์ที่เก็บไว้เลย ส่งมาก่อนนะ';
    }

    case 'list_files': {
      const rows = await listFilesRows(userId);
      return rows.length
        ? `ไฟล์ที่เก็บไว้มี:\n${rows.map((f, i) => `${i + 1}. ${f.label || '(ยังไม่ได้ตั้งชื่อ)'}`).join('\n')}`
        : 'ยังไม่มีไฟล์ที่เก็บไว้เลยนะ';
    }

    case 'get_file': {
      const url = await getFileUrl(userId, args.item);
      return url || 'หาไฟล์นี้ไม่เจอเลยนะ';
    }

    case 'delete_files': {
      const deleted = await deleteFiles(userId, args.items);
      return deleted.length
        ? `ลบให้แล้วนะ: ${deleted.join(', ')}`
        : 'หาไฟล์นี้ไม่เจอเลยนะ';
    }

    case 'delete_all_files': {
      pendingConfirmations.set(userId, { type: 'delete_all_files' });
      return 'แน่ใจนะว่าจะลบไฟล์/รูปทั้งหมด? พิมพ์ "ยืนยัน" เพื่อลบจริง หรือ "ยกเลิก" ถ้าเปลี่ยนใจ';
    }

    default:
      return null;
  }
}

// ---------- main ----------

async function askLLM(userId, userMessage) {
  try {
    // เช็คว่ามีคำถามยืนยันค้างอยู่ไหม (จากคำสั่งลบทั้งหมด)
    if (pendingConfirmations.has(userId)) {
      const pending = pendingConfirmations.get(userId);
      const msg = userMessage.trim();
      pendingConfirmations.delete(userId); // เคลียร์ก่อนเสมอ กันค้าง

      if (msg.includes('ยืนยัน')) {
        return await performPendingAction(userId, pending);
      } else if (msg.includes('ยกเลิก')) {
        return 'ยกเลิกแล้วนะ ไม่ได้ลบอะไรทั้งนั้น';
      }
      // ถ้าพิมพ์อย่างอื่นมา ปล่อยให้ไหลต่อเข้าสู่การคุยปกติด้านล่าง
    }

    const now = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

    const { data: userRow } = await supabase.from('users').select('nickname, tone').eq('user_id', userId).single();
    const toneStyle = TONE_STYLES[userRow?.tone] || '';

    const personalizedPrompt = BASE_INSTRUCTIONS
      + (userRow?.nickname ? `\nเรียกผู้ใช้ว่า "${userRow.nickname}"` : '')
      + (toneStyle ? `\n\n[สำคัญที่สุด] บุคลิกของคุณตอนนี้คือ "${userRow.tone}": ${toneStyle}\nต้องรักษาบุคลิกนี้ให้เข้มข้นสม่ำเสมอทุกคำตอบ ห้ามลดดีกรีลงแม้แต่ประโยคเดียว` : '')
      + `\nเวลาปัจจุบันคือ ${now} (เขตเวลาไทย)`;

    const model = genAI.getGenerativeModel({
      model: 'gemini-3.1-flash-lite',
      tools,
      systemInstruction: personalizedPrompt,
      generationConfig: {
        temperature: userRow?.tone === 'พ่อมหาเผ็ดมัน' ? 1.3 : 0.9,
      },
    });

    if (!conversations.has(userId)) conversations.set(userId, []);
    const history = conversations.get(userId);

    const chat = model.startChat({ history });
    const result = await chat.sendMessage(userMessage);
    const calls = result.response.functionCalls() || [];

    let reply;
    if (calls.length === 0) {
      reply = result.response.text();
    } else {
      const replies = [];
      for (const call of calls) {
        const r = await executeCall(userId, call);
        if (r) replies.push(r);
      }
      reply = replies.length ? replies.join('\n\n') : 'ทำรายการให้แล้วนะ';
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