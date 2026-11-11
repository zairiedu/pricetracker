import { createClient } from 'npm:@supabase/supabase-js@2.57.0';

const ORIGIN = 'https://zairiedu.github.io';
const headers = {'content-type':'application/json','access-control-allow-origin':ORIGIN,'vary':'Origin','cache-control':'no-store'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
const allowedHosts = new Set(['bestbuy.ca','www.bestbuy.ca','walmart.ca','www.walmart.ca','canadiantire.ca','www.canadiantire.ca','sportchek.ca','www.sportchek.ca']);
function validRetailerUrl(raw:string):URL|null {
 try {
  const u=new URL(raw);
  if(u.protocol!=='https:'||u.username||u.password||u.port||!allowedHosts.has(u.hostname.toLowerCase()))return null;
  return u;
 }catch{return null}
}
function extractOffer(html:string,requiredSize:string,requiredColor:string,currency:string){
 const scripts=[...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
 for(const script of scripts){
  let parsed:unknown;
  try{parsed=JSON.parse(script[1]);}catch{continue;}
  const products:Record<string,unknown>[]=[];
  function scan(node:unknown,depth=0){
   if(depth>8||!node||typeof node!=='object')return;
   if(Array.isArray(node)){for(const entry of node)scan(entry,depth+1);return}
   const item=node as Record<string,unknown>;
   const typ=item['@type'];
   if(typ==='Product'||Array.isArray(typ)&&typ.includes('Product'))products.push(item);
   if(item['@graph'])scan(item['@graph'],depth+1);
  }
  scan(parsed);
  for(const product of products){
   const normalized=(v:unknown)=>String(v??'').trim().toLowerCase();
   if(requiredSize&&normalized(product.size)!==normalized(requiredSize))continue;
   if(requiredColor&&normalized(product.color)!==normalized(requiredColor))continue;
   const offers=Array.isArray(product.offers)?product.offers:[product.offers];
   for(const item of offers){
    if(!item||typeof item!=='object')continue;
    const offer=item as Record<string,unknown>;
    const details=offer.priceSpecification&&typeof offer.priceSpecification==='object'?offer.priceSpecification as Record<string,unknown>:{};
    const amount=Number(offer.price??offer.lowPrice??details.price);
    const offerCurrency=String(offer.priceCurrency??details.priceCurrency??'').toUpperCase();
    const rawAvailability=String(offer.availability??'').toLowerCase();
    if(!Number.isFinite(amount)||amount<0||amount>10000000||offerCurrency!==currency)continue;
    const available=rawAvailability.endsWith('/instock')||rawAvailability.endsWith('#instock')?true:rawAvailability.includes('outofstock')?false:null;
    return {amount,available};
   }
  }
 }
 return null;
}
async function limitedHtml(url:string){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8500);
 try{
  const response=await fetch(url,{redirect:'manual',signal:controller.signal,headers:{'accept':'text/html','user-agent':'PricePilot/0.2 (price availability preview)'}});
  if(!response.ok)throw Error('Retailer declined request ('+response.status+')');
  if(!(response.headers.get('content-type')??'').toLowerCase().includes('text/html'))throw Error('Retailer returned non-HTML data');
  if(Number(response.headers.get('content-length')||0)>1100000)throw Error('Retailer response too large');
  if(!response.body)throw Error('Empty response');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let total=0;
  while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>1100000){await reader.cancel();throw Error('Retailer response too large')}parts.push(value)}
  const all=new Uint8Array(total);let offset=0;for(const part of parts){all.set(part,offset);offset+=part.byteLength}
  return new TextDecoder().decode(all);
 }finally{clearTimeout(timer)}
}

