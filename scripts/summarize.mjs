// 2단계: 모은 후보를 Claude 에게 보내 골라서 한국어로 요약·번역한다.
// Claude 를 못 쓰는 상황이면 제목·첫 문장만으로 대신 만든다 (알림이 끊기지 않게).
// 채널 방식 두 가지:
//   digest (기본) — 하루 한 번 '오늘의 묶음'을 새로 만든다 (AI·코딩)
//   event         — 자주 확인하다 새 소식이 있을 때만 그날 기록에 덧붙인다 (소설·애니)
// 사용법: node scripts/summarize.mjs ai-coding
//   SUMMARIZER=fallback  → Claude 없이 만들기 (시험용)
//   SUMMARIZER=file:경로 → 미리 써둔 답변 파일로 만들기 (시험용)
//   CLAUDE_MODEL=sonnet  → 요약에 쓸 모델 (기본 sonnet: 구독 사용량을 아끼려고)
import { spawn } from 'node:child_process';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { loadChannel, readJson, writeJson, kstDate, ROOT, SITE_DATA, STATE, TMP } from './lib/common.mjs';

const channel = await loadChannel(process.argv[2]);
const EVENT = channel.mode === 'event';
const TAGS = channel.tags || ['발표', '도구', '연구', '읽을거리'];
const { candidates } = await readJson(join(TMP, `${channel.id}-candidates.json`));
const date = kstDate();

function buildPrompt() {
  const list = candidates.map((c, i) => ({
    n: i,
    출처: `${c.source} (${c.kind})`,
    제목: c.title,
    내용: c.snippet || undefined,
    ...(c.date ? { 날짜: c.date.slice(0, 10) } : {}),
    ...(c.extra?.points ? { 추천수: c.extra.points } : {}),
    ...(c.extra?.stars ? { 별: c.extra.stars } : {}),
  }));

  const intro = EVENT
    ? `너는 한 팬을 위해 좋아하는 작품의 공식 소식을 챙겨주는 편집자다.
[따라가는 작품]
${channel.works.map((w) => `- ${w.name}: ${w.note}`).join('\n')}

아래는 공식 출처에서 새로 나온 글 후보 ${candidates.length}개다. 위 작품과 관련된 것만 골라 한국어로 정리해라.
알릴 만한 게 없으면 items 를 빈 배열로 둔다. 억지로 고르지 않는다.`
    : `너는 한 개발자를 위해 하루 한 번 소식을 골라주는 편집자다.
아래는 오늘 모은 글 후보 ${candidates.length}개다. 규칙에 맞게 골라서 한국어로 정리해라.`;

  const summaryRule = EVENT
    ? '무엇이 공개됐는지 핵심을 3~5문장, 존댓말("~했어요"체). 영어 원문은 자연스러운 한국어로 번역해서 전한다. 날짜·시즌·회차·인물 이름 같은 사실은 정확히 옮기고, 날짜는 "2026년 10월 21일"처럼 쓴다. 영상이면 어떤 영상인지(예고편·인터뷰·제작 뒷이야기)와 알 수 있는 내용을 설명한다.'
    : '무엇이 나왔고 왜 개발자에게 의미가 있는지, 2~3문장, 존댓말("~했어요"체).';

  return `${intro}

[고르는 기준]
${channel.guide}
- 중요한 것부터 최대 ${channel.maxItems}개. 고를 게 적으면 적게 골라도 된다. 억지로 채우지 않는다.
- 후보에 적힌 내용만 쓴다. 적혀 있지 않은 사실을 지어내지 않는다. 확실하지 않으면 "~라고 한다"처럼 쓴다.
- 과장·감탄 표현 없이 담담하게 쓴다.
- "후보에 제목만 있다" 같은 자료 상태 설명은 쓰지 않는다. 정보가 적으면 짧게 쓴다.

[각 항목]
- n: 후보 번호 (그대로)
- title: 한국어 제목, 30자 안팎. 원래 제목이 고유명사면 살린다.
- summary: ${summaryRule}
- tag: ${TAGS.map((t) => `"${t}"`).join(', ')} 중 하나

[전체]
- headline: ${EVENT ? '이번에 고른 소식' : '오늘 소식'} 전체를 한 문장(40자 이내)으로. 알림 문구로 쓰인다.

JSON 하나만 출력한다. 설명이나 코드블록 표시 없이:
{"headline": "...", "items": [{"n": 0, "title": "...", "summary": "...", "tag": "..."}]}

[후보]
${JSON.stringify(list, null, 1)}`;
}

function runClaude(prompt) {
  const model = process.env.CLAUDE_MODEL || 'sonnet';
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--model', model, '--output-format', 'json'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        let reason = err.trim();
        try { reason ||= JSON.parse(out).result; } catch { reason ||= out.slice(0, 300); }
        return reject(new Error(`claude 종료 코드 ${code}: ${reason}`));
      }
      try {
        const wrapper = JSON.parse(out);
        if (wrapper.is_error) return reject(new Error(`claude 오류: ${wrapper.result}`));
        resolve(wrapper.result);
      } catch {
        resolve(out);
      }
    });
    child.stdin.end(prompt);
  });
}

