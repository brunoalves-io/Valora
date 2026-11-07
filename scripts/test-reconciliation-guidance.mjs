// JavaScript · presentation state regression · Windows/Node · existing TypeScript compiler
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
const source = await fs.readFile(new URL('../src/components/reconciliationGuidance.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText;
const {reconciliationGuidance: guidance, OPEN_FINANCE_EMPTY_MESSAGE} = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const base = {accountId:'account',accountCount:1,loadingAccount:false,loadingOpenFinance:false,parsing:false,linkedCount:1,parsedRows:null,error:''};
const scenarios = [
  [{accountId:''},'account'],
  [{accountId:'',accountCount:0},'account'],
  [{loadingAccount:true},'account-loading'],
  [{},'feed-ready'],
  [{linkedCount:0},'file-ready'],
  [{loadingOpenFinance:true},'loading'],
  [{parsing:true},'loading'],
  [{error:OPEN_FINANCE_EMPTY_MESSAGE},'empty'],
  [{parsedRows:0,linkedCount:0},'empty'],
  [{parsedRows:3},'ready'],
  [{error:'Feed unavailable'},'error'],
];
for (const [overrides, expected] of scenarios) {
  const state = guidance({...base,...overrides});
  assert.equal(state.state,expected,JSON.stringify(overrides));
  assert(state.title && state.description);
}
assert.match(guidance(base).description,/a leitura ainda não foi realizada/);
assert.match(guidance({...base,accountId:'',accountCount:0}).title,/Nenhuma conta disponível/);
console.log(`${scenarios.length} reconciliation presentation scenarios passed`);
