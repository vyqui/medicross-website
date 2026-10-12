import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOfferLead, deliverOfferLead } from '../src/offer-leads.js';

const valid = { requestId:'12345678-1234-4123-8123-123456789abc',offer:'gastric-sleeve',
  name:'Test formular',phone:'+40700000000',consent:true,weight:110,height:170 };
test('validation preserves phone and optional gastric measurements', () => {
  const lead = validateOfferLead(valid);
  assert.equal(lead.phone,valid.phone);
  assert.match(lead.message,/Greutate \(kg\): 110/);
  assert.match(lead.message,/Înălțime \(cm\): 170/);
  assert.equal(lead.sourcePage,'https://www.tratamente-turcia.ro/oferta-gastric-sleeve');
});
test('rejects invalid consent, fields and unrecognized offers', () => {
  for (const change of [{consent:false},{offer:'__proto__'},{phone:'abc'},{weight:-1},{requestId:'bad'}]) {
    assert.throws(()=>validateOfferLead({...valid,...change}));
  }
  assert.deepEqual(validateOfferLead({website:'spam'}),{bot:true});
});
test('only gastric form includes body measurements', () => {
  assert.doesNotMatch(validateOfferLead({...valid,offer:'implant-mamar'}).message,/Greutate/);
});
const row = {id:valid.requestId,created_at:'2026-10-12T12:00:00Z',name:'Test',phone:valid.phone,procedure:'Gastric Sleeve',message:'Test',source_page:'https://www.tratamente-turcia.ro/oferta-gastric-sleeve'};
test('each email destination receives the requested address and stable retry key', async () => {
  const sent=[];
  for (const destination of ['victor','office']) await deliverOfferLead({...row,destination},{sendMail:async m=>sent.push(m)});
  assert.deepEqual(sent.map(m=>m.to),['victorgeorgescu22@gmail.com','office@tratamente-turcia.ro']);
  assert.equal(sent[0].idempotencyKey,`offer-${row.id}-victor`);
});
test('sheet delivery requires configured secret and explicit matching acknowledgement', async () => {
  const delivery={...row,destination:'sheet'};
  await assert.rejects(deliverOfferLead(delivery,{env:{}}),/not_configured/);
  const env={OFFER_SHEET_WEBHOOK_URL:'https://script.google.com/macros/s/test/exec',OFFER_SHEET_WEBHOOK_TOKEN:'test-token'};
  for (const response of [{ok:false}, {ok:true,json:async()=>({ok:false})}, {ok:true,json:async()=>({ok:true,id:'wrong'})}]) {
    await assert.rejects(deliverOfferLead(delivery,{env,fetchImpl:async()=>response}));
  }
  await deliverOfferLead(delivery,{env,fetchImpl:async(url,opts)=>{
    assert.equal(JSON.parse(opts.body).token,'test-token');
    return {ok:true,json:async()=>({ok:true,id:row.id})};
  }});
});
