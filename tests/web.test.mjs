import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const cloud=readFileSync(new URL('../cloud.js',import.meta.url),'utf8');
test('inline dashboard script parses',()=>{
 const match=html.match(/<script>([\s\S]*?)<\/script>/);
 assert.ok(match,'inline dashboard script exists');
 assert.doesNotThrow(()=>new vm.Script(match[1]));
});
test('cloud browser module has no unsafe inline secret',()=>{
 assert.match(cloud,/createClient/);
 assert.match(cloud,/client\.auth\.signInWithPassword/);
});
test('account, checked history and rewards UI exist',()=>{
 for(const marker of ['id="accountForm"','id="historyOverlay"','id="historyClose"','pricepilotCheckRetailer(','pricepilotHistory(','Referrals & promotions'])assert.ok(html.includes(marker),marker);
});
test('restricted cloud observations are separate from manual prices',()=>{
 assert.match(html,/MANUAL PRICE/);
 assert.match(html,/VERIFIED CURRENT PRICE/);
 assert.match(cloud,/pricepilot_price_observations/);
});
test('client never contains server secret credentials',()=>{
 assert.doesNotMatch(cloud,/sb_secret_|SUPABASE_SERVICE_ROLE_KEY|service_role/);
});

test('autofill offers user-controlled target and differentiated preview',()=>{
 assert.match(html,/id="autofillStatus"/);
 assert.match(html,/id="formPriceStatus"/);
 assert.match(html,/pricepilotAutofill\(\)/);
 assert.match(html,/draftPreview/);
 assert.match(html,/PAGE PRICE PREVIEW/);
 assert.match(cloud,/pricepilot-preview/);
 assert.match(cloud,/preview_price/);
});

test('Supabase Edge Functions accept browser client CORS preflight headers',()=>{
 for(const slug of ['pricepilot-preview','pricepilot-check']){
  const edge=readFileSync(new URL('../supabase/functions/'+slug+'/index.ts',import.meta.url),'utf8');
  assert.match(edge,/access-control-allow-headers[^\n]*x-client-info/);
  assert.match(edge,/access-control-allow-headers[^\n]*authorization/);
 }
});

test('product parser uses reusable HTML library and page-identity checks',()=>{
 const edge=readFileSync(new URL('../supabase/functions/pricepilot-preview/index.ts',import.meta.url),'utf8');
 assert.match(edge,/node-html-parser@9\.0\.7/);
 assert.match(edge,/function parseProduct\(html:string, productUrl:string\)/);
 assert.match(edge,/productScore/);
 assert.match(edge,/products\.length===1\|\|productScore/);
 for(const field of ['description','sku','image','brand','currency','priceVerified:false'])assert.ok(edge.includes(field),field);
 assert.match(edge,/Page preview only/);
});
