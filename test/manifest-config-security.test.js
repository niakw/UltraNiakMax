"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const {getOwnProfile,updatedLastAccess}=require("../services/manifest-route-service");
test("manifest state disallows reserved tokens and prototype objects",()=>{
 const configs=Object.assign(Object.create(null),{
  ABCDEF12:{catalogs:["top"],createdAt:"2025-01-01"},
  "__proto__":{catalogs:["danger"]}
 });
 assert.equal(getOwnProfile(configs,"__proto__"),null);
 assert.equal(getOwnProfile(configs,"constructor"),null);
 assert.deepEqual(getOwnProfile(configs,"ABCDEF12").catalogs,["top"]);
 assert.equal(getOwnProfile(configs,"invalid!"),null);
 const upgraded=updatedLastAccess(configs,"ABCDEF12",getOwnProfile(configs,"ABCDEF12"));
 assert.equal(Object.getPrototypeOf(upgraded),null);
 assert.match(upgraded.ABCDEF12.lastAccessed,/^\d{4}-/);
 assert.equal(configs.ABCDEF12.lastAccessed,undefined);
 assert.equal(Object.prototype.lastAccessed,undefined);
});
test("config store returns a null-prototype map even on first read",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ultramax-config-test-"));
 const file=path.join(dir,"configs.json"),prior=process.env.CONFIGS_FILE;
 try {
  fs.writeFileSync(file,'{"ABCDEF12":{"catalogs":[]},"__proto__":{"hacked":true}}');
  process.env.CONFIGS_FILE=file;
  const resolved=require.resolve("../utils/config-store");
  delete require.cache[resolved];
  const {loadConfigs,saveConfigs}=require("../utils/config-store");
  const configs=loadConfigs();
  assert.equal(Object.getPrototypeOf(configs),null);
  assert.equal(Object.prototype.hacked,undefined);
  assert.equal(Object.hasOwn(configs,"__proto__"),true);
  saveConfigs(configs);
  assert.equal(Object.getPrototypeOf(loadConfigs()),null);
  delete require.cache[resolved];
 }finally {
  if(prior===undefined)delete process.env.CONFIGS_FILE;
  else process.env.CONFIGS_FILE=prior;
  fs.rmSync(dir,{force:true,recursive:true});
 }
});

test("stored fast legacy hashes are atomically rewrapped in salted scrypt",()=>{
 const crypto=require("node:crypto");
 const {verifyPassword}=require("../utils/auth");
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ultramax-legacy-test-"));
 const file=path.join(dir,"configs.json");
 const prior=process.env.CONFIGS_FILE;
 try {
   const digest=crypto.createHash("sha256").update("test-password"+"ultramax_salt").digest("hex");
   fs.writeFileSync(file,JSON.stringify({ABCDEF12:{passwordHash:digest,catalogs:["movie"],mdblistKey:"PRIVATE_TEST_KEY"}}));
   process.env.CONFIGS_FILE=file;
   const resolved=require.resolve("../utils/config-store");
   delete require.cache[resolved];
   const {loadConfigs}=require("../utils/config-store");
   const loaded=loadConfigs();
   assert.match(loaded.ABCDEF12.passwordHash,/^legacy-scrypt:/);
   assert.equal(verifyPassword("test-password",loaded.ABCDEF12.passwordHash),true);
   assert.equal(verifyPassword("wrong",loaded.ABCDEF12.passwordHash),false);
   assert.equal(verifyPassword("test-password",digest),false);
   assert.equal(loaded.ABCDEF12.mdblistKey,"PRIVATE_TEST_KEY");
   const disk=JSON.parse(fs.readFileSync(file,"utf8"));
   assert.equal(disk.ABCDEF12.passwordHash,loaded.ABCDEF12.passwordHash);
   assert.ok(!fs.readFileSync(file,"utf8").includes(digest));
   assert.equal(loadConfigs().ABCDEF12.passwordHash,loaded.ABCDEF12.passwordHash);
   delete require.cache[resolved];
 }finally{
   if(prior===undefined) delete process.env.CONFIGS_FILE;
   else process.env.CONFIGS_FILE=prior;
   fs.rmSync(dir,{recursive:true,force:true});
 }
});
