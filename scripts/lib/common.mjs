// 모든 채널이 같이 쓰는 작은 도구 모음
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SITE_DATA = join(ROOT, 'docs', 'data'); // 앱 화면이 읽는 곳 (공개)
export const STATE = join(ROOT, 'state'); // 이미 본 글 기록 등 (화면에는 안 씀)
export const TMP = join(ROOT, 'tmp'); // 하루 작업 중간 결과 (저장소에 안 올림)

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (fallback !== undefined && err.code === 'ENOENT') return fallback;
    throw err;
  }
}

export async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export async function loadChannel(id) {
  if (!id) throw new Error('채널 이름을 적어주세요. 예: node scripts/collect.mjs ai-coding');
  return readJson(join(ROOT, 'channels', `${id}.json`));
}

// 한국 시간 기준 날짜 (YYYY-MM-DD)
export function kstDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d);
}

export async function fetchText(url, { timeoutMs = 20000 } = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'my-feed/1.0 (+personal news reader)' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  return res.text();
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function plainText(html = '', max = 400) {
  const text = decodeEntities(
    html.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ')
  )
    .replace(/<[^>]+>/g, ' ') // 엔티티로 감싸져 있던 태그까지 제거
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
}