Deno.serve(async request=>{
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 const token=request.headers.get('x-pricepilot-scheduler');
 if(!token||token.length!==64)return json({error:'Unauthorized'},401);
 const endpoint=Deno.env.get('SUPABASE_URL'),secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!endpoint||!secret)return json({error:'Service unavailable'},503);
 const db=createClient(endpoint,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:allowed,error:authError}=await db.rpc('pricepilot_authorize_sweep',{provided_secret:token});
 if(authError||allowed!==true)return json({error:'Unauthorized'},401);
 const {data:trackers,error:readError}=await db.from('pricepilot_trackers')
  .select('id,user_id,name,url,target,currency,size,color,stock,monitoring_interval_hours')
  .eq('monitoring_enabled',true).order('created_at',{ascending:true}).limit(100);
 if(readError)return json({error:'Could not load monitoring jobs'},503);
 let attempted=0,verified=0,unverifiable=0,skipped=0;
 const now=Date.now(),checkedUsers=new Map<string,number>();
 for(const item of trackers||[]){
  if(attempted>=10)break;
  const retailer=validRetailerUrl(item.url);
  if(!retailer){skipped++;continue}
  const {data:last,error:lastError}=await db.from('pricepilot_check_attempts')
   .select('created_at').eq('tracker_id',item.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(lastError){skipped++;continue}
  const interval=(item.monitoring_interval_hours||24)*3600000;
  if(last&&now-Date.parse(last.created_at)<interval){skipped++;continue}
  let daily=checkedUsers.get(item.user_id);
  if(daily==null){
   const {count,error:countError}=await db.from('pricepilot_check_attempts')
    .select('id',{count:'exact',head:true}).eq('user_id',item.user_id)
    .gte('created_at',new Date(now-86400000).toISOString());
   if(countError){skipped++;continue}
   daily=count||0;checkedUsers.set(item.user_id,daily);
  }
  if(daily>=100){skipped++;continue}
  const {error:claimError}=await db.from('pricepilot_check_attempts').insert({
   user_id:item.user_id,tracker_id:item.id,window_slot:Math.floor(now/900000)
  });
  if(claimError){skipped++;continue}
  checkedUsers.set(item.user_id,daily+1);attempted++;
  let status='unverifiable',details='',offer:ReturnType<typeof extractOffer>=null;
  try{
   offer=extractOffer(await limitedHtml(retailer.href),item.size||'',item.color||'',item.currency);
   if(!offer){details='No matching variant and currency found in retailer structured data'}
   else status='verified';
  }catch(e){
   details=String((e as Error).message).slice(0,230);
   status=/declined|403|429/i.test(details)?'blocked':'error';
  }
  if(offer){
   const {data:previous}=await db.from('pricepilot_price_observations')
    .select('amount,available').eq('tracker_id',item.id).order('observed_at',{ascending:false})
    .limit(1).maybeSingle();
   const {data:observation,error:obsError}=await db.from('pricepilot_price_observations')
    .insert({tracker_id:item.id,user_id:item.user_id,amount:offer.amount,currency:item.currency,
      available:offer.available,source:'retailer_jsonld'})
    .select('id').single();
   if(obsError){status='error';details='Observation persistence failed'}
   else {
    verified++;
    const matches=(o:{amount:number,available:boolean|null})=>
      o.amount<=Number(item.target)&&(!item.stock||o.available===true);
    if(matches(offer)&&(!previous||!matches({amount:Number(previous.amount),available:previous.available}))){
     const {error:notifyError}=await db.from('pricepilot_notifications').insert({
      user_id:item.user_id,tracker_id:item.id,kind:'target_price',
      message:item.name+' reached '+offer.amount+' '+item.currency,
      source_observation_id:observation.id
     });
     if(notifyError)console.error('Alert write failure',notifyError.code);
    }
   }
  }else unverifiable++;
  const {error:logError}=await db.from('pricepilot_monitor_results').insert({
   user_id:item.user_id,tracker_id:item.id,status,details:details.slice(0,250)
  });
  if(logError)console.error('Monitor status write failure',logError.code);
 }
 return json({ok:true,attempted,verified,unverifiable,skipped});
});
