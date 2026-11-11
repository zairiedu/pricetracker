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

function clean(value:unknown,max=120):string|null {
 if(typeof value!=='string')return null;
 const s=value.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
 return s?s.slice(0,max):null;
}
function meta(html:string,key:string):string|null {
 const tags=html.match(/<meta\b[^>]*>/gi)||[];
 for(const tag of tags){
  const property=tag.match(/\b(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
  if(property?.toLowerCase()!==key.toLowerCase())continue;
  const content=tag.match(/\bcontent\s*=\s*["']([^"']+)["']/i)?.[1];
  if(content)return clean(content,120);
 }
 return null;
}
function parseProduct(html:string){
 const found:{name:string|null,brand:string|null,size:string|null,color:string|null,price:number|null,currency:string|null,available:boolean|null}={name:null,brand:null,size:null,color:null,price:null,currency:null,available:null};
 const scripts=[...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
 for(const script of scripts){
  let object:unknown;try{object=JSON.parse(script[1])}catch{continue}
  const products:Record<string,unknown>[]=[];
  function walk(v:unknown,n=0){if(!v||n>8||typeof v!=='object')return;if(Array.isArray(v)){v.forEach(x=>walk(x,n+1));return}const o=v as Record<string,unknown>,t=o['@type'];if(t==='Product'||Array.isArray(t)&&t.includes('Product'))products.push(o);if(o['@graph'])walk(o['@graph'],n+1)}
  walk(object);
  const product=products[0];if(!product)continue;
  found.name=clean(product.name,120);
  found.size=clean(product.size,40);
  found.color=clean(product.color,40);
  found.brand=clean(typeof product.brand==='string'?product.brand:(product.brand as Record<string,unknown>|undefined)?.name,80);
  const offer=Array.isArray(product.offers)?product.offers[0]:product.offers;
  if(offer&&typeof offer==='object'){
   const o=offer as Record<string,unknown>;
   const specs=o.priceSpecification&&typeof o.priceSpecification==='object'?o.priceSpecification as Record<string,unknown>:{};
   const currency=String(o.priceCurrency??specs.priceCurrency??'').toUpperCase();
   const rawPrice=o.price??specs.price;
   const price=rawPrice==null?NaN:Number(rawPrice);
   if(['CAD','USD','EUR','GBP'].includes(currency)&&Number.isFinite(price)&&price>=0&&price<=10000000){
    found.price=price;found.currency=currency;
   }
   const av=String(o.availability??'').toLowerCase();
   found.available=av.endsWith('/instock')||av.endsWith('#instock')?true:av.includes('outofstock')?false:null;
  }
  break;
 }
 if(!found.name)found.name=meta(html,'og:title')||meta(html,'twitter:title')||null;
 // A preview price is informational only; it must not enter verified history.
 return found;
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
 const site=validRetailerUrl(raw);
 if(!site)return json({error:'Auto-fill currently supports select Canadian retailers (including Sport Chek). You can still enter details manually.'},422);
 const db=createClient(endpoint,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const {count,error:countError}=await db.from('pricepilot_product_previews').select('id',{head:true,count:'exact'}).eq('user_id',user.id).gte('created_at',new Date(Date.now()-86400000).toISOString());
 if(countError)return json({error:'Preview service unavailable'},503);
 if((count??0)>=25)return json({error:'Daily preview limit reached. Try again later.'},429);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(site.href)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const {error:claimError}=await db.from('pricepilot_product_previews').insert({user_id:user.id,url_hash:hash,window_slot:Math.floor(Date.now()/300000)});
 if(claimError)return json({error:claimError.code==='23505'?'Wait five minutes before previewing this URL again.':'Preview unavailable'},claimError.code==='23505'?429:503);
 try{
  const details=parseProduct(await limitedHtml(site.href));
  if(!details.name&&!details.price)return json({error:'The retailer did not provide usable product metadata. Please fill the fields manually.'},422);
  return json({success:true,...details,source:'retailer_page_preview',checkedAt:new Date().toISOString(),warning:'Price is a page preview, not a verified observation for the selected variant. Confirm size, color, price, and target before saving.'});
 }catch(e){return json({error:'Could not fetch retailer details: '+String((e as Error).message).slice(0,160)},422)}
});
