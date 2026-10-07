// 1단계: 채널에 등록된 출처들을 돌며 '새 글 후보'를 모은다.
// 사용법: node scripts/collect.mjs ai-coding
import { join } from 'node:path';
import { loadChannel, readJson, writeJson, STATE, TMP } from './lib/common.mjs';
import { fetchSource } from './lib/sources.mjs';

const channel = await loadChannel(process.argv[2]);
const seenPath = join(STATE, `${channel.id}-seen.json`);
const seen = await readJson(seenPath, null); // { url: '처음 본 날짜' }
const firstRun = seen === null;
const lookback = firstRun && channel.firstRunLookbackHours ? channel.firstRunLookbackHours : channel.lookbackHours;
const since = new Date(Date.now() - lookback * 3600e3);
const pages = await readJson(join(STATE, `${channel.id}-pages.json`), {}); // 페이지 감시용: 지난번 문장들
const pagesNext = { ...pages };

const results = await Promise.allSettled(
  channel.sources.map((src) => fetchSource(src, {
    since,
    alreadySeen: (url) => Boolean(seen?.[url]),
    pages,
    pagesNext,
  }))
);

const candidates = [];
const report = [];
results.forEach((r, i) => {
  const src = channel.sources[i];
  if (r.status === 'rejected') {
    report.push(`  ✗ ${src.name}: ${r.reason.message}`);
    return;
  }
  // 기존 채널에 새로 붙인 출처: 지금 있는 글은 '기준'으로만 기록하고 소식으로 내보내지 않는다
  if (seen && r.value.length > 3 && !r.value.some((it) => seen[it.url])) {
    report.push(`  ◇ ${src.name}: 처음 연결 — 지금 있는 ${r.value.length}개는 기준으로만 저장`);
    return;
  }
  let items = r.value.filter((it) => !seen?.[it.url]);
  items = items.filter((it) => !it.date || new Date(it.date) >= since);
  // 처음 실행할 땐 '이미 본 글' 기록이 없으니, 날짜 없는 출처는 맨 위 몇 개만
  if (firstRun) items = items.filter((it) => it.date).concat(items.filter((it) => !it.date).slice(0, 3));
  items = items.slice(0, channel.maxCandidatesPerSource);
  report.push(`  ✓ ${src.name}: 전체 ${r.value.length}개 중 새 글 ${items.length}개`);
  for (const it of items) candidates.push({ ...it, source: src.name, kind: src.kind });
});

// 날짜 없는 출처는 지금 받은 목록 전체를 '본 글'로 기록해야 다음에 다시 안 나온다
const allSeen = { ...(seen || {}) };
const today = new Date().toISOString().slice(0, 10);
results.forEach((r) => {
  if (r.status === 'fulfilled') for (const it of r.value) allSeen[it.url] ??= today;
});

await writeJson(join(TMP, `${channel.id}-candidates.json`), { channel: channel.id, collectedAt: new Date().toISOString(), candidates });
await writeJson(join(TMP, `${channel.id}-seen-next.json`), allSeen);
await writeJson(join(TMP, `${channel.id}-pages-next.json`), pagesNext);

console.log(`[${channel.name}] 후보 ${candidates.length}개 모음${firstRun ? ' (첫 실행)' : ''}`);
console.log(report.join('\n'));
