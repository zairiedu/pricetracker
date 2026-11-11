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
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type'}});
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(request.headers.get('origin')&&request.headers.get('origin')!==ORIGIN)return json({error:'Origin not supported'},403);
 const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
 if(!token)return json({error:'Sign in required'},401);
 const endpoint=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!endpoint||!anon||!secret)return json({error:'Service not configured'},503);
 const identity=createClient(endpoint,anon,{auth:{persistSession:false}});
 const {data:{user},error:authError}=await identity.auth.getUser(token);
 if(authError||!user||user.is_anonymous)return json({error:'Authentication required'},401);
 let input:unknown;try{input=await request.json()}catch{return json({error:'Invalid request'},400)}
 const id=(input as {trackerId?:unknown})?.trackerId;
 if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))return json({error:'Valid tracker ID required'},400);
 const admin=createClient(endpoint,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:tracker,error:readError}=await admin.from('pricepilot_trackers').select('id,user_id,url,name,target,currency,size,color,stock,price,available').eq('id',id).eq('user_id',user.id).maybeSingle();
 if(readError)return json({error:'Could not retrieve tracker'},500);
 if(!tracker)return json({error:'Tracker not found'},404);
 const retailer=validRetailerUrl(tracker.url);
 if(!retailer)return json({error:'Retailer not yet supported for direct checks. Supported for experimental checks: Best Buy Canada, Walmart Canada, Canadian Tire and Sport Chek.'},422);
 const {data:previous}=await admin.from('pricepilot_price_observations').select('amount,available,observed_at').eq('tracker_id',tracker.id).order('observed_at',{ascending:false}).limit(1).maybeSingle();
 if(previous&&Date.now()-new Date(previous.observed_at).getTime()<15*60*1000)return json({error:'Recent observation already available; wait before checking again',latest:previous},429);
 const cutoff=new Date(Date.now()-86400000).toISOString();
 const {count,error:budgetError}=await admin.from('pricepilot_check_attempts').select('id',{head:true,count:'exact'}).eq('user_id',user.id).gte('created_at',cutoff);
 if(budgetError)return json({error:'Monitoring budget service unavailable'},503);
 if((count??0)>=100)return json({error:'Daily preview-check limit reached (100 per account)'},429);
 const {error:attemptError}=await admin.from('pricepilot_check_attempts').insert({user_id:user.id,tracker_id:tracker.id,window_slot:Math.floor(Date.now()/900000)});
 if(attemptError)return json({error:attemptError.code==='23505'?'Only one preview check per product is allowed every 15 minutes':'Could not reserve a retailer check'},attemptError.code==='23505'?429:503);
 let extracted;try{extracted=extractOffer(await limitedHtml(retailer.href),tracker.size||'',tracker.color||'',tracker.currency)}catch(e){return json({error:'Could not verify retailer price: '+String((e as Error).message).slice(0,160)},422)}
 if(!extracted)return json({error:'No matching exact-variant JSON-LD offer with verified currency was available. No price recorded.'},422);
 const {data:observation,error:writeError}=await admin.from('pricepilot_price_observations').insert({tracker_id:tracker.id,user_id:user.id,amount:extracted.amount,currency:tracker.currency,available:extracted.available,source:'retailer_jsonld'}).select('id,amount,available,observed_at').single();
 if(writeError)return json({error:'Could not store observation'},500);
 const matches=(o:{amount:number,available:boolean|null})=>o.amount<=Number(tracker.target)&&(!tracker.stock||o.available===true);
 if(matches(extracted)&&(!previous||!matches({amount:Number(previous.amount),available:previous.available}))){
  const {error:alertError}=await admin.from('pricepilot_notifications').insert({user_id:user.id,tracker_id:tracker.id,kind:'target_price',message:tracker.name+' reached '+extracted.amount+' '+tracker.currency,source_observation_id:observation.id});
  if(alertError)console.error('Notification store failed',alertError.message);
 }
 return json({success:true,observation,matched:matches(extracted),source:'retailer_jsonld',caution:'Live check only. Recurring checks and email delivery are not enabled.'});
});
