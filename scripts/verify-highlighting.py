"""Browser checks against `node scripts/verify-cloudflare.mjs --serve` fixtures.

Usage: python scripts/verify-highlighting.py http://127.0.0.1:PORT
Requires the Python Playwright package and its Chromium browser.
"""

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


origin = sys.argv[1].rstrip('/')
selector = '.content pre > code'
artifacts = Path('.workbuddy').resolve()
artifacts.mkdir(exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    no_js = browser.new_context(java_script_enabled=False)
    plain = no_js.new_page()
    plain.goto(origin, wait_until='networkidle')
    source = plain.locator(selector).all_text_contents()
    assert len(source) == 24
    assert plain.locator(f'{selector} .token').count() == 0
    assert any('\n  - name: example' in text for text in source)
    assert any('print("<hello>")' in text for text in source)
    no_js.close()

    context = browser.new_context(viewport={'width': 1280, 'height': 900})
    context.add_init_script("""(() => {
      const NativeWorker = window.Worker;
      window.highlightTimings = [];
      window.Worker = class extends NativeWorker {
        postMessage(message) {
          const started = performance.now();
          this.addEventListener('message', () => window.highlightTimings.push({
            language: message.language, chars: message.code.length,
            milliseconds: performance.now() - started
          }), { once: true });
          super.postMessage(message);
        }
      };
    })()""")
    page = context.new_page()
    errors = []
    workers = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('worker', lambda worker: workers.append(worker.url))
    page.goto(origin, wait_until='networkidle')
    page.locator(f'{selector}[data-highlighted="true"]').first.wait_for()
    initial = page.locator(f'{selector}[data-highlighted]').count()
    assert 0 < initial < 24, f'Expected lazy highlighting, got {initial}'
    colors = page.locator(f'{selector} .token').evaluate_all(
        '(nodes) => [...new Set(nodes.map(node => getComputedStyle(node).color))]'
    )
    assert len(colors) > 1, colors
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    page.screenshot(path=str(artifacts / 'highlight-desktop.png'))

    for code in page.locator(selector).all():
        code.scroll_into_view_if_needed()
        code.evaluate("node => node.dataset.testCurrent = 'true'")
        page.wait_for_function("document.querySelector('[data-test-current]').dataset.highlighted === 'true'")
        code.evaluate('node => delete node.dataset.testCurrent')
        assert code.locator('.token').count() > 0
    assert page.locator(selector).all_text_contents() == source
    assert len(workers) == 1, workers
    assert page.locator('pre script, pre img').count() == 0
    timings = page.evaluate('window.highlightTimings')
    assert len(timings) == 24
    page.evaluate("document.dispatchEvent(new Event('astro:page-load'))")
    page.wait_for_timeout(200)
    assert page.evaluate('window.highlightTimings.length') == 24

    page.set_viewport_size({'width': 390, 'height': 844})
    page.evaluate("scrollTo({top: 0, behavior: 'instant'})")
    page.screenshot(path=str(artifacts / 'highlight-mobile.png'))
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    page.goto(origin + '/?channel=beta', wait_until='networkidle')
    page.locator(f'{selector}[data-highlighted="true"]').first.wait_for()
    assert 'beta post' in page.locator('article').first.inner_text()
    assert 'alpha post' not in page.locator('article').first.inner_text()
    page.goto(origin + '/posts/12', wait_until='networkidle')
    page.locator(f'{selector}[data-highlighted="true"]').wait_for()
    assert page.locator(selector).count() == 1
    assert page.locator(f'{selector} .token').count() > 0
    assert not errors, errors
    context.close()

    empty_context = browser.new_context()
    empty_page = empty_context.new_page()
    empty_workers = []
    requests = []
    empty_page.on('worker', lambda worker: empty_workers.append(worker.url))
    empty_context.on('request', lambda request: requests.append(request.url))
    empty_page.goto(origin + '/tags', wait_until='networkidle')
    assert empty_page.locator(selector).count() == 0
    assert not empty_workers
    assert not any('highlight.worker' in url or '/prism-' in url for url in requests)
    empty_context.close()

    for failure_mode in ['constructor', 'network']:
        failed_context = browser.new_context()
        if failure_mode == 'constructor':
            failed_context.add_init_script("window.Worker = class { constructor() { throw new Error('Worker unavailable') } }")
        else:
            failed_context.route('**/highlight.worker-*.js', lambda route: route.abort())
        failed_page = failed_context.new_page()
        failures = []
        failed_page.on('pageerror', lambda error: failures.append(str(error)))
        failed_page.goto(origin, wait_until='networkidle')
        failed_page.locator(f'{selector}[data-highlighted="plain"]').first.wait_for()
        assert failed_page.locator(selector).all_text_contents() == source
        assert not failures, failures
        failed_context.close()

    print(json.dumps({
        'codeBlocks': 24, 'lazyInitialBlocks': initial, 'workerCount': 1,
        'colors': colors, 'textUnchanged': True, 'pageErrors': errors,
        'noCodeWorkerRequests': empty_workers, 'workerFailureFallback': True,
        'browserMessageWallTimeMs': timings,
    }, indent=2))
    browser.close()
