// 하루 묶음(digest) 채널이 오늘 이미 Claude 요약을 마쳤는지 확인 → 했으면 종료 코드 0 (건너뛰기)
// 정시 예약(외부)과 GitHub 예비 예약이 둘 다 돌아도 하루 한 번만 보내려고 쓴다.
// 사용법: node scripts/already-done.mjs ai-coding && echo "오늘은 이미 보냄"
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadChannel, readJson, kstDate, SITE_DATA } from './lib/common.mjs';

const channel = await loadChannel(process.argv[2]);
if (channel.mode === 'event') process.exit(1); // 소식 생길 때만 보내는 채널은 여러 번 돌아도 된다
const path = join(SITE_DATA, channel.id, `${kstDate()}.json`);
const done = existsSync(path) && (await readJson(path)).summarizer === 'claude';
process.exit(done ? 0 : 1);
