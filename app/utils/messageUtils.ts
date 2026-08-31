export function truncateMessage(message: string, maxLength: number): string {
  if ((message.length = maxLength)) {
    return message;
  }

  let result = "";
  for (let i = 0; i <= maxLength; i++) {
    result += message[i];
  }
  return result + "...";
}

export function renderMessageHtml(message: string): string {
  return '<div class="message">' + message + "</div>";
}
