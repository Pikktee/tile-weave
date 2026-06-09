/* eslint-disable */
import puppeteer from 'puppeteer-core';
import fs from 'fs';

const logFile = 'puppeteer_output.txt';
if (fs.existsSync(logFile)) {
  fs.unlinkSync(logFile);
}

function writeLog(text) {
  fs.appendFileSync(logFile, text + '\n');
  console.log(text); // Also print to stdout
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/Volumes/Daten/System/Programme/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: [
      '--no-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader'
    ]
  });

  const page = await browser.newPage();

  page.on('console', (msg) => {
    writeLog(`[BROWSER CONSOLE] ${msg.type().toUpperCase()}: ${msg.text()}`);
  });

  page.on('pageerror', (err) => {
    writeLog(`[BROWSER PAGEERROR]: ${err.toString()}`);
  });

  page.on('request', (req) => {
    writeLog(`[NETWORK REQUEST]: ${req.method()} ${req.url()}`);
  });

  page.on('requestfailed', (req) => {
    writeLog(`[NETWORK REQUEST FAILED]: ${req.url()} - ${req.failure().errorText}`);
  });

  page.on('response', (res) => {
    writeLog(`[NETWORK RESPONSE]: ${res.status()} ${res.url()}`);
  });

  writeLog("Navigating to / first...");
  await page.goto('http://127.0.0.1:5173/');

  // Wait for React to mount
  await new Promise(resolve => setTimeout(resolve, 2000));

  writeLog("Injecting test state directly via window.__setTileWeaveTestState...");
  await page.evaluate(() => {
    window.__setTileWeaveTestState({
      tileImage: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      viewMode: "kleidung"
    });
  });

  writeLog("Waiting 10 seconds for 3D model loading and rendering...");
  await new Promise(resolve => setTimeout(resolve, 10000));

  await browser.close();
  writeLog("Done.");
  process.exit(0);
})();
