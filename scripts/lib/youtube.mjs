// 유튜브 자막 읽기 — 진짜 브라우저(크롬)로 영상 페이지를 열고 'Show transcript' 버튼을 눌러 읽는다.
// 자막 파일만 따로 달라고 하면 유튜브가 로봇으로 보고 막아서 이 방법을 쓴다 (2026-10-11 GitHub 서버에서 확인).
import { execSync } from 'node:child_process';

let browser;

async function launch() {
  const { chromium } = await import('playwright');
  try {
    return await chromium.launch();
  } catch (e) {
    if (!/Executable doesn't exist|playwright install/i.test(e.message)) throw e;
    // 브라우저가 아직 없으면 한 번 설치 (GitHub 서버에서는 1분쯤 걸림)
    console.log('  (크롬 설치 중…)');
    execSync(`npx playwright install ${process.platform === 'linux' ? '--with-deps ' : ''}chromium`, { stdio: 'inherit' });
    return chromium.launch();
  }
}

async function newPage() {
  browser ??= await launch();
  return browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
}

export async function closeBrowser() {
  await browser?.close();
  browser = undefined;
}

// 주소를 'watch?v=영상번호' 모양으로 통일 (쇼츠 주소도)
export function watchUrl(url) {
  const id = url.match(/[?&]v=([\w-]{11})/)?.[1] || url.match(/\/shorts\/([\w-]{11})/)?.[1];
  return id ? `https://www.youtube.com/watch?v=${id}` : url;
}

// 유튜브 피드와 같은 모양의 주소: 쇼츠는 /shorts/번호, 일반 영상은 watch?v=번호 ('본 글' 기록과 맞추려고)
export function feedUrl(url) {
  const short = url.match(/\/shorts\/([\w-]{11})/)?.[1];
  return short ? `https://www.youtube.com/shorts/${short}` : watchUrl(url);
}

async function dismissConsent(page) {
  const reject = page.getByRole('button', { name: /Reject all/i });
  if (await reject.count()) {
    await reject.first().click().catch(() => {});
    await page.waitForTimeout(2000);
  }
}

// 영상 하나의 자막 전체(시간 표시 없이). 못 읽으면 null
export async function getTranscript(url) {
  const page = await newPage();
  try {
    await page.goto(watchUrl(url), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    await dismissConsent(page);
    await page.locator('#expand').first().click({ timeout: 5000 }).catch(() => {});
    const button = page.getByRole('button', { name: /Show transcript/i });
    if (!(await button.count())) return null;
    await button.first().click();
    const segments = page.locator('ytd-transcript-segment-renderer, transcript-segment-view-model');
    await segments.first().waitFor({ timeout: 10000 }).catch(() => {});
    const texts = await segments.allInnerTexts();
    const lines = texts
      .flatMap((t) => t.split('\n'))
      .map((l) => l.trim())
      .filter((l) => l && !/^\d+:\d{2}(:\d{2})?$/.test(l) && !/^(\d+\s+(hours?|minutes?|seconds?),?\s*)+$/i.test(l));
    const text = lines.join(' ').replace(/\s+/g, ' ').trim();
    return text.length > 20 ? text : null;
  } catch (e) {
    console.warn(`  ⚠ 자막 읽기 실패 (${url}): ${e.message.split('\n')[0]}`);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

// 채널의 영상·쇼츠 목록 (지난 영상 모아 보기용). 화면을 몇 번 내려서 더 불러온다
export async function listChannelVideos(channelUrl, { scrolls = 6 } = {}) {
  const found = new Map();
  for (const tab of ['videos', 'shorts']) {
    const page = await newPage();
    try {
      await page.goto(`${channelUrl.replace(/\/$/, '')}/${tab}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000);
      await dismissConsent(page);
      for (let i = 0; i < scrolls; i++) {
        await page.mouse.wheel(0, 6000);
        await page.waitForTimeout(1500);
      }
      const items = await page.$$eval('a[href*="/watch?v="], a[href*="/shorts/"]', (as) => as.map((a) => ({
        href: a.href,
        title: (a.getAttribute('title') || a.getAttribute('aria-label') || a.innerText || '').trim(),
      })));
      for (const it of items) {
        const url = feedUrl(it.href);
        const title = it.title.replace(/\s+/g, ' ').replace(/\s*-\s*play (Short|video)$/i, '').trim();
        if (title.length > 3 && !found.has(url)) found.set(url, { url, title, kind: tab === 'shorts' ? '쇼츠' : '영상' });
      }
    } catch (e) {
      console.warn(`  ⚠ ${tab} 목록 읽기 실패: ${e.message.split('\n')[0]}`);
    } finally {
      await page.close().catch(() => {});
    }
  }
  return [...found.values()];
}
