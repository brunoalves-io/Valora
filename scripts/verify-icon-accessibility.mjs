// JavaScript · verify-icon-accessibility.mjs · isolated UI fixtures · Windows · Playwright
import fs from 'node:fs/promises';
import path from 'node:path';

export async function verifyIconAccessibility({page,nav,assert,dir,results,account}) {
  const settle = () => page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const ratios = [];
  const measureContrast = async (locator, property='color') => locator.evaluateAll((nodes,property)=>nodes.map(node=>{
    const parse=s=>s.match(/[\d.]+/g).map(Number);
    const blend=(a,b)=>a.slice(0,3).map((v,i)=>v*(a[3]??1)+b[i]*(1-(a[3]??1)));
    const layers=[]; let n=node;
    while(n){layers.unshift(parse(getComputedStyle(n).backgroundColor));n=n.parentElement;}
    const background=layers.reduce((b,a)=>blend(a,b),[255,255,255]);
    const raw=parse(getComputedStyle(node)[property]); const foreground=blend(raw,background);
    const lum=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const a=lum(foreground),b=lum(background);
    return {label:node.className?.baseVal??node.className,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
  }),property);
  const companyTrigger=page.getByRole('button',{name:/Empresa ativa:/});
  await page.setViewportSize({width:1920,height:1080});
  await companyTrigger.focus(); await page.keyboard.press('Space');
  const companies=page.getByRole('region',{name:'Empresas vinculadas'});
  await companies.waitFor();
  assert.equal(await companies.locator('[aria-current="true"]').count(),1);
  const create=companies.getByRole('button',{name:/^Nova empresa/});
  for(const [width,height] of [[1920,1080],[3440,1440],[911,512],[480,270]]) {
    await page.setViewportSize({width,height}); await settle();
    await create.scrollIntoViewIfNeeded();
    const geometry=await create.evaluate(button=>{
      const r=button.getBoundingClientRect(),icon=button.querySelector('.company-menu-plus').getBoundingClientRect();
      const svg=button.querySelector('svg').getBoundingClientRect(),copy=button.lastElementChild.getBoundingClientRect();
      return {width:r.width,height:r.height,iconWidth:icon.width,svgWidth:svg.width,copyCenter:copy.y+copy.height/2,iconCenter:icon.y+icon.height/2,svgCenter:svg.y+svg.height/2};
    });
    assert(geometry.width>=44 && geometry.height>=44 && geometry.iconWidth===32 && geometry.svgWidth===20);
    assert(Math.abs(geometry.copyCenter-geometry.iconCenter)<1 && Math.abs(geometry.svgCenter-geometry.iconCenter)<1,JSON.stringify(geometry));
    await page.screenshot({path:path.join(dir,'icons-company-'+width+'.png')});
  }
  ratios.push(...await measureContrast(create.locator('.company-menu-plus svg')));
  await page.setViewportSize({width:1920,height:1080});
  await companyTrigger.focus(); await page.keyboard.press('Tab');
  assert(await companies.evaluate(n=>n.contains(document.activeElement)));
  for(let i=0;i<8 && !(await create.evaluate(n=>n===document.activeElement));i++) await page.keyboard.press('Tab');
  assert(await create.evaluate(n=>n===document.activeElement),'Creation action unreachable by Tab');
  await page.keyboard.press('Shift+Tab');
  assert(await companies.evaluate(n=>n.contains(document.activeElement)));
  await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
  const companyName=page.getByRole('textbox',{name:'Nome da nova empresa'});
  await companyName.waitFor();
  assert(await companyName.evaluate(n=>n===document.activeElement));
  await page.keyboard.press('Escape');
  await create.waitFor(); await create.focus(); await page.keyboard.press('Space');
  await companyName.waitFor(); await page.keyboard.press('Escape');
  await create.waitFor(); await create.focus(); await page.keyboard.press('Escape');
  await companies.waitFor({state:'hidden'});
  assert(await companyTrigger.evaluate(n=>n===document.activeElement));
  results.push('Nova empresa: icon/copy centers within 1px at four sizes; Tab, Shift+Tab, Enter, Space and Escape restore focus without creating data');

  const otherAccount={...account,id:'55555555-5555-4555-8555-555555555555',name:'Caixa sem vínculo',kind:'cash'};
  let feedError=false; let feedReads=0; let emptyFeed=false; let delayFeed=false;
  await page.route('**/rest/v1/financial_accounts*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([account,otherAccount])}));
  await page.route('**/rest/v1/bank_connection_accounts*',route=>{
    const url=new URL(route.request().url());
    const selected=url.searchParams.get('local_account_id');
    const data=selected===`eq.${otherAccount.id}`?[]:[{id:'external-1',name:'Conta bancária de teste',provider_account_id:'provider-1',local_account_id:account.id}];
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.route('**/rest/v1/bank_connection_transactions*',async route=>{
    feedReads++;
    if(delayFeed) await new Promise(resolve=>setTimeout(resolve,400));
    return route.fulfill({status:feedError?500:200,contentType:'application/json',body:JSON.stringify(feedError?{message:'Fixture: feed indisponível'}:emptyFeed?[]:[{id:'feed-1',external_account_id:'external-1',provider_transaction_id:'movement-1',description:'Movimentação fictícia',movement_type:'income',status:'POSTED',amount:42,transaction_date:'2026-11-01'}])});
  });
  await nav.getByRole('button',{name:'Conciliação bancária',exact:true}).click();
  const select=page.getByRole('combobox',{name:'Conta ou caixa',exact:true});
  await select.waitFor();
  const source=page.getByRole('group',{name:'Origem dos dados',exact:true});
  const openFinance=source.getByRole('radio',{name:'Open Finance',exact:true});
  const file=source.getByRole('radio',{name:'Importar arquivo',exact:true});
  const guidance=page.locator('.reconciliation-premium-empty');
  await select.selectOption('');
  await page.locator('.reconciliation-premium-empty[data-state="account"]').waitFor();
  await select.selectOption(otherAccount.id);
  await page.getByText('Conta sem vínculo com Open Finance',{exact:true}).waitFor();
  assert(await openFinance.isDisabled() && await file.isEnabled());
  await page.locator('.reconciliation-premium-empty[data-state="file-ready"]').waitFor();
  ratios.push(...await measureContrast(page.locator('.reconciliation-link-state > span svg')));
  assert.match(await openFinance.getAttribute('aria-describedby'),/description/);
  assert.equal(await source.getByRole('radio').count(),2);
  assert.equal(await source.locator('[aria-pressed]').count(),0);
  await select.selectOption(account.id);
  await page.getByText('Conta vinculada ao Open Finance',{exact:true}).waitFor();
  assert(await openFinance.isEnabled() && await openFinance.isChecked());
  await page.locator('.reconciliation-premium-empty[data-state="feed-ready"]').waitFor();
  assert.equal(await page.getByText('Escolha uma origem para começar',{exact:true}).count(),0);
  ratios.push(...await measureContrast(page.locator('.reconciliation-premium-empty svg, .reconciliation-link-state > span svg')));
  await page.screenshot({path:path.join(dir,'icons-reconciliation-empty.png'),fullPage:true});
  await fs.writeFile(path.join(dir,'icons-accessibility-tree.txt'),await source.ariaSnapshot()+'\n'+await page.locator('.reconciliation-link-state').ariaSnapshot());
  const decoration=await page.locator('.reconciliation-premium-setup svg, .reconciliation-header-actions svg, .reconciliation-premium-empty svg').evaluateAll(nodes=>nodes.map(n=>({hidden:n.getAttribute('aria-hidden'),focusable:n.getAttribute('focusable'),tabIndex:n.getAttribute('tabindex'),viewBox:n.getAttribute('viewBox')})));
  assert(decoration.length>=8 && decoration.every(n=>n.hidden==='true' && n.focusable==='false' && n.tabIndex===null && n.viewBox==='0 0 24 24'),JSON.stringify(decoration));

  const help=page.getByRole('button',{name:'Como funciona?',exact:true});
  await help.focus(); await page.keyboard.press('Enter');
  assert.equal(await help.getAttribute('aria-expanded'),'true');
  await page.keyboard.press('Space'); assert.equal(await help.getAttribute('aria-expanded'),'false');
  const rules=page.locator('.reconciliation-rules-button');
  await rules.focus(); await page.keyboard.press('Space');
  await page.getByRole('dialog',{name:'Regras de categorização'}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog',{name:'Regras de categorização'}).waitFor({state:'hidden'});
  assert(await rules.evaluate(n=>n===document.activeElement));

  await openFinance.focus();
  delayFeed=true;
  const before=feedReads; await page.keyboard.press('Space');
  await page.locator('.reconciliation-premium-empty[data-state="loading"]').waitFor();
  assert(await page.getByRole('button',{name:'Atualizando...',exact:true}).isDisabled());
  await page.screenshot({path:path.join(dir,'icons-feed-keyboard.png'),fullPage:true});
  await fs.writeFile(path.join(dir,'icons-feed-diagnostic.json'),JSON.stringify({feedReads,checked:await openFinance.isChecked(),disabled:await openFinance.isDisabled(),text:await page.locator('main').innerText()},null,2));
  await page.getByText('Movimentação fictícia',{exact:true}).waitFor();
  delayFeed=false;
  assert.equal(await guidance.count(),0,'Guidance should yield to loaded data');
  assert.equal(feedReads,before+1,'Radio initiated duplicate feed requests');
  assert(await openFinance.isChecked());
  const update=page.getByRole('button',{name:'Atualizar dados',exact:true});
  await update.waitFor();
  const chooserPromise=page.waitForEvent('filechooser');
  await file.focus(); await page.keyboard.press('Space');
  const chooser=await chooserPromise;
  await chooser.setFiles({name:'fixture.csv',mimeType:'text/csv',buffer:Buffer.from('Data;Descrição;Valor\n05/11/2026;Entrada fictícia;150,00\n')});
  const replace=source.getByRole('radio',{name:'Trocar extrato',exact:true});
  await replace.waitFor(); assert(await replace.isChecked() && !(await openFinance.isChecked()));
  await replace.focus(); await page.keyboard.press('ArrowLeft');
  await page.getByText('Movimentação fictícia',{exact:true}).waitFor();
  await page.waitForFunction(()=>{
    const radio=document.querySelector('input[name="reconciliation-source"][value="open-finance"]');
    return radio?.checked && !radio.disabled && radio.closest('label').classList.contains('active');
  });
  await settle();
  assert(await openFinance.isChecked());

  ratios.push(...await measureContrast(page.locator('.reconciliation-account-icon svg, .source-tab-icon svg, .reconciliation-link-state > span svg, .source-detail-icon svg, .reconciliation-header-actions svg')));
  const borders=await measureContrast(source.locator('label'),'borderTopColor');
  assert(borders.every(n=>n.ratio>=3),JSON.stringify(borders));
  const descriptions=await measureContrast(source.locator('small'));
  assert(descriptions.every(n=>n.ratio>=4.5),JSON.stringify(descriptions));
  const radioBorders=await measureContrast(source.getByRole('radio'),'borderTopColor');
  assert(radioBorders.every(n=>n.ratio>=3),JSON.stringify(radioBorders));
  assert(ratios.every(n=>n.ratio>=3),JSON.stringify(ratios));
  results.push({essentialIconContrast:ratios,sourceBorderContrast:borders,sourceDescriptionContrast:descriptions,radioBorderContrast:radioBorders});

  for(const [width,height] of [[1920,1080],[3440,1440],[1440,900],[1280,800],[1000,680],[1536,864],[1280,720],[960,540],[2752,1152],[2293,960],[1720,720],[800,500],[640,400],[480,270]]) {
    await page.setViewportSize({width,height}); await settle();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Page overflow at '+width);
    const targets=await page.locator('.reconciliation-header-actions button, .reconciliation-source-option, .reconciliation-account-select select, .reconciliation-source-detail > button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {width:r.width,height:r.height};}));
    assert(targets.every(n=>n.width>=44 && n.height>=44),JSON.stringify({width,targets}));
    const labels=await source.locator('label').evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,clipped:n.scrollWidth>n.clientWidth+1})));
    assert(labels.every(n=>!n.clipped));
    if(width>=1366) assert(Math.abs(labels[0].height-labels[1].height)<1,'Unequal source card heights');
    await openFinance.focus(); await page.keyboard.press('Tab');
    const focusTag=await page.evaluate(()=>document.activeElement.tagName);
    assert.notEqual(focusTag,'svg');
    if([1920,3440,911,480].includes(width)) await page.screenshot({path:path.join(dir,'icons-reconciliation-'+width+'.png'),fullPage:true});
  }
  await page.setViewportSize({width:1920,height:1080});
  await settle();
  await openFinance.focus();
  const focus=await source.locator('label.active').evaluate(n=>({style:getComputedStyle(n).outlineStyle,width:getComputedStyle(n).outlineWidth,color:getComputedStyle(n).outlineColor}));
  assert(focus.style==='solid' && parseFloat(focus.width)>=2,JSON.stringify(focus));
  const focusContrast=await measureContrast(source.locator('label.active'),'outlineColor');
  assert(focusContrast.every(n=>n.ratio>=3));
  results.push({sourceFocusContrast:focusContrast});
  feedError=true;
  await update.focus(); await page.keyboard.press('Enter');
  await page.getByRole('alert').filter({hasText:/Não foi possível/}).waitFor();
  assert(await openFinance.isChecked());
  await select.selectOption(otherAccount.id);
  await page.getByText('Conta sem vínculo com Open Finance',{exact:true}).waitFor();
  await select.selectOption(account.id);
  await page.locator('.reconciliation-premium-empty[data-state="feed-ready"]').waitFor();
  await update.click();
  await page.locator('.reconciliation-premium-empty[data-state="error"]').waitFor();
  feedError=false; emptyFeed=true;
  await update.click();
  await page.locator('.reconciliation-premium-empty[data-state="empty"]').waitFor();
  assert.equal(await page.getByRole('alert').count(),0,'Empty feed should be neutral guidance');
  assert((await guidance.boundingBox()).height<200,'Guidance panel is oversized');
  await page.screenshot({path:path.join(dir,'reconciliation-context-empty.png'),fullPage:true});
  results.push('Contextual guidance: no account, file waiting, connected before load, loading, ready, error and empty feed; no false completion');
  results.push('Reconciliation: native radio names/checked/disabled states; Space, ArrowLeft, import chooser, feed read/refresh and error feedback verified with fixtures only');
  results.push('Decorative SVGs hidden and nonfocusable; >=44px targets; 14 viewports including minimum Tauri window and 125/150/200% equivalent reflow; focus and essential contrast checked');
  await page.unroute('**/rest/v1/financial_accounts*');
  await page.unroute('**/rest/v1/bank_connection_accounts*');
  await page.unroute('**/rest/v1/bank_connection_transactions*');
}
