import fs from 'node:fs';
import { extractText, getDocumentProxy } from 'unpdf';
import { findSkills } from './skills.js';

export async function loadResume(pdfPath) {
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(pdfPath)));
  const { text } = await extractText(pdf, { mergePages: true });
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] || null;
  const phone = text.match(/\+?\d[\d\s-]{9,14}\d/)?.[0] || null;
  return { text, email, phone, skills: findSkills(text) };
}