const toItem = (c, fields) => ({
  ...fields,
  source: c.source,
  originalTitle: c.title,
  url: c.link || c.url, // 페이지 감시 소식은 원래 페이지로
  ...(c.extra?.discussion ? { discussion: c.extra.discussion } : {}),
});

function parseAnswer(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('요약 결과에서 JSON 을 찾지 못했어요');
  const data = JSON.parse(text.slice(start, end + 1));
  const used = new Set();
  const items = (data.items || []).flatMap((it) => {
    const c = candidates[it.n];
    if (!c || used.has(it.n) || !it.title || !it.summary) return [];
    used.add(it.n);
    return [toItem(c, {
      title: String(it.title),
      summary: String(it.summary),
      tag: TAGS.includes(it.tag) ? it.tag : TAGS[TAGS.length - 1],
    })];
  });
  return { headline: String(data.headline || ''), items: items.slice(0, channel.maxItems) };
}

function fallbackDigest() {
  // 공식 → 개인 → 커뮤니티 → 프로젝트 순으로, 커뮤니티는 추천 많은 순
  const order = { 공식: 0, 개인: 1, 커뮤니티: 2, 프로젝트: 3 };
  const items = [...candidates]
    .sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || (b.extra?.points ?? 0) - (a.extra?.points ?? 0))
    .slice(0, channel.maxItems)
    .map((c) => toItem(c, {
      title: c.title,
      summary: c.snippet || '요약 없이 제목만 가져왔어요.',
      tag: EVENT ? TAGS[TAGS.length - 1] : c.kind === '프로젝트' ? '도구' : c.kind === '공식' ? '발표' : '읽을거리',
    }));
  return { headline: items.length ? `새 글 ${items.length}개 (요약 없이 제목만)` : '', items };
}

let digest;
let summarizer = 'claude';
if (candidates.length === 0) {
  digest = { headline: '', items: [] };
  summarizer = 'none';
} else if (process.env.SUMMARIZER?.startsWith('file:')) {
  // 시험용: 미리 써둔 요약 답변(JSON)을 Claude 답 대신 사용
  digest = parseAnswer(await readFile(process.env.SUMMARIZER.slice(5), 'utf8'));
  summarizer = 'file';
} else if (process.env.SUMMARIZER === 'fallback') {
  digest = fallbackDigest();
  summarizer = 'fallback';
} else {
  try {
    digest = parseAnswer(await runClaude(buildPrompt()));
  } catch (e) {
    console.warn(`⚠ Claude 요약 실패 → 제목만으로 대신 만들어요: ${e.message}`);
    digest = fallbackDigest();
    summarizer = 'fallback';
  }
}

const dir = join(SITE_DATA, channel.id);
const now = new Date().toISOString();
const notifyPath = join(TMP, `${channel.id}-notify.json`);
await rm(notifyPath, { force: true });

// event 방식은 새로 고른 소식이 없으면 화면 기록을 건드리지 않는다
if (!EVENT || digest.items.length) {
  const fresh = digest.items.map((it) => ({ ...it, at: now }));
  const prev = EVENT ? await readJson(join(dir, `${date}.json`), null) : null;
  const items = [...fresh, ...(prev?.items || [])];
  const headline = digest.headline || prev?.headline || '';
  await writeJson(join(dir, `${date}.json`), {
    channel: channel.id,
    mode: EVENT ? 'event' : 'digest',
    date,
    generatedAt: now,
    summarizer,
    candidateCount: candidates.length + (prev?.candidateCount || 0),
    headline,
    items,
  });

  // 날짜 목록 (최근 60개만 화면에 남김)
  const index = (await readJson(join(dir, 'index.json'), [])).filter((d) => d.date !== date);
  index.unshift({ date, count: items.length, headline });
  index.sort((a, b) => b.date.localeCompare(a.date));
  for (const old of index.splice(60)) await rm(join(dir, `${old.date}.json`), { force: true });
  await writeJson(join(dir, 'index.json'), index);

  // 알림 단계가 읽을 '이번에 새로 생긴 소식'
  if (fresh.length) await writeJson(notifyPath, { date, headline: digest.headline, items: fresh });
}

// 앱이 읽을 채널 목록
const channels = [];
for (const f of (await readdir(join(ROOT, 'channels'))).filter((f) => f.endsWith('.json')).sort()) {
  const c = await readJson(join(ROOT, 'channels', f));
  channels.push({ id: c.id, name: c.name, emoji: c.emoji, mode: c.mode || 'digest' });
}
await writeJson(join(SITE_DATA, 'channels.json'), channels);

// 요약까지 끝났을 때만 '본 글'·'페이지' 기록을 확정 (60일 지난 기록은 정리)
const seenNext = await readJson(join(TMP, `${channel.id}-seen-next.json`), {});
const cutoff = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
const seen = Object.fromEntries(Object.entries(seenNext).filter(([, d]) => d >= cutoff));
await writeJson(join(STATE, `${channel.id}-seen.json`), seen);
const pagesNext = await readJson(join(TMP, `${channel.id}-pages-next.json`), {});
if (Object.keys(pagesNext).length) await writeJson(join(STATE, `${channel.id}-pages.json`), pagesNext);

console.log(`[${channel.name}] ${date} — ${EVENT ? '새 소식 ' : ''}${digest.items.length}개 정리 (${summarizer})`);
if (digest.headline) console.log(`  “${digest.headline}”`);
