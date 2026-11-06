"use strict";
const { test }=require("node:test");
const assert=require("node:assert/strict");
const {validateTarget,isPublicIPv4}=require("../deployment/eitty/public-fetch.cjs");

test("remote addon URLs reject unsafe schemes, internal hosts and credentials",()=>{
 for(const url of [
  "http://example.com/manifest.json",
  "https://127.0.0.1/manifest.json",
  "https://169.254.169.254/manifest.json",
  "https://localhost/manifest.json",
  "https://machine.internal/manifest.json",
  "https://user:pass@public.example/manifest.json",
  "https://example.com:8443/manifest.json",
  "https://[::1]/manifest.json"
 ]) assert.throws(()=>validateTarget(url),url);
 assert.equal(validateTarget("https://example.org/manifest.json").hostname,"example.org");
});

test("public-address check refuses private, metadata and reserved IPv4",()=>{
 for(const ip of ["127.0.0.1","10.0.0.3","169.254.169.254",
  "192.168.1.3","100.64.0.1","198.51.100.2","224.0.0.1"])
  assert.equal(isPublicIPv4(ip),false,ip);
 assert.equal(isPublicIPv4("8.8.8.8"),true);
});
