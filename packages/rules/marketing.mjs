/** Pure campaign eligibility / accounting primitives; no user identity or payment side effects. */
export const activeAt=(date, now)=> !date||new Date(date).getTime()>new Date(now).getTime();
export function calculateSlots({baseSlots,grants=[],now=new Date().toISOString(),cap=Infinity}){
 if(!Number.isSafeInteger(baseSlots)||baseSlots<0)throw new Error('Invalid base slots');
 let bonus=0,minimum=baseSlots;
 for(const grant of grants){
  if(grant.status!=='active'||!activeAt(grant.expiresAt,now))continue;
  if(!Number.isSafeInteger(grant.quantity)||grant.quantity<0)throw new Error('Invalid grant quantity');
  if(grant.type==='bonus_slots') bonus+=grant.quantity;
  else if(grant.type==='slot_allowance_total')minimum=Math.max(minimum,grant.quantity);
  else throw new Error('Unsupported grant type');
 }
 return Math.min(cap,minimum+bonus);
}
export function qualifyReferral({referrerId,referredId,referredVerified,firstRealTracker,activeDays,alreadyRewarded,referrerQualifiedCount,maxPerReferrer}){
 if(!referrerId||!referredId||referrerId===referredId)return {eligible:false,reason:'invalid_relation'};
 if(alreadyRewarded)return {eligible:false,reason:'duplicate'};
 if(!referredVerified||!firstRealTracker||activeDays<7)return {eligible:false,reason:'qualification_pending'};
 if(referrerQualifiedCount>=maxPerReferrer)return {eligible:false,reason:'cap_reached'};
 return {eligible:true};
}
export function canRedeem({campaign,accountRedemptions,totalRedemptions,now=new Date().toISOString()}){
 if(campaign.status!=='active')return {eligible:false,reason:'inactive'};
 if(campaign.startsAt&&new Date(campaign.startsAt).getTime()>new Date(now).getTime())return {eligible:false,reason:'not_started'};
 if(campaign.endsAt&&!activeAt(campaign.endsAt,now))return {eligible:false,reason:'ended'};
 if(accountRedemptions>=(campaign.limits?.perAccount??Infinity))return {eligible:false,reason:'account_cap'};
 if(totalRedemptions>=(campaign.limits?.maxTotalRedemptions??Infinity))return {eligible:false,reason:'budget_cap'};
 return {eligible:true};
}
export function rewardIdempotencyKey(campaignId,eventId,beneficiaryId){
 for(const value of [campaignId,eventId,beneficiaryId])if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value))throw new Error('Invalid id');
 return ['reward',campaignId,eventId,beneficiaryId].join(':');
}
