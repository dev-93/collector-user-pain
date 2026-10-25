export async function sendTelegramReport(text, { token, chatId, fetchImpl = fetch }) {
  if (!token || !chatId) throw new Error('telegram_config_missing');
  // SDK 자동 재시도 없이 1회 전송. 오류 URL·토큰·원문 응답은 출력하지 않는다.
  const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, link_preview_options: { is_disabled: true } }),
  });
  if (!response.ok) throw new Error('telegram_send_failed');
  const result = await response.json();
  if (!result.ok || !Number.isInteger(result.result?.message_id)) throw new Error('telegram_response_invalid');
  return { message_id: result.result.message_id };
}
