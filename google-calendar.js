const { google } = require('googleapis');

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl(userId) {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    state: userId, // ใช้รู้ว่า token นี้เป็นของ user คนไหนตอน callback กลับมา
  });
}

async function createCalendarEvent(refreshToken, title, startTime, endTime) {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  const event = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: title,
      start: { dateTime: startTime, timeZone: 'Asia/Bangkok' },
      end: { dateTime: endTime, timeZone: 'Asia/Bangkok' },
    },
  });
  // คืนทั้งลิงก์และ event ID (ต้องเก็บ ID ไว้ถึงจะลบทีหลังได้)
  return { link: event.data.htmlLink, eventId: event.data.id };
}

async function deleteCalendarEvent(refreshToken, eventId) {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
  await calendar.events.delete({
    calendarId: 'primary',
    eventId: eventId,
  });
}

module.exports = { getOAuthClient, getAuthUrl, createCalendarEvent, deleteCalendarEvent };