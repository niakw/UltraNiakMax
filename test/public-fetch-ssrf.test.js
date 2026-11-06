"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const dns=require("node:dns").promises;
const https=require("node:https");
const {fetchPublicHttps}=require("../deployment/eitty/public-fetch.cjs");

// Unlike the old Axios mock, these tests fail if a new transport bypasses
// validation or tries to connect to a private/dangerous DNS answer.
async function assertBlocked(records) {
  const oldLookup=dns.lookup, oldRequest=https.request;
  let requests=0;
  dns.lookup=async()=>records;
  https.request=()=>{requests++;throw Error("Unexpected network call");};
  try {
    await assert.rejects(
      fetchPublicHttps("https://public-addon.example.org/manifest.json"),
      /public IPv4/
    );
    assert.equal(requests,0);
  }finally{
    dns.lookup=oldLookup;
    https.request=oldRequest;
  }
}
test("SSRF guard rejects metadata and loopback addresses before HTTPS",async()=>{
  await assertBlocked([{address:"169.254.169.254",family:4}]);
  await assertBlocked([{address:"127.0.0.1",family:4}]);
});
test("SSRF guard rejects mixed public/private DNS answer sets",async()=>{
  await assertBlocked([{address:"8.8.8.8",family:4},{address:"10.3.7.9",family:4}]);
});
