import {validateProductUrl,isPublicIpv4,isPublicIpv6} from './url-policy.ts';
Deno.test('accepts public shopify and custom retail domains',()=>{
 for(const url of ['https://www.shopify-fashion-store.com/products/item?variant=3','https://shop.example.ca/item?size=large','https://www.dsw.ca/product/test/123?activeColor=120']){
  if(!validateProductUrl(url))throw Error('Rejected retailer '+url);
 }
});
Deno.test('rejects unsafe server targets and URLs',()=>{
 for(const url of ['http://store.ca/item','https://127.0.0.1/private','https://[::1]/','https://192.168.0.1/',
 'https://metadata.google.internal/latest','https://localhost:443/','https://user:pass@store.ca/product',
 'https://10.0.0.1.nip.io/', 'https://my-host.local/','https://www.shop.ca:8443/path',
 'file:///etc/passwd','https://supabase.co/', 'https://my-app.github.io/page']) {
  if(validateProductUrl(url))throw Error('Accepted unsafe '+url);
 }
});
Deno.test('rejects private DNS targets',()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','172.17.3.2','192.168.2.3','169.254.169.254','100.64.0.2','198.18.0.1','8.8.8.888']){
  if(isPublicIpv4(ip))throw Error('Accepted private IPv4 '+ip);
 }
 for(const ip of ['::1','fc00::1','fe80::1','2001:db8::1']){
  if(isPublicIpv6(ip))throw Error('Accepted private IPv6 '+ip);
 }
 if(!isPublicIpv4('8.8.8.8')||!isPublicIpv6('2606:4700:4700::1111'))throw Error('Rejected public IP');
});
Deno.test('ignores fragments while keeping variant query',()=>{
 const u=validateProductUrl('https://store.ca/products/shoe?variant=3#reviews');
 if(!u||u.hash||u.search!=='?variant=3')throw Error('Lost important URL query');
});
