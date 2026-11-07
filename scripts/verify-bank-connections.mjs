// JavaScript · bank connection hierarchy · Windows/Chromium · Node/Playwright
// Uses the existing isolated fixture harness; never connects to real bank data.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
let source = (await fs.readFile(new URL('./verify-design-system.mjs', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
source = source.replace("const projectRoot = fileURLToPath(new URL('../', import.meta.url));", `const projectRoot = ${JSON.stringify(root)};`)
  .replace("const axePath = qaRequire.resolve('axe-core/axe.min.js');", '')
  .replace("configFile: path.join(projectRoot, 'vite.config.ts'),", "configFile: path.join(projectRoot, 'vite.config.ts'), configLoader:'runner', cacheDir:path.join(dir,'vite-cache'),");
const fixture = `
const institutions = [
  {id:'bank-a',provider_item_id:'item-a',institution_name:'Banco Exemplo',status:'active',connection_type:'open_finance',last_successful_sync_at:'2026-11-06T12:00:00Z'},
  {id:'bank-b',provider_item_id:'item-b',institution_name:'Instituição com atualização pendente',status:'pending',connection_type:'aggregation',last_successful_sync_at:null}
];
const bankAccounts = [
  {id:'external-a',connection_id:'bank-a',name:'Conta operacional da empresa',account_type:'bank',number_masked:'**** 1234',currency_code:'BRL',balance:123456.78,local_account_id:account.id},
  {id:'external-b',connection_id:'bank-a',name:'Cartão corporativo · Equipes e projetos',account_type:'credit',number_masked:'**** 9876',currency_code:'BRL',balance:-1234567890123.45,local_account_id:null},
  {id:'external-c',connection_id:'bank-a',name:'Reserva de investimentos e aplicações de longo prazo',account_type:'other',number_masked:null,currency_code:'USD',balance:null,local_account_id:null},
  {id:'external-d',connection_id:'bank-b',name:'Conta sem movimentos',account_type:'bank',number_masked:'**** 4321',currency_code:'BRL',balance:0,local_account_id:null}
];
const bankMovements = [{id:'bank-tx',external_account_id:'external-a',description:'Recebimento de contrato com descrição extensa para verificar leitura integral do conteúdo',movement_type:'income',amount:7890.12,transaction_date:'2026-11-05'}];
const bankActions = [];
let bankRole = 'owner';
`;
source = source.replace('try {\n  await server.listen();', fixture + '\ntry {\n  await server.listen();');
source = source.replace("data=[{role:'owner',created_at:'2026-01-01',company}]", "data=[{role:bankRole,created_at:'2026-01-01',company}]");
source = source.replace("    else if(url.pathname === '/rest/v1/financial_accounts')", `
    else if(url.pathname === '/functions/v1/open-finance') {
      const body=route.request().postDataJSON(); bankActions.push(body);
      if(body.action==='config') data={configured:true,includeSandbox:false};
      else if(body.action==='sync') { await new Promise(r=>setTimeout(r,300)); data={accounts:3,transactions:1}; }
      else if(body.action==='connect-token') return route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({error:'Autorização simulada; nenhum provedor real foi acessado.'})});
    }
    else if(url.pathname === '/rest/v1/bank_connections') data=institutions;
    else if(url.pathname === '/rest/v1/bank_connection_accounts') {
      if(route.request().method()==='PATCH') {
        const target=bankAccounts.find(a=>'eq.'+a.id===url.searchParams.get('id'));
        Object.assign(target,route.request().postDataJSON());
      }
      data=bankAccounts;
    }
    else if(url.pathname === '/rest/v1/bank_connection_transactions') data=bankMovements;
    else if(url.pathname === '/rest/v1/bank_sync_runs') data=[{id:'run-a',connection_id:'bank-a',status:'success',accounts_synced:3,transactions_upserted:1}];
    else if(url.pathname === '/rest/v1/financial_accounts')`);

async function verifyBankConnections({page, nav, assert, dir, results}) {
  await nav.getByRole('button', {name:'Conexões bancárias',exact:true}).click();
  const institution = page.getByRole('region',{name:'Banco Exemplo',exact:true});
  await institution.waitFor();
  assert.equal(await page.locator('.bank-external-account').count(),4);
  const cards = institution.locator('.bank-external-account');
  assert.equal(await cards.count(),3);
  assert.equal(await page.getByText('Atualização pendente',{exact:true}).count(),1);
  const contrasts = await page.locator('.bank-account-copy, .bank-account-balance, .bank-link-status, .bank-account-latest').evaluateAll(nodes => {
    const rgb=s=>s.match(/[\d.]+/g).map(Number);
    const lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    return nodes.flatMap(n=>Array.from(n.querySelectorAll('h4,strong,small,span')).filter(c=>c.textContent.trim()).map(c=>{
      let p=c; while(p && rgb(getComputedStyle(p).backgroundColor)[3]===0) p=p.parentElement;
      const a=lum(rgb(getComputedStyle(c).color)),b=lum(rgb(getComputedStyle(p).backgroundColor));
      return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    }));
  });
  assert(contrasts.every(r=>r>=4.5),JSON.stringify(contrasts));
  // Effective CSS viewports for 100/125/150/200% reflow at Full HD and ultrawide.
  for (const [width,height] of [[1920,1080],[3440,1440],[1366,768],[1536,864],[1280,720],[960,540],[2752,1152],[2293,960],[1720,720],[480,400]]) {
    await page.setViewportSize({width,height});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page overflow '+width);
    for (const card of await cards.all()) {
      assert(await card.evaluate(n=>n.scrollWidth<=n.clientWidth+1),'Account overflow '+width);
      const select=card.getByRole('combobox');
      assert((await select.boundingBox()).height>=44);
    }
    await institution.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(dir,'bank-connections-'+width+'.png'),fullPage:true});
    results.push({viewport:[width,height],columns:await institution.locator('.bank-external-accounts').evaluate(n=>getComputedStyle(n).gridTemplateColumns)});
  }
  await page.setViewportSize({width:1920,height:1080});
  const linked=cards.first();
  const select=linked.getByRole('combobox');
  await select.focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  assert(await select.evaluate(n=>n===document.activeElement));
  assert(await select.evaluate(n=>getComputedStyle(n).outlineStyle==='solid'));
  await select.selectOption('');
  await linked.getByText('Sem vínculo com o Valora',{exact:true}).waitFor();
  await select.selectOption('33333333-3333-4333-8333-333333333333');
  await linked.getByText('Vinculada ao Valora',{exact:true}).waitFor();
  await institution.getByRole('button',{name:'Sincronizar',exact:true}).click();
  await institution.locator('.bank-status').getByText('Sincronizando...', {exact:true}).waitFor();
  await page.getByText(/Banco Exemplo sincronizado:/).waitFor();
  await institution.getByRole('button',{name:'Atualizar acesso',exact:true}).click();
  await page.getByRole('alert').getByText(/Autorização simulada/).waitFor();
  await page.evaluate(()=>document.documentElement.dataset.valoraTheme='dark');
  await page.screenshot({path:path.join(dir,'bank-connections-dark-tokens.png'),fullPage:true});
  await page.evaluate(()=>delete document.documentElement.dataset.valoraTheme);
  results.push({minTextContrast:Math.min(...contrasts),keyboard:'passed',linkUnlink:'fixture only',syncAndAccessButtons:'fixture only'});
}
const start = source.indexOf('  assert.equal(await nav.getByRole');
const end = source.indexOf('  assert.equal(errors.length,0');
assertMarkers();
function assertMarkers() { if(start<0||end<start) throw new Error('Fixture harness markers changed'); }
source = source.slice(0,start) + `
 await (${verifyBankConnections.toString()})({page,nav,assert,dir,results});
 assert.equal(blockedHosts.length,0);
 assert(bankActions.some(a=>a.action==='sync'&&a.connectionId==='bank-a'));
 assert(bankActions.some(a=>a.action==='connect-token'&&a.itemId==='item-a'));
 bankRole='viewer';
 await page.reload();
 await page.getByRole('navigation',{name:'Navegação principal'}).waitFor();
 await page.getByRole('navigation',{name:'Navegação principal'}).getByRole('button',{name:'Conexões bancárias',exact:true}).click();
 await page.locator('.bank-external-account').first().waitFor();
 assert.equal(await page.getByRole('button',{name:'Sincronizar',exact:true}).count(),0);
 assert.equal(await page.locator('.bank-account-footer select:disabled').count(),4);
 results.push('Viewer: synchronization actions absent and all linking selectors disabled');
` + source.slice(end);
const generated = path.join(await fs.mkdtemp(path.join(os.tmpdir(),'valora-bank-checks-')),'run.mjs');
await fs.writeFile(generated,source);
await import(pathToFileURL(generated).href);
