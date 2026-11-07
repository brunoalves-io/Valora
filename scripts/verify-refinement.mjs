// JavaScript · verify-refinement.mjs · local fixture QA · Windows · Node/Playwright
// Extend the existing fixture harness without changing production dependencies.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
let source = (await fs.readFile(new URL('./verify-design-system.mjs', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
// Local fixtures exercise the final polish without touching connected data.
source = source.replace('try {\n  await server.listen();', 'financial.alerts.critical_count = 1;\ntry {\n  await server.listen();');
source = source.replace("    else if(url.pathname === '/rest/v1/financial_accounts')", `
    else if(url.pathname === '/rest/v1/cost_centers') data=[
      {id:'cost-1',name:'Administrativo',description:'Operação e gestão.',active:true},
      {id:'cost-2',name:'Projetos e desenvolvimento',description:'Planejamento, acompanhamento de contratos e execução de projetos com equipes de diferentes áreas. Descrição extensa para verificar a posição das ações no rodapé do card.',active:true},
      {id:'cost-3',name:'Arquivo',description:null,active:false}
    ];
    else if(url.pathname === '/rest/v1/categories') data=[{id:'category-1',name:'Serviços',type:'expense',active:true}];
    else if(url.pathname === '/rest/v1/ai_action_logs') data=[{id:'action-1',conversation_id:null,action_type:'create_transaction',status:'proposed',summary:'Proposta financeira de teste',payload:{},created_at:'2026-11-05T12:00:00Z'}];
    else if(url.pathname === '/rest/v1/financial_accounts')`);
source = source.replace("const projectRoot = fileURLToPath(new URL('../', import.meta.url));", `const projectRoot = ${JSON.stringify(root)};`);
source = source.replace("const axePath = qaRequire.resolve('axe-core/axe.min.js');", '');
// Keep QA caches outside the working tree so read-only workspace policies do not affect Vite.
source = source.replace("configFile: path.join(projectRoot, 'vite.config.ts'),", "configFile: path.join(projectRoot, 'vite.config.ts'), configLoader: 'runner', cacheDir: path.join(dir, 'vite-cache'),");
const axeStart = source.indexOf('  await page.addScriptTag({path:axePath});');
const axeEnd = source.indexOf('  const contrast =', axeStart);
source = source.slice(0, axeStart) + source.slice(axeEnd);
source = source.replace('[[1000,680],[1280,800],[1440,900],[1920,1080],[1024,640],[853,533],[640,400],[800,533],[960,640]]',
  '[[1366,768],[1920,1080],[2560,1440],[3440,1440],[1093,614],[1536,864],[2048,1152],[2752,1152],[911,512],[1280,720],[1707,960],[2293,960],[640,400]]');
source = source.replace("  const contrast =", `
  await page.emulateMedia({forcedColors:'none'});
  await page.setViewportSize({width:1920,height:1080});
  const moduleNames = await nav.getByRole('button').allTextContents();
  for (let i = 0; i < moduleNames.length; i++) {
    await nav.getByRole('button').nth(i).click();
    await page.waitForTimeout(250);
    for (const [width,height] of [[1366,768],[1920,1080],[2560,1440],[3440,1440],[911,512]]) {
      await page.setViewportSize({width,height});
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
      const overflow = await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth + 1);
      assert(!overflow, 'Horizontal overflow: '+moduleNames[i]+' '+width);
      if (width === 1920 || width === 911) await page.screenshot({path:path.join(dir,'module-'+i+'-'+width+'.png'),fullPage:true});
    }
    if (i === 0 || moduleNames[i].includes('IA')) {
      await page.screenshot({path:path.join(dir,'module-'+i+'.png'),fullPage:true});
    }
  }
  results.push('All 21 navigation destinations checked for page overflow at five viewport sizes; fixture data only');
  await page.setViewportSize({width:1920,height:1080});
  await page.getByRole('button',{name:'Recolher navegação',exact:true}).click();
  // Wait for React to commit the collapse before measuring its layout.
  await page.waitForFunction(()=>document.querySelector('.shell').classList.contains('sidebar-collapsed') && document.querySelector('.sidebar').getBoundingClientRect().width===76);
  assert.equal(await page.locator('.sidebar').evaluate(n=>n.getBoundingClientRect().width),76);
  assert.equal(await nav.getByRole('button').count(),21);
  await page.getByRole('button',{name:'Expandir navegação',exact:true}).click();
  results.push('Manual sidebar collapse and expansion preserve all 21 destinations');
  await nav.getByRole('button',{name:'Valora IA',exact:true}).click();
  for (const [width,height] of [[1920,1080],[1280,720]]) {
    await page.setViewportSize({width,height});
    await page.evaluate(()=>scrollTo(0,0));
    await page.getByRole('textbox',{name:'Mensagem para Valora IA'}).waitFor();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const composer=await page.locator('.ai-composer').boundingBox();
    await page.screenshot({path:path.join(dir,'composer-'+width+'.png')});
    assert(composer && composer.y>=0 && composer.y+composer.height<=height, 'Composer outside viewport '+JSON.stringify({width,height,composer}));
  }
  results.push('AI composer stays inside desktop viewport at 1920x1080 and 1280x720');
  await page.setViewportSize({width:1280,height:720});
  await nav.getByRole('button',{name:'Lançamentos',exact:true}).click();
  await page.getByText(transaction.description,{exact:true}).waitFor();
  const trigger=page.getByRole('button',{name:'Excluir',exact:true});
  await trigger.click();
  const dialog=page.getByRole('alertdialog');
  await dialog.getByRole('button').last().focus();
  await page.keyboard.press('Tab');
  assert(await dialog.evaluate(n=>n.contains(document.activeElement)), 'Focus escaped confirmation');
  await page.keyboard.press('Shift+Tab');
  assert(await dialog.evaluate(n=>n.contains(document.activeElement)), 'Reverse focus escaped confirmation');
  await page.keyboard.press('Escape');
  results.push('Confirmation traps forward/reverse keyboard focus and Escape cancels without deletion');
  assert.equal(blockedHosts.length,0);
  assert(!requests.some(r=>r.method==='DELETE'), 'Unexpected delete request');
  const contrast =`);
const polishChecks = pathToFileURL(path.join(root, 'scripts/verify-polish-checks.mjs')).href;
source = source.replace('  const contrast =', `
  const { verifyPolish } = await import(${JSON.stringify(polishChecks)});
  await verifyPolish({page,nav,assert,dir,results});
  const { verifyIconAccessibility } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'scripts/verify-icon-accessibility.mjs')).href)});
  await verifyIconAccessibility({page,nav,assert,dir,results,account});
  const contrast =`);
// :focus-visible follows input modality; establish keyboard input before focusing.
source = source.replace("  await page.emulateMedia({forcedColors:'active'});", "  await page.emulateMedia({forcedColors:'active'});\n  await page.keyboard.press('Tab');");
const generated = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'valora-refinement-run-')), 'run.mjs');
if (process.env.VALORA_QA_FOCUS === 'icons') {
  const start = source.indexOf('  assert.equal(await nav.getByRole');
  const end = source.indexOf('  assert.equal(errors.length,0');
  source = source.slice(0,start) + `
    const { verifyIconAccessibility } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'scripts/verify-icon-accessibility.mjs')).href)});
    await verifyIconAccessibility({page,nav,assert,dir,results,account});
  ` + source.slice(end);
}
await fs.writeFile(generated, source);
await import(pathToFileURL(generated).href);
