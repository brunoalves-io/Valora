// JavaScript · verify-polish-checks.mjs · fixture UI checks · Windows · Node/Playwright
import path from 'node:path';

export async function verifyPolish({ page, nav, assert, dir, results }) {
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const contrastOf = locator => locator.evaluateAll(nodes => nodes.map(node => {
    const rgb = text => text.match(/[\d.]+/g).map(Number);
    const luminance = color => color.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    let ancestor=node; const layers=[];
    while(ancestor) {
      const candidate=rgb(getComputedStyle(ancestor).backgroundColor);
      layers.push(candidate);
      ancestor=ancestor.parentElement;
    }
    const background=layers.reverse().reduce((back,front)=>front.slice(0,3).map((v,i)=>v*(front[3]??1)+back[i]*(1-(front[3]??1))),[255,255,255]);
    const front=luminance(rgb(getComputedStyle(node).color)); const back=luminance(background);
    return (Math.max(front,back)+.05)/(Math.min(front,back)+.05);
  }));
  const navigate = async name => {
    await nav.getByRole('button', { name, exact: true }).click();
    await settle();
  };
  await navigate('Centros de custo');
  await page.locator('.management-card').first().waitFor();
  for (const [width, height] of [[1366,768],[1920,1080],[2560,1440],[3440,1440],[1093,614],[1536,864],[2048,1152],[2752,1152],[911,512],[1280,720],[1707,960],[2293,960]]) {
    await page.setViewportSize({width,height});
    await settle();
    const cards = await page.locator('.management-card').evaluateAll(nodes => nodes.map(card => {
      const rect = card.getBoundingClientRect();
      return {top:rect.top,bottom:rect.bottom,actions:Array.from(card.querySelectorAll('.table-action')).map(button=>{
        const r=button.getBoundingClientRect();
        const range=document.createRange(); range.selectNodeContents(button);
        const text=range.getBoundingClientRect();
        return {label:button.textContent.trim(),x:r.x,y:r.y,right:r.right,width:r.width,height:r.height,
          horizontalOffset:Math.abs((text.x+text.width/2)-(r.x+r.width/2)),
          verticalOffset:Math.abs((text.y+text.height/2)-(r.y+r.height/2)),display:getComputedStyle(button).display};
      })};
    }));
    assert.equal(cards.length,3);
    for (const card of cards) {
      const [a,b,c] = card.actions;
      assert.deepEqual(card.actions.map(a=>a.label),['Editar',card===cards[2]?'Reativar':'Desativar','Excluir']);
      assert(card.actions.every(a=>a.height>=36 && ['inline-flex','flex'].includes(a.display) && a.horizontalOffset<1 && a.verticalOffset<2),JSON.stringify({width,card}));
      assert(Math.abs(a.y-b.y)<1 && Math.abs(a.y-c.y)<1, 'Actions wrapped at '+width);
      assert(Math.abs((b.x-a.right)-(c.x-b.right))<1, 'Uneven card action gaps');
      assert(card.actions.every(a=>a.y+a.height<=card.bottom), 'Card actions clipped');
    }
    for (let i=1;i<cards.length;i++) if(Math.abs(cards[i].top-cards[i-1].top)<1)
      assert(Math.abs(cards[i].actions[0].y-cards[i-1].actions[0].y)<1,'Different description lengths moved actions');
    if(width===1920 || width===911) await page.screenshot({path:path.join(dir,'polish-cost-centers-'+width+'.png'),fullPage:true});
  }
  results.push('Cost-center buttons: equal heights, centered text, uniform gaps and aligned footers with different descriptions at 12 viewports');

  await page.setViewportSize({width:1920,height:1080});
  await navigate('Contas e caixas');
  const accounts = await page.locator('.account-card .table-action').evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,display:getComputedStyle(n).display})));
  assert.equal(accounts.length,4);
  assert(accounts.every(a=>a.height===accounts[0].height && ['inline-flex','flex'].includes(a.display)));
  results.push('Account card actions use the same centered button geometry');

  await navigate('Início');
  const status = page.locator('.executive-status-banner.critical');
  await status.waitFor();
  const icon = await status.locator('.executive-status-icon').boundingBox();
  const svg = await status.locator('.executive-status-icon svg').boundingBox();
  assert(icon && svg && icon.width===40 && icon.height===40 && svg.width===24 && svg.height===24);
  assert(Math.abs(icon.x+20-svg.x-12)<1 && Math.abs(icon.y+20-svg.y-12)<1);
  await page.screenshot({path:path.join(dir,'polish-critical-dashboard.png'),fullPage:true});
  results.push('Critical executive banner uses a centered 24px vector inside a 40px status surface');

  await navigate('Valora IA');
  for (const [width,height] of [[1920,1080],[1366,768],[1280,720],[1093,614],[911,512]]) {
    await page.setViewportSize({width,height}); await settle();
    const tabs=await page.locator('.ai-history-tabs button').evaluateAll(nodes=>nodes.map(n=>({
      height:n.getBoundingClientRect().height,font:parseFloat(getComputedStyle(n).fontSize),
      whiteSpace:getComputedStyle(n).whiteSpace,clipped:n.scrollWidth>n.clientWidth+1
    })));
    assert.equal(tabs.length,2); assert(tabs.every(t=>t.height===44 && t.font>=13 && t.whiteSpace==='nowrap' && !t.clipped),JSON.stringify({width,tabs}));
    await page.getByRole('button',{name:/^Ações IA/}).click();
    assert.equal(await page.getByRole('button',{name:/^Ações IA/}).getAttribute('aria-pressed'),'true');
    await page.getByRole('button',{name:'Conversas',exact:true}).click();
    const heights=await page.locator('.ai-suggestions button').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));
    assert(heights.length===4 && Math.max(...heights)-Math.min(...heights)<1,'Unequal suggestion heights');
    if(width>=1280) {
      const composer=await page.locator('.ai-composer').boundingBox();
      assert(composer && composer.y+composer.height<=height,'Desktop composer clipped');
    }
    await page.screenshot({path:path.join(dir,'polish-ai-'+width+'.png'),fullPage:true});
  }
  results.push('AI tabs stay single-line with a pending-action badge; selected state, suggestion heights and desktop composer checked');

  await page.setViewportSize({width:1920,height:1080});
  await navigate('Conciliação bancária');
  await page.locator('.reconciliation-rules-button').click();
  const modal=page.getByRole('dialog',{name:'Regras de categorização'});
  await modal.waitFor();
  for(const [width,height] of [[1920,1080],[1366,768],[911,512],[640,400]]) {
    await page.setViewportSize({width,height}); await settle();
    const create=modal.getByRole('button',{name:'Criar regra',exact:true});
    await create.scrollIntoViewIfNeeded();
    const button=await create.evaluate(n=>({font:parseFloat(getComputedStyle(n).fontSize),height:n.getBoundingClientRect().height}));
    assert(button.font>=14 && button.height>=44);
    const fonts=await modal.locator('.categorization-rule-grid small, .categorization-rule-form-actions > span, .categorization-rules-empty span').evaluateAll(nodes=>nodes.map(n=>parseFloat(getComputedStyle(n).fontSize)));
    assert(fonts.every(f=>f>=13));
    const bounds=await modal.boundingBox();
    assert(bounds && bounds.x>=0 && bounds.y>=0 && bounds.x+bounds.width<=width+1 && bounds.y+bounds.height<=height+1,JSON.stringify({width,bounds}));
    assert(await create.isVisible());
    await page.screenshot({path:path.join(dir,'polish-rules-'+width+'.png')});
  }
  const first=modal.getByRole('button',{name:'Fechar',exact:true});
  const helperContrasts=await contrastOf(modal.locator('.categorization-rule-grid label > small, .categorization-rule-form-actions > span, .categorization-rules-empty span'));
  assert(helperContrasts.every(ratio=>ratio>=4.5),JSON.stringify(helperContrasts));
  results.push({categorizationHelperContrast:helperContrasts});
  await first.focus(); await page.keyboard.press('Shift+Tab');
  assert(await modal.evaluate(n=>n.contains(document.activeElement)),'Categorization reverse focus escaped');
  await page.keyboard.press('Tab');
  assert(await modal.evaluate(n=>n.contains(document.activeElement)),'Categorization focus escaped');
  await page.keyboard.press('Escape');
  await modal.waitFor({state:'hidden'});
  results.push('Categorization modal: 13px helper text, 44px primary action, reachable controls at four sizes and focus containment preserved');

  await page.setViewportSize({width:1920,height:1080});
  await navigate('Fechamento mensal');
  const performance=page.locator('.monthly-performance-panel');
  await performance.locator('.monthly-close-empty').waitFor();
  const performanceHeight=await performance.evaluate(n=>n.getBoundingClientRect().height);
  assert(performanceHeight<300,'Empty performance panel stretched: '+performanceHeight);
  const monthlyContrast=await contrastOf(page.locator('.monthly-ai-copy > p, .monthly-ai-empty, .monthly-ai-side span, .monthly-ai-side small, .monthly-ai-side strong'));
  assert(monthlyContrast.every(ratio=>ratio>=4.5),JSON.stringify(monthlyContrast));
  const dreFont=await page.locator('.monthly-dre-row > span, .monthly-dre-row > strong').evaluateAll(nodes=>nodes.map(n=>parseFloat(getComputedStyle(n).fontSize)));
  assert(dreFont.every(font=>font>=13));
  results.push({monthlyAIContrast:monthlyContrast});
  await page.screenshot({path:path.join(dir,'polish-monthly-empty.png'),fullPage:true});
  results.push('Empty monthly performance panel remains below 300px without stretching to the neighboring card');
}
