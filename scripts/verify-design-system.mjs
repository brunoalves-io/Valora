import { createRequire } from 'node:module';

import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import os from 'node:os';
// Optional QA tools live outside the project; production dependencies are unchanged.
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
const qaRequire = createRequire(path.join(process.env.VALORA_QA_TOOLS || projectRoot, 'package.json'));
const { chromium } = qaRequire('playwright-core');
const { createServer } = await import(pathToFileURL(projectRequire.resolve('vite')).href);
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'valora-phase1-qa-'));
const axePath = qaRequire.resolve('axe-core/axe.min.js');
process.env.VITE_SUPABASE_URL = 'https://valora-ui-test.invalid';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'phase1-fixture-key';
const server = await createServer({ root: projectRoot, configFile: path.join(projectRoot, 'vite.config.ts'), server: { host: '127.0.0.1', port: 4175, strictPort: true }, clearScreen: false });
let browser;
const results = [];
const errors = [];
const requests = []; const blockedHosts = [];
const uid = '11111111-1111-4111-8111-111111111111';
const cid = '22222222-2222-4222-8222-222222222222';
const account = { id:'33333333-3333-4333-8333-333333333333', name:'Conta operacional', kind:'checking', opening_balance:12000, active:true };
const transaction = { id:'44444444-4444-4444-8444-444444444444', description:'Contrato de consultoria e serviços financeiros', amount:1890.50, type:'income', status:'pending', due_date:'2026-11-15', paid_at:null, account_id:account.id, category_id:null, cost_center_id:null, partner_id:null };
const company = { id:cid, name:'Empresa Exemplo · Gestão e Serviços', slug:'exemplo', created_at:'2026-01-01', logo_url:null };
const financial = { cash:{ current_balance:12000 }, accounts:[{...account,estimated_balance:12000}], current_month_realized:{income:18000,expense:9200,result:8800}, next_30_days:{receivable:8000,payable:5000}, overdue:{receivable_amount:0,payable_amount:0}, alerts:{active_count:1,critical_count:0,items:[]}, monthly_realized_trend:[{month:'2026-09-01',income:15000,expense:8500,result:6500},{month:'2026-10-01',income:18000,expense:9200,result:8800}], upcoming_30_days:[] };
try {
  await server.listen();
  browser = await chromium.launch({executablePath:process.env.VALORA_QA_BROWSER || chromium.executablePath(),headless:true});
  const context = await browser.newContext({viewport:{width:1280,height:800},locale:'pt-BR',reducedMotion:'reduce'});
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if(url.hostname === '127.0.0.1') return route.continue();
    if(url.hostname !== 'valora-ui-test.invalid') { blockedHosts.push(url.hostname); return route.abort(); }
    requests.push({method:route.request().method(),path:url.pathname});
    let data = [];
    if(url.pathname === '/rest/v1/company_members') data=[{role:'owner',created_at:'2026-01-01',company}];
    else if(url.pathname.endsWith('/get_ai_operational_context')) data=financial;
    else if(url.pathname.endsWith('/get_financial_planning_context')) data={period_start:'2026-11-01',budgets:[],goals:[]};
    else if(url.pathname.endsWith('/list_company_alerts')) data=[{id:'alert-1',is_read:false,is_dismissed:false}];
    else if(url.pathname === '/rest/v1/financial_accounts') data=[account];
    else if(url.pathname === '/rest/v1/transactions') data=[transaction];
    else if(url.pathname === '/auth/v1/user') data={id:uid,email:'teste@example.invalid',user_metadata:{full_name:'Usuário de validação'}};
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await context.addInitScript(({uid,cid})=>{
    const payload={sub:uid,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600};
    const jwt=btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+btoa(JSON.stringify(payload))+'.fixture';
    localStorage.setItem('sb-valora-ui-test-auth-token',JSON.stringify({access_token:jwt,refresh_token:'fixture',token_type:'bearer',expires_in:3600,expires_at:payload.exp,user:{id:uid,aud:'authenticated',role:'authenticated',email:'teste@example.invalid',app_metadata:{provider:'email'},user_metadata:{full_name:'Usuário de validação'},created_at:'2026-01-01T00:00:00Z'}}));
    localStorage.setItem('valora.activeCompanyId',cid);
  },{uid,cid});
  const page = await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4175');
  await page.getByRole('navigation',{name:'Navegação principal'}).waitFor();
  await page.getByRole('heading',{name:company.name,exact:true}).waitFor();
  const nav = page.getByRole('navigation',{name:'Navegação principal'});
  assert.equal(await nav.getByRole('button').count(),21);
  results.push('21 módulos na navegação principal preservados + Configurações no rodapé');
  for(const [width,height] of [[1000,680],[1280,800],[1440,900],[1920,1080],[1024,640],[853,533],[640,400],[800,533],[960,640]]) {
    await page.setViewportSize({width,height}); await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const metrics=await page.evaluate(()=>{
      const sidebar=document.querySelector('.sidebar');
      const main=document.querySelector('main');
      const s=sidebar.getBoundingClientRect();
      const m=main.getBoundingClientRect();
      return {scroll:document.documentElement.scrollWidth,viewport:innerWidth,sidebarDisplay:getComputedStyle(sidebar).display,sidebarWidth:s.width,mainWidth:m.width,navFont: getComputedStyle(document.querySelector('.nav-label')).fontSize,navLabelDisplay:getComputedStyle(document.querySelector('.nav-label')).display,navHeight:document.querySelector('.sidebar nav').clientHeight};
    });
    assert.notEqual(metrics.sidebarDisplay,'none');
    assert(metrics.mainWidth>0 && metrics.navHeight>0);
    assert(metrics.scroll<=width+1,JSON.stringify({width,height,...metrics}));
    if(width>=901) { assert.notEqual(metrics.navLabelDisplay,'none'); assert.equal(parseFloat(metrics.navFont),14); }
    await page.getByRole('button',{name:'Configurações',exact:true}).scrollIntoViewIfNeeded();
    assert(await page.getByRole('button',{name:'Configurações',exact:true}).isVisible());
    await page.screenshot({path:path.join(dir,`shell-${width}x${height}.png`)});
    results.push({viewport:`${width}x${height}`,...metrics});
  }
  await page.setViewportSize({width:1280,height:800});
  await nav.getByRole('button',{name:'Lançamentos',exact:true}).click();
  await page.getByRole('heading',{name:'Lançamentos',exact:true}).waitFor();
  await page.getByText(transaction.description,{exact:true}).waitFor();
  await page.getByRole('button',{name:'+ Novo lançamento',exact:true}).click();
  const inputs=page.locator('.transaction-form input');
  const inputMetrics=await inputs.evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,font:parseFloat(getComputedStyle(n).fontSize)})));
  assert(inputMetrics.every(m=>m.height>=44 && m.font>=14));
  await page.screenshot({path:path.join(dir,'transactions-form.png'),fullPage:true});
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.setViewportSize({width:2560,height:1440});
  await page.getByRole('button',{name:'Excluir',exact:true}).click();
  const backdrop=await page.locator('.confirm-dialog-backdrop').boundingBox();
  assert(backdrop && backdrop.width===2560 && backdrop.height===1440,JSON.stringify(backdrop));
  await page.keyboard.press('Escape');
  await page.locator('.confirm-dialog').waitFor({state:'hidden'});
  results.push('Formulário compartilhado: campos >=44px e fonte >=14px; backdrop ocupa 2560x1440');
  await page.setViewportSize({width:640,height:400});
  await page.getByRole('button',{name:/Empresa ativa:/}).click();
  const menu=await page.locator('.company-menu').boundingBox();
  assert(menu && menu.x>=0 && menu.y>=0 && menu.x+menu.width<=640 && menu.y+menu.height<=400,JSON.stringify(menu));
  await page.screenshot({path:path.join(dir,'company-menu-compact.png')});
  await page.getByRole('button',{name:/Empresa ativa:/}).click();
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog',{name:'Ir para'}).waitFor();
  await page.getByPlaceholder('Busque por lançamentos, relatórios, clientes...').fill('categorias');
  await page.keyboard.press('Enter');
  await page.getByRole('heading',{name:'Categorias',exact:true}).waitFor();
  results.push('Seletor de empresa cabe em viewport compacto; Ctrl K abre módulo sem regressão');
  await page.keyboard.press('F1');
  await page.getByRole('dialog',{name:'Como se orientar no Valora'}).waitFor();
  await page.screenshot({path:path.join(dir,'help-compact.png')});
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.setViewportSize({width:1280,height:800});
  await page.goto('http://127.0.0.1:4175');
  await nav.waitFor();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Ir para o conteúdo');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement?.id),'workspace');
  await page.addScriptTag({path:axePath});
  const axe=await page.evaluate(async()=>window.axe.run('.sidebar',{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}}));
  assert.equal(axe.violations.length,0,JSON.stringify(axe.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))));
  results.push('axe WCAG A/AA: zero violações na barra lateral fechada; atalho de pular navegação funciona');
  const contrast = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const luminance = hex => [1,3,5].map(i => parseInt(hex.slice(i,i+2),16)/255)
      .map(v => v<=.04045 ? v/12.92 : ((v+.055)/1.055)**2.4)
      .reduce((sum,v,i) => sum+v*[.2126,.7152,.0722][i],0);
    const ratio = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
    const token = name => root.getPropertyValue(name).trim();
    return {
      primary:ratio(token('--valora-on-primary'),token('--valora-primary')),
      hover:ratio(token('--valora-on-primary'),token('--valora-primary-hover')),
      secondary:ratio(token('--valora-muted'),token('--valora-surface')),
      caption:ratio(token('--valora-muted-soft'),token('--valora-surface')),
      brandGreen:token('--valora-brand-green'),
      brandNavy:token('--valora-sidebar')
    };
  });
  assert.equal(contrast.brandGreen,'#49c390');
  assert.equal(contrast.brandNavy,'#101a2b');
  for(const key of ['primary','hover','secondary','caption']) assert(contrast[key]>=4.5,key);
  results.push({sharedTokenContrast:contrast});
  await page.evaluate(()=>document.documentElement.dataset.valoraTheme='dark');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  // Wait for computed styles after theme/viewport updates instead of sampling a transient frame.
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('button.ghost')).color==='rgb(229, 236, 244)',{},{timeout:3000});
  const dark=await page.evaluate(()=>({surface:getComputedStyle(document.documentElement).getPropertyValue('--valora-surface').trim(),foreground:getComputedStyle(document.querySelector('button.ghost')).color}));
  assert.equal(dark.surface,'#17253a');assert.equal(dark.foreground,'rgb(229, 236, 244)');
  await page.evaluate(()=>delete document.documentElement.dataset.valoraTheme);
  results.push('Tokens escuros opt-in aplicados ao botão compartilhado; modo escuro global permanece desativado');
  const densitySession=await context.newCDPSession(page);
  for(const factor of [1,1.25,1.5,2]) {
    await densitySession.send('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:factor,mobile:false});
    assert.equal(await page.evaluate(()=>devicePixelRatio),factor);
    await page.screenshot({path:path.join(dir,`density-${factor}.png`)});
  }
  await densitySession.send('Emulation.clearDeviceMetricsOverride');
  await densitySession.detach();
  results.push('Densidades de pixels emuladas: 1, 1.25, 1.5 e 2; não equivalem a validação de DPI nativo');
  await page.emulateMedia({forcedColors:'active'});
  await page.getByRole('button',{name:'Buscar módulos do Valora'}).focus();
  const focus=await page.getByRole('button',{name:'Buscar módulos do Valora'}).evaluate(n=>({style:getComputedStyle(n).outlineStyle,width:getComputedStyle(n).outlineWidth}));
  assert.equal(focus.style,'solid');assert.equal(focus.width,'2px');
  results.push('Foco visível em cores forçadas');
  assert.equal(errors.length,0,JSON.stringify(errors));
  await fs.writeFile(path.join(dir,'verification-results.json'),JSON.stringify({results,errors,requests,blockedHosts},null,2));
  console.log(JSON.stringify({results,errors,blockedHosts,fixtureOnly:true,artifacts:dir},null,2));
} catch(error) {
  await fs.writeFile(path.join(dir,'verification-failure.json'),JSON.stringify({message:error.message,stack:error.stack,results,errors,requests,blockedHosts},null,2));
  console.error(error);process.exitCode=1;
} finally { await browser?.close(); await server.close(); }
