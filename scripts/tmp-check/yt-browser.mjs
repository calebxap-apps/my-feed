// 임시 점검: 진짜 브라우저로 유튜브 '스크립트 표시'를 눌러 자막을 읽을 수 있는지
import { chromium } from 'playwright';
const vid = process.argv[2] || '-6k3ZQslo6w';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
await page.goto(`https://www.youtube.com/watch?v=${vid}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
const body = await page.locator('body').innerText().catch(() => '');
console.log('봇 확인 화면?', /not a bot|unusual traffic|Sign in to confirm/i.test(body));
// 동의 화면이 뜨면 거절
const reject = page.getByRole('button', { name: /Reject all/i });
if (await reject.count()) { await reject.first().click(); await page.waitForTimeout(3000); }
await page.locator('#expand').first().click({ timeout: 5000 }).catch(() => console.log('설명 펼치기 버튼 없음'));
const btn = page.getByRole('button', { name: /Show transcript/i });
console.log('Show transcript 버튼 수:', await btn.count());
if (await btn.count()) {
  await btn.first().click();
  await page.waitForTimeout(5000);
  const segs = await page.locator('ytd-transcript-segment-renderer, transcript-segment-view-model').allInnerTexts();
  console.log('자막 조각 수:', segs.length);
  console.log(segs.slice(0, 6).map((s) => s.replace(/\s+/g, ' ')).join(' | '));
}
await browser.close();
