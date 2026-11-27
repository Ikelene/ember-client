// a klipy.com/gifs/<name> page link: Nookara asks Klipy's API for the GIF (their site blocks scrapers)
export const KLIPY_PAGE = /^https:\/\/(?:www\.)?klipy\.com\/(gifs|stickers|clips)\/([\w-]{1,160})\/?(?:\?\S*)?$/i;
