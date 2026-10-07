// 3단계: 오늘 정리한 소식을 휴대폰 알림으로 보낸다.
// 사용법: node scripts/notify.mjs ai-coding
// 필요한 비밀값 (GitHub Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  — 알림 보내는 쪽 신분증
//   PUSH_SUBSCRIPTIONS                    — 앱의 '알림 켜기'에서 복사한 값 (여러 기기면 [ ] 로 묶기)
import { join } from 'node:path';
import webpush from 'web-push';
import { loadChannel, readJson, kstDate, SITE_DATA } from './lib/common.mjs';

const channel = await loadChannel(process.argv[2]);
const date = kstDate();
const digest = await readJson(join(SITE_DATA, channel.id, `${date}.json`), null);

if (!digest || digest.items.length === 0) {
  console.log(`[${channel.name}] 오늘은 새 소식이 없어 알림을 보내지 않아요.`);
  process.exit(0);
}

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_SUBSCRIPTIONS } = process.env;
if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !PUSH_SUBSCRIPTIONS) {
  console.log('알림 설정(비밀값)이 아직 없어서 건너뛰어요.');
  process.exit(0);
}

webpush.setVapidDetails('mailto:noreply@example.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const parsed = JSON.parse(PUSH_SUBSCRIPTIONS);
const subs = Array.isArray(parsed) ? parsed : [parsed];

const payload = JSON.stringify({
  title: channel.notify.title,
  body: `${digest.headline || `새 소식 ${digest.items.length}개`}\n${digest.items.slice(0, 3).map((i) => '· ' + i.title).join('\n')}`,
  url: `./?channel=${channel.id}&date=${date}`,
  tag: `${channel.id}-${date}`,
});

let failed = 0;
for (const sub of subs) {
  try {
    await webpush.sendNotification(sub, payload, { TTL: 6 * 3600 });
  } catch (e) {
    failed++;
    console.warn(`⚠ 알림 실패 (${e.statusCode ?? ''}): ${e.body || e.message}`);
    if (e.statusCode === 404 || e.statusCode === 410) {
      console.warn('  → 이 기기의 알림 등록이 만료됐어요. 앱에서 "알림 켜기"를 다시 눌러 새 값을 저장해 주세요.');
    }
  }
}
console.log(`[${channel.name}] 알림 ${subs.length - failed}/${subs.length}개 보냄`);
if (failed === subs.length) process.exit(1);
