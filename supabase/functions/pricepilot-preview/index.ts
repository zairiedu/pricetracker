import { createClient } from 'npm:@supabase/supabase-js@2.57.0';
import { parseProduct } from './parser.ts';
import { aiFallback, eligibleForAiFallback } from './agent.ts';

const ORIGIN = 'https://zairiedu.github.io';
const headers = {'content-type':'application/json','access-control-allow-origin':ORIGIN,'vary':'Origin','cache-control':'no-store'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
import { validateProductUrl } from './url-policy.ts';
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
  if(Number(response.headers.get('content-length')||0)>2000000)throw Error('Retailer response too large');
  if(!response.body)throw Error('Empty response');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let total=0;
  while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>2000000){await reader.cancel();throw Error('Retailer response too large')}parts.push(value)}
  const all=new Uint8Array(total);let offset=0;for(const part of parts){all.set(part,offset);offset+=part.byteLength}
  return new TextDecoder().decode(all);
 }finally{clearTimeout(timer)}
}


Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{...headers,'access-control-allow-methods':'POST,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type,x-client-info,x-supabase-api-version'}});
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(request.headers.get('origin')&&request.headers.get('origin')!==ORIGIN)return json({error:'Origin not supported'},403);
 const token=request.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
 if(!token)return json({error:'Please sign in to fetch product details'},401);
 const endpoint=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!endpoint||!anon||!secret)return json({error:'Service unavailable'},503);
 const idClient=createClient(endpoint,anon,{auth:{persistSession:false}});
 const {data:{user},error:userError}=await idClient.auth.getUser(token);
 if(userError||!user||user.is_anonymous)return json({error:'Authentication required'},401);
 let body:unknown;try{body=await request.json()}catch{return json({error:'Invalid request'},400)}
 const raw=(body as {url?:unknown})?.url;
 if(typeof raw!=='string'||raw.length>2048)return json({error:'Product URL required'},400);
 const site=validateProductUrl(raw);
 if(!site)return json({error:'Provide a public HTTPS product page URL. Internal addresses, nonstandard ports and private-network targets are not allowed.'},422);

 const db=createClient(endpoint,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 // Identity and metadata are shared between users without exposing tracked products.
 // The cache contains only public product-page attributes and must never
 // be used as exact variant-verified price history.
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(site.href)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const now=Date.now();
 const {data:cache,error:cacheError}=await db.from('pricepilot_product_metadata_cache')
   .select('extracted,extractor,fetched_at,expires_at').eq('url_hash',hash).maybeSingle();
 if(!cacheError&&cache&&Date.parse(cache.expires_at)>now){
  return json({success:true,...cache.extracted,source:cache.extracted.source||cache.extractor,
   checkedAt:cache.fetched_at,cached:true,
   warning:'Cached page preview, not exact-variant verified. Prices may change by store or region.'});
 }
 const {count,error:countError}=await db.from('pricepilot_product_previews')
  .select('id',{head:true,count:'exact'}).eq('user_id',user.id).gte('created_at',new Date(now-86400000).toISOString());
 if(countError)return json({error:'Preview service unavailable'},503);
 if((count??0)>=25)return json({error:'Daily preview limit reached. Try again later.'},429);
 const {error:claimError}=await db.from('pricepilot_product_previews').insert({
  user_id:user.id,url_hash:hash,window_slot:Math.floor(now/300000)
 });
 if(claimError)return json({error:claimError.code==='23505'?'Wait five minutes before refreshing this URL.':'Preview unavailable'},claimError.code==='23505'?429:503);
 try{
  const html=await limitedHtml(site.href);
  let details=parseProduct(html,site.href);
  let extractor='generic_html';
  // A tiny agent is an optional fallback only, never an independent price authority.
  if(eligibleForAiFallback(details)&&Deno.env.get('PRICEPILOT_AI_ENABLED')==='true'&&Deno.env.get('OPENAI_API_KEY')){
   const day=new Date().toISOString().slice(0,10);
   const [perUser,global]=await Promise.all([
    db.from('pricepilot_ai_extraction_budget').select('id',{count:'exact',head:true}).eq('user_id',user.id).eq('budget_day',day),
    db.from('pricepilot_ai_extraction_budget').select('id',{count:'exact',head:true}).eq('budget_day',day)
   ]);
   if(!perUser.error&&!global.error&&(perUser.count||0)<3&&(global.count||0)<40){
    // Reserve an idempotent charge slot before calling a paid provider.
    const {error:reserved}=await db.from('pricepilot_ai_extraction_budget').insert({
     user_id:user.id,url_hash:hash,budget_day:day
    });
    if(!reserved){
     const ai=await aiFallback(html,site.href);
     if(ai){
      const merged={...details};
      for(const field of ['name','brand','description','size','color','sku','image'] as const){
       if(!merged[field]&&ai[field])Object.assign(merged,{[field]:ai[field]});
      }
      details=merged;
      extractor='ai_fallback';
      details.source='ai_fallback_identity';
     }
    }
   }
  }
  if(!details.name&&!details.price)return json({
   error:'This retailer provided insufficient product metadata. Please complete the form manually.'
  },422);
  const ttlMs=details.price!==null?15*60*1000:24*60*60*1000;
  // A cached price is just a short-lived informational page preview.
  const fetchedAt=new Date().toISOString();
  const {error:writeError}=await db.from('pricepilot_product_metadata_cache').upsert({
   url_hash:hash,hostname:site.hostname,extracted:details,extractor,
   fetched_at:fetchedAt,expires_at:new Date(now+ttlMs).toISOString()
  },{onConflict:'url_hash'});
  if(writeError)console.error('Preview cache write failure',writeError.code);
  return json({success:true,...details,checkedAt:fetchedAt,cached:false,
   agentEnabled:Deno.env.get('PRICEPILOT_AI_ENABLED')==='true'&&!!Deno.env.get('OPENAI_API_KEY'),
   warning:'Page preview only. Confirm size, color and price. Verified alerts require separate retailer checks.'});
 }catch(e){
  return json({error:'Could not fetch retailer details: '+String((e as Error).message).slice(0,160)},422);
 }

});
