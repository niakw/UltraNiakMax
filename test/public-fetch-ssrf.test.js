"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const dns=require("node:dns").promises;
const axios=require("axios");
const {fetchPublicHttps}=require("../deployment/eitty/public-fetch.cjs");

test("SSRF guard rejects private DNS before making any HTTP request",async()=>{
  const oldLookup=dns.lookup, oldGet=axios.get;
  let requested=false;
  try {
    dns.lookup=async()=>[{address:"169.254.169.254",family:4}];
    axios.get=async()=>{requested=true;throw Error("Unexpected request");};
    await assert.rejects(
      fetchPublicHttps("https://public-addon.example.org/manifest.json"),
      /public IPv4/
    );
    assert.equal(requested,false);
  }finally {dns.lookup=oldLookup;axios.get=oldGet;}
});

test("public addon fetch pins vetted IPv4 and forbids redirect or proxy",async()=>{
  const oldLookup=dns.lookup,oldGet=axios.get;
  let contacted=false;
  try {
    dns.lookup=async()=>[{address:"8.8.8.8",family:4}];
    axios.get=async(url,options)=>{
      contacted=true;
      assert.equal(url,"https://valid-addon.example.org/manifest.json");
      assert.equal(options.maxRedirects,0);
      assert.equal(options.proxy,false);
      assert.equal(options.maxContentLength,1024);
      assert.equal(options.timeout,3000);
      let result;
      options.httpsAgent.options.lookup("valid-addon.example.org",{all:true},(error,records)=>{
        assert.ifError(error);
        result=records;
      });
      assert.deepEqual(result,[{address:"8.8.8.8",family:4}]);
      return {status:200,data:'{"catalogs":[]}'};
    };
    const response=await fetchPublicHttps(
      "https://valid-addon.example.org/manifest.json",
      {maxBytes:1024,timeout:3000}
    );
    assert.equal(contacted,true);
    assert.equal(response.ok,true);
    assert.deepEqual(await response.json(),{catalogs:[]});
  }finally {dns.lookup=oldLookup;axios.get=oldGet;}
});
