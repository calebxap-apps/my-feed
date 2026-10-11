// 1.5단계: 모은 후보 중 유튜브 영상이면 자막 전체를 붙인다 (summarize 가 한국어로 번역·요약).
// 채널 설정에서 "transcript": true 인 출처만 대상. 자막을 못 읽어도 멈추지 않고 제목만으로 넘어간다.
// 사용법: node scripts/transcripts.mjs novel-anime
import { join } from 'node:path';
import { loadChannel, readJson, writeJson, TMP } from './lib/common.mjs';
import { getTranscript, closeBrowser } from './lib/youtube.mjs';

const channel = await loadChannel(process.argv[2]);
const wanted = new Set(channel.sources.filter((s) => s.transcript).map((s) => s.name));
const path = join(TMP, `${channel.id}-candidates.json`);
const data = await readJson(path);
const targets = data.candidates.filter((c) => wanted.has(c.source) && /youtube\.com/.test(c.url) && !c.transcript);

if (!targets.length) {
  console.log(`[${channel.name}] 자막을 읽을 새 영상이 없어요.`);
  process.exit(0);
}

let ok = 0;
for (const c of targets) {
  const text = await getTranscript(c.url);
  if (text) {
    c.transcript = text;
    ok++;
    console.log(`  🎬 ${c.title} — 자막 ${text.length}자`);
  } else {
    console.log(`  · ${c.title} — 자막 없음 (제목만 사용)`);
  }
}
await closeBrowser();
await writeJson(path, data);
console.log(`[${channel.name}] 영상 ${targets.length}개 중 ${ok}개 자막 읽음`);
