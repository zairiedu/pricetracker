import { parse } from 'npm:node-html-parser@9.0.7';

/** Generic ecommerce metadata extraction. Never infer a price from unrelated recommendation cards. */
function clean(value:unknown,max=120):string|null {
 if(typeof value!=='string')return null;
 const normalized=value.replace(/[\u0000-\u001f]+/g,' ').replace(/\s+/g,' ').trim();
 return normalized?normalized.slice(0,max):null;
}
export function parseProduct(html:string, productUrl:string){
 const root=parse(html);
 const allMeta=root.querySelectorAll('meta');
 const meta=(...names:string[]):string|null=>{
  for(const name of names){
   const node=allMeta.find(e=>(e.getAttribute('property')||e.getAttribute('name')||e.getAttribute('itemprop')||'').toLowerCase()===name.toLowerCase());
   const value=node?.getAttribute('content');if(value)return clean(value,260);
  }
  return null;
 };
 const products:Record<string,unknown>[]=[];
 function gather(node:unknown,depth=0){
  if(depth>12||!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const item of node)gather(item,depth+1);return}
  const obj=node as Record<string,unknown>;
  const typ=obj['@type'];const types=Array.isArray(typ)?typ:[typ];
  if(types.some(t=>typeof t==='string'&&t.toLowerCase().split('/').pop()==='product'))products.push(obj);
  if(obj['@graph'])gather(obj['@graph'],depth+1);
  if(obj.mainEntity)gather(obj.mainEntity,depth+1);
 };
 for(const script of root.querySelectorAll('script[type]')){
  if((script.getAttribute('type')||'').toLowerCase()!=='application/ld+json')continue;
  try{gather(JSON.parse(script.text))}catch{/* Ignore malformed metadata blocks */ }
 }
 const expected=decodeURIComponent(new URL(productUrl).pathname.toLowerCase());
 const productId=expected.match(/(\d{7,12})p?\.html?$/)?.[1]||null;
 const pageName=meta('og:title','twitter:title')||clean(root.querySelector('h1')?.text,160);
 const words=(s:string)=>new Set(s.toLowerCase().replace(/[^a-z0-9]+/g,' ').split(' ').filter(w=>w.length>=3&&!['with','from','shop','tire','canadian','product'].includes(w)));
 const pageWords=words(pageName||expected.replace(/-/g,' '));
 const productScore=(p:Record<string,unknown>)=>{
  const name=clean(p.name);if(!name)return -100;
  let score=1;
  const matchWords=words(name);
  const overlap=[...matchWords].filter(w=>pageWords.has(w)).length;
  if(matchWords.size>=2&&pageWords.size>=2)score+=overlap/Math.max(2,matchWords.size)>=0.65?9:-6;
  const url=typeof p.url==='string'?p.url:null;
  if(url){try{const u=new URL(url,productUrl);if(u.pathname.toLowerCase()===expected)score+=12;else if(u.hostname!==new URL(productUrl).hostname)score-=5}catch{}}
  const identifiers=[p.sku,p.productID,p.mpn].map(x=>String(x??'').replace(/\D/g,''));
  if(productId&&identifiers.some(x=>x.includes(productId)))score+=10;
  return score;
 };
 products.sort((a,b)=>productScore(b)-productScore(a));
 // Multiple products may be recommendations or carousel cards; reject ambiguous matches.
 const product=products[0]&&(products.length===1||productScore(products[0])>=5)?products[0]:null;
 const nameFromProduct=clean(product?.name);
 const title=clean(root.querySelector('title')?.text,200)?.replace(/\s+[|–-]\s+(Canadian Tire|Walmart|Sport Chek|Best Buy).*$/i,'');
 const name=nameFromProduct||meta('og:title','twitter:title')||title||clean(root.querySelector('h1')?.text);
 const brand=typeof product?.brand==='string'?clean(product.brand,80):product?.brand&&typeof product.brand==='object'?clean((product.brand as Record<string,unknown>).name,80):meta('product:brand','brand');
 const size=clean(product?.size,40),color=clean(product?.color,40)||meta('product:color');
 const description=clean(product?.description,400)||meta('og:description','description');
 const sku=clean(product?.sku,80)||clean(product?.productID,80)||meta('product:retailer_item_id');
 const imageRaw=typeof product?.image==='string'?product.image:Array.isArray(product?.image)?product.image[0]:typeof product?.image==='object'?((product.image as Record<string,unknown>)?.url):null;
 const maybeImage=clean(imageRaw,1500)||meta('og:image','twitter:image');
 let image:string|null=null;try{if(maybeImage){const u=new URL(maybeImage,productUrl);if(u.protocol==='https:')image=u.href}}catch{}
 const offers=product?.offers;
 const offerList=Array.isArray(offers)?offers:[offers];
 const choosePrice=(amount:unknown,curr:unknown)=>{
  if(amount===null||amount===undefined||amount==='')return null;
  const numeric=Number(String(amount).replace(/,/g,''));
  const currency=String(curr||'').toUpperCase();
  return Number.isFinite(numeric)&&numeric>=0&&numeric<=10000000&&['CAD','USD','EUR','GBP'].includes(currency)?{price:numeric,currency}:null;
 };
 let price:null|number=null,currency:null|string=null,available:null|boolean=null;
 let source='product_title';
 for(const o of offerList){
  if(!o||typeof o!=='object')continue;
  const offer=o as Record<string,unknown>;
  const spec=offer.priceSpecification&&typeof offer.priceSpecification==='object'?offer.priceSpecification as Record<string,unknown>:{};
  const found=choosePrice(offer.price??spec.price,offer.priceCurrency??spec.priceCurrency);
  if(!found)continue;
  price=found.price;currency=found.currency;source='jsonld_offer';
  const raw=String(offer.availability??'').toLowerCase();
  available=raw.endsWith('/instock')||raw.endsWith('#instock')?true:raw.includes('outofstock')?false:null;
  break;
 }
 if(price===null){
  const found=choosePrice(meta('product:price:amount','og:price:amount','price'),meta('product:price:currency','og:price:currency','priceCurrency'));
  if(found){price=found.price;currency=found.currency;source='page_price_metadata'}
 }
 if(source==='product_title'&&nameFromProduct)source='jsonld_product';
 if(source==='product_title'&&meta('og:title','twitter:title'))source='page_metadata';
 return {name,brand,size,color,description,sku,image,price,currency,available,source,
  priceVerified:false,warning:'Page preview only. Price and availability might vary by store, region or variant. No checkout or verified price alerts are triggered by this value.'};
}

