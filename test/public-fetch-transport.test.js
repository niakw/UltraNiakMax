"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const dns=require("node:dns").promises;
const https=require("node:https");
const {EventEmitter}=require("node:events");
const {fetchPublicHttps}=require("../deployment/eitty/public-fetch.cjs");

async function withMockNetwork(address,reply,run) {
  const originalLookup=dns.lookup, originalRequest=https.request;
  const requests=[];
  dns.lookup=async()=>[{address,family:4}];
  https.request=(options,onResponse)=>{
    requests.push(options);
    const req=new EventEmitter();
    req.end=()=>{
      queueMicrotask(()=>{
        const response=new EventEmitter();
        response.statusCode=reply.status||200;
        response.headers=reply.headers||{};
        response.destroy=err=>response.emit("error",err);
        onResponse(response);
        response.emit("data",Buffer.from(reply.body||"{}"));
        response.emit("end");
      });
    };
    req.destroy=err=>req.emit("error",err);
    return req;
  };
  try {await run(requests);}
  finally {dns.lookup=originalLookup;https.request=originalRequest;}
}
test("remote URL is pinned to a public IPv4 socket with verified TLS and zero redirects",async()=>{
 await withMockNetwork("8.8.8.8",{body:'{"ok":true}'},async requests=>{
   const response=await fetchPublicHttps("https://example.org/c/manifest.json?foo=1");
   assert.deepEqual(await response.json(),{ok:true});
   assert.equal(requests.length,1);
   const request=requests[0];
   assert.equal(request.hostname,"8.8.8.8");
   assert.equal(request.servername,"example.org");
   assert.equal(request.headers.Host,"example.org");
   assert.equal(request.port,443);
   assert.equal(request.path,"/c/manifest.json?foo=1");
   assert.equal(request.rejectUnauthorized,true);
   assert.equal(request.agent,false);
   assert.equal(request.method,"GET");
 });
});
test("private-address DNS rebinding never reaches the HTTPS request",async()=>{
 await withMockNetwork("127.0.0.1",{body:"{}"},async requests=>{
   await assert.rejects(fetchPublicHttps("https://example.org/manifest.json"),/public IPv4/);
   assert.equal(requests.length,0);
 });
});
test("HTTP redirects are returned without following destinations",async()=>{
 await withMockNetwork("8.8.8.8",{status:302,body:"redirect",
   headers:{location:"http://169.254.169.254/latest/meta-data"}},async requests=>{
   const response=await fetchPublicHttps("https://example.org/manifest.json");
   assert.equal(response.status,302);
   assert.equal(response.ok,false);
   assert.equal(requests.length,1);
 });
});
test("remote response size is capped by bytes before JSON parsing",async()=>{
 await withMockNetwork("8.8.8.8",{body:"x".repeat(300)},async()=>{
   await assert.rejects(fetchPublicHttps("https://example.org/manifest.json",{maxBytes:128}),/size limit/);
 });
});
