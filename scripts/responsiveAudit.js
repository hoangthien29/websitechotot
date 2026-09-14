const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DEFAULT_WIDTHS = [320, 375, 414, 768, 1024, 1440];

const findBrowserExecutable = () => {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
};

const runBrowser = (browserExecutable, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(browserExecutable, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ code: null, output });
    }, 30000);

    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve({ code, output });
    });
  });

const getMeasurement = (output, name) =>
  Number(output.match(new RegExp(`data-${name}="(-?\\d+)"`))?.[1]);

const runResponsiveAudit = async ({
  baseUrl,
  pages,
  widths = DEFAULT_WIDTHS,
}) => {
  const browserExecutable = findBrowserExecutable();

  if (!browserExecutable) {
    throw new Error('Không tìm thấy Chrome/Edge Chromium để responsive smoke test.');
  }

  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'ntt-step13-responsive-'),
  );
  const results = [];
  const measurementScript = `<script>
    (() => {
      const measure = () => {
        const root = document.documentElement;
        const body = document.body;
        const overflow = Math.max(root.scrollWidth, body.scrollWidth) - window.innerWidth;
        const clipped = [...document.querySelectorAll('a,button,input,select,textarea')]
          .filter((element) => element.getClientRects().length > 0)
          .filter((element) =>
            element.scrollWidth > element.clientWidth + 2 ||
            element.scrollHeight > element.clientHeight + 2
          ).length;
        root.dataset.auditReady = '1';
        root.dataset.auditWidth = String(window.innerWidth);
        root.dataset.auditOverflow = String(overflow);
        root.dataset.auditClipped = String(clipped);
      };
      if (document.readyState === 'complete') measure();
      else window.addEventListener('load', measure, { once: true });
    })();
  </script>`;

  try {
    for (const page of pages) {
      const snapshot = page.html
        .replaceAll('href="/', `href="${baseUrl}/`)
        .replaceAll('src="/', `src="${baseUrl}/`)
        .replace('</body>', `${measurementScript}</body>`);
      const snapshotPath = path.join(temporaryRoot, `${page.label}.html`);
      fs.writeFileSync(snapshotPath, snapshot, 'utf8');

      for (const width of widths) {
        const harnessPath = path.join(temporaryRoot, `${page.label}-${width}.html`);
        const profileDirectory = path.join(temporaryRoot, `${page.label}-${width}-profile`);
        const harness = `<!doctype html><html><head><meta charset="utf-8"></head><body>
          <iframe id="audit" src="${pathToFileURL(snapshotPath).href}"
            style="display:block;width:${width}px;height:1100px;border:0"></iframe>
          <script>
            document.getElementById('audit').addEventListener('load', (event) => {
              const source = event.currentTarget.contentDocument.documentElement;
              const target = document.documentElement;
              target.dataset.auditReady = source.dataset.auditReady || '';
              target.dataset.auditWidth = source.dataset.auditWidth || '';
              target.dataset.auditOverflow = source.dataset.auditOverflow || '';
              target.dataset.auditClipped = source.dataset.auditClipped || '';
            }, { once: true });
          </script></body></html>`;
        fs.writeFileSync(harnessPath, harness, 'utf8');
        const { code, output } = await runBrowser(browserExecutable, [
          '--headless=new',
          '--allow-file-access-from-files',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-gpu',
          '--disable-sync',
          '--force-device-scale-factor=1',
          '--no-first-run',
          '--no-proxy-server',
          '--run-all-compositor-stages-before-draw',
          `--user-data-dir=${profileDirectory}`,
          '--virtual-time-budget=1000',
          '--window-size=1600,1200',
          '--dump-dom',
          pathToFileURL(harnessPath).href,
        ]);
        const result = {
          browserExitCode: code,
          clippedControls: getMeasurement(output, 'audit-clipped'),
          label: page.label,
          measuredWidth: getMeasurement(output, 'audit-width'),
          overflow: getMeasurement(output, 'audit-overflow'),
          width,
        };
        results.push(result);

        if (
          result.browserExitCode !== 0 ||
          result.measuredWidth !== width ||
          result.overflow > 0 ||
          result.clippedControls > 0
        ) {
          throw new Error(
            `Responsive smoke fail: ${page.label} ${width}px ` +
              `(exit=${result.browserExitCode}, measured=${result.measuredWidth}, ` +
              `overflow=${result.overflow}, clipped=${result.clippedControls}).`,
          );
        }
      }
    }

    return {
      pageCount: pages.length,
      snapshotCount: results.length,
      widths,
    };
  } finally {
    const resolvedRoot = path.resolve(temporaryRoot);
    const expectedParent = path.resolve(os.tmpdir());

    if (path.dirname(resolvedRoot) === expectedParent) {
      fs.rmSync(resolvedRoot, {
        force: true,
        maxRetries: 10,
        recursive: true,
        retryDelay: 100,
      });
    }
  }
};

module.exports = {
  DEFAULT_WIDTHS,
  findBrowserExecutable,
  runResponsiveAudit,
};
