// JavaScript · ConfirmDialog regression · Windows/Chromium · Node/Playwright
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const qaRequire = createRequire(path.join(process.env.VALORA_QA_TOOLS || root, 'package.json'));
const { chromium } = qaRequire('playwright-core');
const { createServer } = await import('vite');
const artifacts = await fs.mkdtemp(path.join(os.tmpdir(), 'valora-confirm-dialog-'));
const html = `<!doctype html><html lang="pt-BR"><body><div id="root"></div>
<script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ConfirmDialog } from '/src/components/ConfirmDialog.tsx';
import '/src/styles.css';
import '/src/styles/design-system.css';
import '/src/styles/navigation.css';
import '/src/styles/refinement.css';
function Fixture() {
  const [tone, setTone] = React.useState(null);
  return React.createElement(React.Fragment, null,
    React.createElement('button', {onClick: () => setTone('primary')}, 'Abrir fechamento'),
    React.createElement('button', {onClick: () => setTone('danger')}, 'Abrir exclusão'),
    React.createElement('div', {className: 'primary', id: 'container-probe'}, 'Container não interativo'),
    React.createElement('button', {className: 'primary', id: 'button-probe'}, 'Controle primário'),
    React.createElement(ConfirmDialog, {
      open: tone !== null, tone: tone || 'danger',
      title: tone === 'primary' ? 'Fechar este mês?' : 'Excluir registro?',
      description: 'Confirmação de teste com o componente real e os estilos completos do aplicativo.',
      warning: 'Nenhum lançamento será bloqueado ou alterado.',
      confirmLabel: tone === 'primary' ? 'Fechar mês' : 'Excluir',
      onCancel: () => setTone(null),
      onConfirm: () => { window.confirmations = (window.confirmations || 0) + 1; }
    }));
}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));
</script></body></html>`;
const server = await createServer({
  root, configLoader: 'runner', cacheDir: path.join(artifacts, 'vite-cache'),
  server: {host: '127.0.0.1', port: 4176, strictPort: true},
  plugins: [{name: 'confirm-dialog-fixture', configureServer(vite) {
    vite.middlewares.use('/__confirm-dialog', async (_req, res, next) => {
      try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/__confirm-dialog', html)); }
      catch (error) { next(error); }
    });
  }}]
});
let browser;
const results = [];
const errors = [];
const settle = () => new Promise(resolve => setTimeout(resolve, 180));
const colors = locator => locator.evaluate(node => {
  const style = getComputedStyle(node);
  return {background: style.backgroundColor, color: style.color};
});
const contrast = ({background, color}) => {
  const luminance = text => text.match(/[\d.]+/g).slice(0, 3).map(Number)
    .map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const a = luminance(background), b = luminance(color);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
};
try {
  await server.listen();
  browser = await chromium.launch({executablePath: process.env.VALORA_QA_BROWSER || chromium.executablePath(), headless: true});
  const page = await browser.newPage({reducedMotion: 'reduce'});
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto('http://127.0.0.1:4176/__confirm-dialog');
  for (const [width, height] of [[1920,1080], [3440,1440], [1366,768], [640,400], [320,256]]) {
    await page.setViewportSize({width, height});
    for (const tone of ['primary', 'danger']) {
      const trigger = page.getByRole('button', {name: tone === 'primary' ? 'Abrir fechamento' : 'Abrir exclusão', exact: true});
      await trigger.click();
      const dialog = page.getByRole('alertdialog');
      await page.waitForFunction(() => document.activeElement?.classList.contains('confirm-dialog-cancel'));
      assert(await dialog.getByRole('button', {name: 'Cancelar', exact: true}).evaluate(n => n === document.activeElement));
      await page.mouse.move(width - 1, height - 1);
      const initial = await colors(dialog);
      assert.equal(initial.background, 'rgb(255, 255, 255)');
      for (const target of [dialog.locator('h2'), dialog.locator('.confirm-dialog-icon'), dialog.locator('.confirm-dialog-warning')]) {
        const before = await colors(target);
        await target.hover(); await settle();
        assert.equal((await colors(dialog)).background, initial.background, 'Dialog background changed during hover');
        assert.deepEqual(await colors(target), before, 'Decorative content changed during hover');
      }
      assert.equal(await dialog.locator('.primary, .danger').count(), 0, 'Generic variant leaked into dialog');
      for (const button of await dialog.getByRole('button').all()) {
        await page.mouse.move(width - 1, height - 1); await settle();
        const normal = await colors(button);
        await button.hover(); await settle();
        const hovered = await colors(button);
        assert.notEqual(hovered.background, normal.background, 'Button hover was lost');
        assert(contrast(normal) >= 4.5 && contrast(hovered) >= 4.5, 'Button text contrast below AA');
        assert.equal((await colors(dialog)).background, initial.background);
      }
      const textContrast = await dialog.locator('h2, #confirm-dialog-description').evaluateAll(nodes => nodes.map(n => ({background: getComputedStyle(n.closest('.confirm-dialog')).backgroundColor, color: getComputedStyle(n).color})));
      assert(textContrast.every(pair => contrast(pair) >= 4.5));
      await dialog.getByRole('button').last().focus();
      await page.keyboard.press('Tab');
      assert(await dialog.getByRole('button').first().evaluate(n => n === document.activeElement));
      const focus = await dialog.getByRole('button').first().evaluate(n => ({outline: getComputedStyle(n).outlineStyle, shadow: getComputedStyle(n).boxShadow}));
      assert(focus.outline !== 'none' || focus.shadow !== 'none', 'No keyboard focus indicator');
      await page.keyboard.press('Shift+Tab');
      assert(await dialog.getByRole('button').last().evaluate(n => n === document.activeElement));
      assert(await dialog.evaluate(n => n.getBoundingClientRect().width <= innerWidth && n.getBoundingClientRect().height <= innerHeight));
      assert(await dialog.getByRole('button').last().evaluate(n => { const rect = n.getBoundingClientRect(); return rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth; }));
      await page.screenshot({path: path.join(artifacts, `${tone}-${width}.png`)});
      await page.keyboard.press('Escape');
      await dialog.waitFor({state: 'detached'});
      assert(await trigger.evaluate(n => n === document.activeElement));
      results.push({tone, width, height, background: initial.background, buttonContrast: '>=4.5', keyboard: 'passed'});
    }
  }
  await page.setViewportSize({width: 1920, height: 1080});
  const probe = page.locator('#container-probe');
  const before = await colors(probe);
  await probe.hover(); await settle();
  assert.deepEqual(await colors(probe), before, 'Global primary hover still affects containers');
  const buttonProbe = page.locator('#button-probe');
  const buttonBefore = await colors(buttonProbe);
  await buttonProbe.hover(); await settle();
  assert.notEqual((await colors(buttonProbe)).background, buttonBefore.background);
  assert.equal(await page.evaluate(() => window.confirmations || 0), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({results, errors, artifacts}, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
