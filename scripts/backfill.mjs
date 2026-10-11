// 지난 중요 영상 모아 보내기 (한 번씩 손으로 실행).
// 공식 유튜브 채널의 지난 영상·쇼츠 목록 → Claude 가 중요한 것(인터뷰·제작 뒷이야기·예고편)을 고름
// → 자막 읽기 → 후보 파일로 저장. 이어서 `BACKFILL=1 node scripts/summarize.mjs novel-anime` 가 번역·요약·알림.
// 사용법: node scripts/backfill.mjs novel-anime
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { loadChannel, readJson, writeJson, STATE, TMP } from './lib/common.mjs';
import { listChannelVideos, getTranscript, closeBrowser } from './lib/youtube.mjs';

const channel = await loadChannel(process.argv[2]);
const src = channel.sources.find((s) => s.transcript && s.channelUrl);
if (!src) throw new Error('채널 설정에 "transcript": true 와 "channelUrl" 이 있는 유튜브 출처가 필요해요.');

const videos = await listChannelVideos(src.channelUrl);
console.log(`[${channel.name}] 지난 영상·쇼츠 ${videos.length}개 찾음`);
if (!videos.length) process.exit(1);

function askClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--model', process.env.CLAUDE_MODEL || 'sonnet', '--output-format', 'json'], {
      stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32',
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => {
      try {
        const w = JSON.parse(out);
        if (code !== 0 || w.is_error) return reject(new Error(w.result || `종료 코드 ${code}`));
        resolve(w.result);
      } catch { reject(new Error(out.slice(0, 300))); }
    });
    child.stdin.end(prompt);
  });
}

const answer = await askClaude(`아래는 애니메이션 "${channel.works[0].name}" 공식 유튜브 채널의 지난 영상 제목 목록이다.
팬이 꼭 봐야 할 중요한 영상을 최대 10개 골라라: 제작진·성우 인터뷰, 제작 뒷이야기(#InsideWingfeather 등), 시즌 예고편·발표, 원작자 이야기.
이미 방영된 장면을 잘라 올린 단순 클립, 굿즈·후원 홍보는 뺀다. 최근 것과 정보가 많은 것을 우선한다.
번호만 JSON 으로 출력한다. 예: {"picks": [3, 0, 12]}

${videos.map((v, i) => `${i}. [${v.kind}] ${v.title}`).join('\n')}`);
const picks = (JSON.parse(answer.slice(answer.indexOf('{'), answer.lastIndexOf('}') + 1)).picks || [])
  .map((n) => videos[n]).filter(Boolean).slice(0, 10);
console.log(`  Claude 가 고른 영상 ${picks.length}개`);

const candidates = [];
for (const v of picks) {
  const transcript = await getTranscript(v.url);
  console.log(`  ${transcript ? '🎬' : '·'} ${v.title}${transcript ? ` — 자막 ${transcript.length}자` : ' — 자막 없음'}`);
  candidates.push({ title: v.title, url: v.url, date: null, snippet: '', source: src.name, kind: src.kind, ...(transcript ? { transcript } : {}) });
}
await closeBrowser();

// summarize 가 쓰는 파일들: 후보 + '본 글'·'페이지' 기록 (고른 영상은 본 것으로 표시)
const seen = await readJson(join(STATE, `${channel.id}-seen.json`), {});
const today = new Date().toISOString().slice(0, 10);
for (const c of candidates) seen[c.url] ??= today;
await writeJson(join(TMP, `${channel.id}-candidates.json`), { channel: channel.id, collectedAt: new Date().toISOString(), candidates });
await writeJson(join(TMP, `${channel.id}-seen-next.json`), seen);
await writeJson(join(TMP, `${channel.id}-pages-next.json`), await readJson(join(STATE, `${channel.id}-pages.json`), {}));
console.log(`[${channel.name}] 지난 중요 영상 후보 ${candidates.length}개 준비 완료`);
