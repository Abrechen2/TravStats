const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const repo=path.resolve(__dirname,'../..');const frontend=path.join(repo,'.tmp/audit-round2-9678e6cd/frontend');
const esbuild=require(path.join(frontend,'node_modules/esbuild'));
const {chromium}=require(path.join(repo,'node_modules/@playwright/test'));
const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'block12-data-probes.json'),'utf8')).previewRows;
const report={commit:'9678e6cd',results:[]};
async function main(){
  const bundle=await esbuild.build({stdin:{contents:`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Modal from './src/components/Modal';
    import {LodgingImportPreviewModal} from './src/components/lodging/LodgingImportPreviewModal';
    import {buildLodgingCandidates} from './src/lib/importers/lodgingCsv';
    const root=createRoot(document.getElementById('root'));
    window.renderPreview=(rows)=>root.render(<LodgingImportPreviewModal rows={rows} summary={{newRows:0,alreadyPresent:0,needsInput:1}} onCancel={()=>{}} onCommit={async payload=>{window.auditPayload=payload;}}/>);
    window.renderModal=()=>root.render(<><button id='outside-before'>Before</button><Modal open onClose={()=>{}} title='Audit dialog' showClose={false}><button id='first'>First</button><button id='last'>Last</button></Modal><button id='outside-after'>After</button></>);
    window.csvAudit=()=>buildLodgingCandidates([{name:'Synthetic CSV Hotel',lat:'52.520',lon:'13.405',checkIn:'2026-01-01',checkOut:'2026-01-03',ratingRoom:'0.5'}],{name:'name',lat:'lat',lon:'lon',checkIn:'checkIn',checkOut:'checkOut',ratingRoom:'ratingRoom'});
  `,resolveDir:frontend,loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'audit-boundaries',setup(build){
    build.onResolve({filter:/hooks\/useTranslation$/},()=>({path:'translation',namespace:'audit'}));
    build.onResolve({filter:/lib\/logger$/},()=>({path:'logger',namespace:'audit'}));
    build.onLoad({filter:/.*/,namespace:'audit'},args=>({contents:args.path==='translation'?"export const useTranslation=()=>({t:key=>key,i18n:{language:'de'}});":"export const logger={error(){},warn(){},info(){},debug(){}};",loader:'js'}));
  }}]});
  const browser=await chromium.launch({headless:true});
  try{
    async function pageFor(){const page=await browser.newPage();await page.route('**/*',route=>route.abort());await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');await page.addScriptTag({content:bundle.outputFiles[0].text});return page;}
    for(const kind of ['heuristicControl','sameDateHeuristic','nameJoin']){
      const page=await pageFor();
      await page.evaluate(row=>window.renderPreview([row]),fixtures[kind]);
      await page.getByTestId('lodging-import-action-0').waitFor();
      const rejectCount=await page.getByTestId('lodging-import-reject-match-0').count();
      if(kind==='heuristicControl'){
        assert.equal(rejectCount,1);await page.getByTestId('lodging-import-reject-match-0').click();
        await page.getByTestId('lodging-import-action-0').selectOption('create');
        await page.getByTestId('lodging-import-commit').click();
        await page.waitForFunction(()=>window.auditPayload);
        const payload=await page.evaluate(()=>window.auditPayload);
        assert.equal(payload[0].matchedLodgingId,null);
        report.results.push({name:kind,rejectAvailable:true,clearedMatchedId:true});
      }else{
        await page.getByTestId('lodging-import-action-0').selectOption('create');
        await page.getByTestId('lodging-import-commit').click();await page.waitForFunction(()=>window.auditPayload);
        const payload=await page.evaluate(()=>window.auditPayload);
        report.results.push({name:kind,rejectAvailable:rejectCount>0,matchedIdStillSent:payload[0].matchedLodgingId===fixtures[kind].matchedLodgingId});
      }
      await page.close();
    }
    const pricePage=await pageFor();
    const priceRow={...fixtures.heuristicControl,matchedLodgingId:null,matchedLodgingName:null,dedupeHint:'none',action:'create',stay:{checkIn:'2026-01-01',checkOut:'2026-01-03',totalPrice:100,currency:null}};
    await pricePage.evaluate(row=>window.renderPreview([row]),priceRow);
    const dropdown=pricePage.getByTestId('lodging-import-currency-0');await dropdown.waitFor();
    const options=await dropdown.locator('option').evaluateAll(nodes=>nodes.map(n=>n.value));
    assert.equal(await pricePage.getByTestId('lodging-import-commit').isDisabled(),true);
    await dropdown.selectOption('EUR');await pricePage.getByTestId('lodging-import-commit').click();await pricePage.waitForFunction(()=>window.auditPayload);
    const pricePayload=await pricePage.evaluate(()=>window.auditPayload);
    assert.equal(pricePayload[0].stay.currency,'EUR');assert.equal(pricePayload[0].stay.totalPrice,100);
    report.results.push({name:'AUD-057 currency choice',unpricedUnitBlocksCommit:true,EURSelectable:options.includes('EUR'),AEDSelectable:options.includes('AED'),KWDSelectable:options.includes('KWD'),EURPayloadPreserved:true});
    const csv=await pricePage.evaluate(()=>window.csvAudit());
    assert.equal(csv.candidates[0].lodging.lat,52.52);assert.equal(csv.candidates[0].lodging.lon,13.405);assert.equal(csv.candidates[0].stay.ratingRoom,0.5);assert.deepEqual(csv.rowErrors,[]);
    report.results.push({name:'AUD-059/060 combined CSV control',lat:52.52,lon:13.405,ratingRoom:0.5,rowErrors:0});
    await pricePage.close();
    const modalPage=await pageFor();await modalPage.evaluate(()=>window.renderModal());await modalPage.getByRole('dialog').waitFor();
    const focus=[];for(let i=0;i<8;i++){await modalPage.keyboard.press('Tab');focus.push(await modalPage.evaluate(()=>({id:document.activeElement.id,inside:document.querySelector('[role=dialog]').contains(document.activeElement)})));}
    assert.ok(focus.every(f=>f.inside));
    report.results.push({name:'AUD-037 standard visible controls',tabs:focus});await modalPage.close();
  }finally{await browser.close();}
}
main().catch(error=>{report.error=error.message;process.exitCode=1;}).finally(()=>{fs.writeFileSync(path.join(__dirname,'block12-ui-probes.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));});
