async function askLLM(userId, userMessage) {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
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